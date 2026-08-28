import Loading from '@design/Loading';
import { NotePreview } from '@design/NotePreview';
import {
	Btn,
	type Editor,
	getDocTitleText,
	RichEditor,
	richEditorLocaleOf,
} from '@design/RichEditor';
import {
	AppWindow,
	Eye,
	FileDown,
	FilePenLine,
	NotebookText,
	Save,
	SquarePen,
	Trash2,
} from 'lucide-react';
import { reaction } from 'mobx';
import { observer } from 'mobx-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Confirm from '@/components/design/Confirm';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { useHostLocale, useI18n } from '@/hooks';
import {
	cancelScheduledLearningNotesDraftPublish,
	type HostApi,
	scheduleLearningNotesDraftPublish,
	useLearningNotesHostSync,
} from '@/hooks/useNoteHostSync';
import type { Locale } from '@/i18n';
import { cn } from '@/lib/utils';
import useStore from '@/store';
import learningNotesStore from '@/store/learningNotes';
import type { HostHttp } from './api';
import { LargeNoteEditor, type LargeNoteSaveApi } from './components/Editor';
import { NotesListPanel } from './components/NotesListPanel';
import { WindowedPreviewBody } from './components/PreviewBody';
import { isLargeNoteHtml } from './utils';
import '@/styles.css';

/** Host 桥接 props 类型 */
type HostBridgeProps = {
	api: HostApi & {
		theme: 'light' | 'dark';
		locale?: Locale;
		event?: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		http?: HostHttp;
		ui?: {
			showToast: (options: {
				message: string;
				type?: 'success' | 'error' | 'info';
			}) => void;
			downloadBlob?: (options: {
				fileName: string;
				data: ArrayBuffer | Uint8Array;
				mimeType?: string;
			}) => Promise<{
				ok: boolean;
				hostToasted: boolean;
				message?: string;
			}>;
		};
	};
	plugin: { id: string; version: string; routePath: string };
	independent?: boolean;
};

/** TipTap 删回基线时常见尾部空段差异，不参与脏判断 */
function editorHtmlEquals(a: string, b: string): boolean {
	if (a === b) return true;
	const norm = (s: string) =>
		s
			.replace(/(<p>(?:\s|&nbsp;|<br\s*\/?\s*>)*<\/p>)+$/gi, '')
			.replace(/\s+/g, ' ')
			.trim();
	return norm(a) === norm(b);
}

/** 学习笔记应用组件 */
function LearningNotesApp({ api }: HostBridgeProps) {
	const { learningNotesStore: store } = useStore();
	const { t, locale } = useI18n();
	useHostLocale(api);
	useLearningNotesHostSync(api, store);

	const editorRef = useRef<Editor | null>(null);
	const pagedSaveRef = useRef<LargeNoteSaveApi | null>(null);
	/** 当前编辑器绑定的笔记 id（新建为 null）；须与 saveTargetId 一致才可读快照 */
	const editorBoundNoteIdRef = useRef<string | null>(null);
	/** 切篇时 +1；onReady 对齐后才允许读编辑器，避免旧标题写入新 noteId */
	const editorEpochRef = useRef(0);
	const editorReadyEpochRef = useRef(-1);
	const savingRef = useRef(false);
	const previewRef = useRef(store.preview);
	/** TipTap 规范化后的干净基线（syncDirty 优先用这个，避免和服务器原始 HTML 字符串对不上） */
	const baselineHtmlRef = useRef('');
	/** 打开笔记时的干净基线；onReady 后与 baselineHtml 对齐为编辑器序列化结果 */
	const openBaselineRef = useRef('');
	const dirtyRef = useRef(false);
	const applyingRemoteRef = useRef(false);
	/** 长笔记 remount 应用远端草稿后保留脏标记 */
	const pendingRemoteDirtyRef = useRef(false);
	/** 远端 dirty:false remount 后强制清脏（避免 html≠服务器基线又点亮） */
	const pendingRemoteCleanRef = useRef(false);
	/** remount 时保留「干净基线」，避免 onReady 把草稿当成基线 */
	const pendingRemoteBaselineRef = useRef('');
	/**
	 * 对端未保存草稿锁：mountEditor / editorSeed 二次 onCreate 后仍保持脏标记，
	 * 直到本窗保存、对端 saved、对端 dirty:false、或切到其他笔记。
	 */
	const remoteDirtyLockRef = useRef(false);
	const [readyKey, setReadyKey] = useState<string | null>(null);
	const [mountEditor, setMountEditor] = useState(false);
	const [dirty, setDirty] = useState(false);
	savingRef.current = store.saving;
	previewRef.current = store.preview;

	const toast = useCallback(
		(message: string, type: 'success' | 'error' | 'info' = 'info') => {
			api.ui?.showToast({ message, type });
		},
		[api.ui],
	);

	const currentHtml = useCallback(() => {
		const paged = pagedSaveRef.current;
		if (paged) return paged.getHTML();
		const editor = editorRef.current;
		if (!editor || editor.isDestroyed) return '';
		return editor.getHTML();
	}, []);

	const alignCleanBaseline = useCallback((html: string) => {
		baselineHtmlRef.current = html;
		openBaselineRef.current = html;
	}, []);

	const markClean = useCallback(() => {
		const html = currentHtml();
		alignCleanBaseline(html);
		dirtyRef.current = false;
		remoteDirtyLockRef.current = false;
		pendingRemoteDirtyRef.current = false;
		pendingRemoteCleanRef.current = false;
		pendingRemoteBaselineRef.current = '';
		setDirty(false);

		// 作废未发出的 dirty:true 防抖；并广播 dirty:false，对端对齐基线熄灭脏标
		cancelScheduledLearningNotesDraftPublish();
		const noteId = store.editingId;
		if (!noteId) return;
		// 干净态写入共享原始基线，主/子窗脏判断共用
		const draftTitle =
			pagedSaveRef.current?.getTitle?.() ??
			(editorRef.current && !editorRef.current.isDestroyed
				? getDocTitleText(editorRef.current.state.doc).trim()
				: '');
		store.captureNoteOrigin(noteId, html, draftTitle);
		const paged = pagedSaveRef.current;
		const editor = editorRef.current;
		if (paged) {
			scheduleLearningNotesDraftPublish(
				api,
				{
					noteId,
					title: paged.getTitle(),
					html: paged.getHTML(),
					text: paged.getText(),
				},
				store.uploadSessionId,
				false,
			);
			return;
		}
		if (editor && !editor.isDestroyed) {
			scheduleLearningNotesDraftPublish(
				api,
				{
					noteId,
					title: getDocTitleText(editor.state.doc).trim(),
					html: editor.getHTML(),
					text: editor.getText({ blockSeparator: '\n\n' }).trim(),
				},
				store.uploadSessionId,
				false,
			);
		}
	}, [alignCleanBaseline, api, currentHtml, store]);

	const applyEditorReadyDirty = useCallback(
		(html: string) => {
			const noteId = store.editingId;
			const title =
				editorRef.current && !editorRef.current.isDestroyed
					? getDocTitleText(editorRef.current.state.doc).trim()
					: '';
			// 首窗 TipTap 规范化抢占共享基线；他窗沿用已有那一份
			if (noteId) {
				store.ensureNoteOrigin(noteId, html, title);
			}
			const origin = noteId ? store.getNoteOrigin(noteId) : null;
			const sharedBase = origin?.html ?? '';

			const forceClean = pendingRemoteCleanRef.current;
			pendingRemoteCleanRef.current = false;
			if (forceClean) {
				remoteDirtyLockRef.current = false;
				pendingRemoteDirtyRef.current = false;
				pendingRemoteBaselineRef.current = '';
				alignCleanBaseline(sharedBase || html);
				dirtyRef.current = false;
				setDirty(false);
				return;
			}
			const openBase = openBaselineRef.current;
			const pending = pendingRemoteDirtyRef.current;
			pendingRemoteDirtyRef.current = false;
			// 打开即为干净稿：对齐打开稿并刷新共享基线，避免 LS 陈旧 origin 误点亮
			if (
				noteId &&
				!remoteDirtyLockRef.current &&
				!pending &&
				openBase &&
				editorHtmlEquals(html, openBase)
			) {
				store.captureNoteOrigin(noteId, html, title);
				alignCleanBaseline(html);
				dirtyRef.current = false;
				setDirty(false);
				return;
			}
			const tipTapBase = sharedBase || baselineHtmlRef.current || openBase;
			const shouldDirty =
				remoteDirtyLockRef.current ||
				pending ||
				(Boolean(tipTapBase) && !editorHtmlEquals(html, tipTapBase));
			if (shouldDirty) {
				remoteDirtyLockRef.current = true;
				baselineHtmlRef.current =
					tipTapBase ||
					pendingRemoteBaselineRef.current ||
					baselineHtmlRef.current;
				pendingRemoteBaselineRef.current = '';
				dirtyRef.current = true;
				setDirty(true);
				return;
			}
			// 干净：本地基线对齐共享原始基线
			alignCleanBaseline(sharedBase || html);
			dirtyRef.current = false;
			setDirty(false);
		},
		[alignCleanBaseline, store],
	);

	/**
	 * 换篇 / 进预览时立刻丢掉旧编辑器句柄（早于 React commit/onReady）。
	 * 只盯 editorSeed + preview：新建首次保存会写 editingId，不能因此打断当前编辑器。
	 */
	useEffect(() => {
		return reaction(
			() => `${store.preview?.id ?? ''}:${store.editorSeed}`,
			() => {
				editorEpochRef.current += 1;
				pagedSaveRef.current = null;
				editorRef.current = null;
				editorBoundNoteIdRef.current = null;
			},
		);
	}, [store]);

	/** 新建首次保存后：同一编辑器实例补上 noteId 绑定 */
	useEffect(() => {
		return reaction(
			() => store.editingId,
			(id) => {
				if (editorReadyEpochRef.current !== editorEpochRef.current) return;
				if (editorBoundNoteIdRef.current == null && id) {
					editorBoundNoteIdRef.current = id;
				}
			},
		);
	}, [store]);

	const editorMatchesTarget = useCallback(() => {
		// 只比绑定 id：epoch 未对齐时 bound 已被清空，再卡 epoch 会导致快照读空，
		// 进而 openPreview/detail 用服务端旧稿盖掉未保存正文
		const targetId = store.editingId ?? store.boundNoteId;
		return (
			editorBoundNoteIdRef.current != null &&
			editorBoundNoteIdRef.current === targetId
		);
	}, [store]);

	/** 切笔记时重置基线，避免沿用上一篇的 baseline / dirty */
	useEffect(() => {
		const initial =
			typeof store.editorInitial === 'string' ? store.editorInitial : '';
		openBaselineRef.current = initial;
		baselineHtmlRef.current = initial;
		dirtyRef.current = false;
		remoteDirtyLockRef.current = false;
		pendingRemoteDirtyRef.current = false;
		pendingRemoteCleanRef.current = false;
		pendingRemoteBaselineRef.current = '';
		setDirty(false);
	}, [store.editingId]);

	const readDraft = useCallback(() => {
		const noteId = store.editingId;
		if (
			!noteId ||
			!editorMatchesTarget() ||
			editorBoundNoteIdRef.current !== noteId
		) {
			return null;
		}
		const paged = pagedSaveRef.current;
		if (paged) {
			return {
				noteId,
				title: paged.getTitle(),
				text: paged.getText(),
				html: paged.getHTML(),
			};
		}
		const editor = editorRef.current;
		if (!editor || editor.isDestroyed) return null;
		return {
			noteId,
			title: getDocTitleText(editor.state.doc).trim(),
			text: editor.getText({ blockSeparator: '\n\n' }).trim(),
			html: editor.getHTML(),
		};
	}, [editorMatchesTarget, store.editingId]);

	const syncDirty = useCallback(() => {
		if (applyingRemoteRef.current) return;
		const html = currentHtml();
		const noteId = store.editingId;
		const openBase = openBaselineRef.current;
		const origin = noteId ? store.getNoteOrigin(noteId) : null;
		// 与打开稿一致则视为干净，避免 LS 陈旧 origin 误点亮
		const nextDirty =
			!remoteDirtyLockRef.current &&
			openBase &&
			editorHtmlEquals(html, openBase)
				? false
				: !editorHtmlEquals(
						html,
						origin?.html || baselineHtmlRef.current || openBase,
					);
		const wasDirty = dirtyRef.current;
		if (!nextDirty) {
			remoteDirtyLockRef.current = false;
			pendingRemoteDirtyRef.current = false;
			pendingRemoteCleanRef.current = false;
			alignCleanBaseline(html);
			if (
				noteId &&
				openBase &&
				editorHtmlEquals(html, openBase) &&
				origin &&
				!editorHtmlEquals(html, origin.html)
			) {
				const title =
					pagedSaveRef.current?.getTitle?.() ??
					(editorRef.current && !editorRef.current.isDestroyed
						? getDocTitleText(editorRef.current.state.doc).trim()
						: '');
				store.captureNoteOrigin(noteId, html, title);
			}
		}
		dirtyRef.current = nextDirty;
		setDirty(nextDirty);
		if (wasDirty && !nextDirty) {
			void store.settleUploadSessionIfNeeded(html);
		}

		// 缓存离页快照：路由离开时编辑器已卸，靠它自动保存
		// 不卡 matches：只要还在编辑这篇且编辑器活着就写入，避免离页 takeEditorSnapshot 读空
		if (!store.preview) {
			const noteId = store.editingId ?? store.boundNoteId;
			const paged = pagedSaveRef.current;
			const editor = editorRef.current;
			if (paged) {
				store.stashLeaveSnap({
					noteId,
					title: paged.getTitle(),
					html: paged.getHTML(),
					text: paged.getText(),
					dirty: nextDirty,
				});
			} else if (editor && !editor.isDestroyed) {
				store.stashLeaveSnap({
					noteId,
					title: getDocTitleText(editor.state.doc).trim(),
					html: editor.getHTML(),
					text: editor.getText({ blockSeparator: '\n\n' }).trim(),
					dirty: nextDirty,
				});
			}
		}

		const draft = readDraft();
		// dirty→clean（如删回已保存内容）也要广播，否则对端仍留脏标记
		if (draft && (nextDirty || wasDirty)) {
			scheduleLearningNotesDraftPublish(
				api,
				draft,
				store.uploadSessionId,
				nextDirty,
			);
		}
	}, [
		alignCleanBaseline,
		api,
		currentHtml,
		editorMatchesTarget,
		readDraft,
		store,
	]);

	useEffect(() => {
		store.bind(api.http, toast, t, api.ui?.downloadBlob);
	}, [api.http, api.ui?.downloadBlob, toast, t, store]);

	/** 再次进入且列表仍开着：拉最新（单例 store 会保留 listOpen，不会再走 setListOpen） */
	useEffect(() => {
		if (!api.http || !store.listOpen) return;
		void store.refreshList();
	}, [api.http, store]);

	useEffect(() => {
		store.registerEditorSnapshot(() => {
			if (store.preview) return null;
			const noteId = store.editingId ?? store.boundNoteId;
			// 新建笔记 editingId/bound 均为 null，与 editorBound 一致时仍可读
			if (editorBoundNoteIdRef.current !== noteId) return null;
			const paged = pagedSaveRef.current;
			if (paged) {
				return {
					title: paged.getTitle(),
					html: paged.getHTML(),
					text: paged.getText(),
					dirty: dirtyRef.current,
				};
			}
			const editor = editorRef.current;
			if (!editor || editor.isDestroyed) return null;
			return {
				title: getDocTitleText(editor.state.doc).trim(),
				html: editor.getHTML(),
				text: editor.getText({ blockSeparator: '\n\n' }).trim(),
				dirty: dirtyRef.current,
			};
		});
		return () => store.registerEditorSnapshot(null);
	}, [store]);

	/** SPA 离开学习笔记：先通知对端清脏，再保存（unmount 会立刻卸 syncPublish） */
	useEffect(() => {
		return () => {
			cancelScheduledLearningNotesDraftPublish();
			const noteId = store.editingId ?? store.boundNoteId;
			// 此刻 registerEditorSnapshot 尚未卸（本 effect 后注册、先清理），优先 live；否则 leaveSnap
			const snap = store.takeEditorSnapshot();
			// 同步广播 dirty:false，子窗立刻熄灭变更标（不等 HTTP）
			if (noteId && snap && !store.preview) {
				scheduleLearningNotesDraftPublish(
					api,
					{
						noteId,
						title: snap.title,
						html: snap.html,
						text: snap.text,
					},
					store.uploadSessionId,
					false,
				);
			}
			void store.leavePage();
		};
	}, [api, store]);

	useEffect(() => {
		store.registerRemoteDraftApplier((noteId, draft) => {
			if (store.editingId !== noteId) return false;
			const paged = pagedSaveRef.current;
			const editor = editorRef.current;
			const tipTapBase =
				baselineHtmlRef.current ||
				openBaselineRef.current ||
				(typeof store.editorInitial === 'string' ? store.editorInitial : '');

			store.adoptUploadSessionIdForSync(draft.uploadSessionId);

			const origin = store.getNoteOrigin(noteId);
			const sharedBase = origin?.html || tipTapBase;
			// dirty:false 权威清脏；否则相对共享原始基线（主子窗同一份）
			const nextDirty =
				draft.dirty === false
					? false
					: !editorHtmlEquals(draft.html, sharedBase);

			if (nextDirty) {
				remoteDirtyLockRef.current = true;
				pendingRemoteCleanRef.current = false;
			} else {
				remoteDirtyLockRef.current = false;
				pendingRemoteDirtyRef.current = false;
				pendingRemoteCleanRef.current = true;
				dirtyRef.current = false;
				setDirty(false);
				// remount 前先对齐基线，避免 onReady 在 forceClean 丢失时又因 html≠旧基线点亮
				if (draft.html.trim()) {
					alignCleanBaseline(draft.html);
				}
			}

			if (paged || !editor || editor.isDestroyed) {
				if (nextDirty) {
					pendingRemoteDirtyRef.current = true;
					pendingRemoteCleanRef.current = false;
					if (!pendingRemoteBaselineRef.current) {
						pendingRemoteBaselineRef.current = tipTapBase;
					}
				}
				return false;
			}
			if (editorHtmlEquals(editor.getHTML(), draft.html)) {
				if (nextDirty) {
					baselineHtmlRef.current = sharedBase;
				} else {
					const cleanHtml = draft.html || editor.getHTML();
					alignCleanBaseline(cleanHtml);
					pendingRemoteCleanRef.current = false;
					if (cleanHtml.trim()) {
						store.captureNoteOrigin(
							noteId,
							cleanHtml,
							draft.title || origin?.title || '',
						);
					}
				}
				dirtyRef.current = nextDirty;
				setDirty(nextDirty);
				return true;
			}
			applyingRemoteRef.current = true;
			try {
				editor.commands.setContent(draft.html, { emitUpdate: false });
				const normalized = editor.getHTML();
				if (nextDirty) {
					baselineHtmlRef.current = sharedBase;
				} else {
					const cleanHtml = draft.html || normalized;
					alignCleanBaseline(cleanHtml);
					pendingRemoteCleanRef.current = false;
					store.captureNoteOrigin(
						noteId,
						cleanHtml,
						draft.title || origin?.title || '',
					);
				}
				dirtyRef.current = nextDirty;
				setDirty(nextDirty);
			} finally {
				applyingRemoteRef.current = false;
			}
			return true;
		});
		return () => store.registerRemoteDraftApplier(null);
	}, [alignCleanBaseline, store]);

	useEffect(() => {
		store.registerRemoteSavedApplier((noteId, payload) => {
			if (store.editingId !== noteId) return false;
			const html = payload.html.trim();
			const paged = pagedSaveRef.current;
			const editor = editorRef.current;
			if (html && !paged && editor && !editor.isDestroyed) {
				if (editor.getHTML() !== html) {
					applyingRemoteRef.current = true;
					try {
						editor.commands.setContent(html, { emitUpdate: false });
					} finally {
						applyingRemoteRef.current = false;
					}
				}
				const cleanHtml = editor.getHTML();
				alignCleanBaseline(cleanHtml);
				store.captureNoteOrigin(noteId, cleanHtml, payload.title || '');
			} else if (html) {
				alignCleanBaseline(html);
				store.captureNoteOrigin(noteId, html, payload.title || '');
			} else {
				const cleanHtml = currentHtml();
				alignCleanBaseline(cleanHtml);
				store.captureNoteOrigin(noteId, cleanHtml, payload.title || '');
			}
			dirtyRef.current = false;
			remoteDirtyLockRef.current = false;
			pendingRemoteDirtyRef.current = false;
			pendingRemoteCleanRef.current = false;
			setDirty(false);
			return true;
		});
		return () => store.registerRemoteSavedApplier(null);
	}, [alignCleanBaseline, currentHtml, store]);

	/** 刷新/关页：keepalive 自动保存（SPA 切路由另走 leavePage；勿依赖 preview 卸载监听） */
	useEffect(() => {
		const onPageHide = () => {
			store.flushNoteOnPageHide();
			store.releaseHeldOriginSession();
		};
		window.addEventListener('pagehide', onPageHide);
		return () => window.removeEventListener('pagehide', onPageHide);
	}, [store]);

	const focusTitle = useCallback(() => {
		const editor = editorRef.current;
		if (!editor || editor.isDestroyed) return;
		const root = editor.view.dom.closest('.rich-editor');
		if (!root) return;
		const vp = root.querySelector(
			'[data-slot="scroll-area-viewport"]',
		) as HTMLElement | null;
		if (vp) vp.scrollTop = 0;
		const input = root.querySelector(
			'.rich-editor-note-title input',
		) as HTMLInputElement | null;
		input?.focus();
	}, []);

	const onSave = useCallback(async () => {
		if (!editorMatchesTarget()) return;
		const paged = pagedSaveRef.current;
		if (paged) {
			const title = paged.getTitle();
			const ok = await store.saveNote({
				title,
				text: paged.getText(),
				html: paged.getHTML(),
				dirty,
			});
			if (ok) markClean();
			else if (dirty && !title.trim()) focusTitle();
			return;
		}
		const editor = editorRef.current;
		if (!editor || editor.isDestroyed) return;
		const title = getDocTitleText(editor.state.doc).trim();
		const ok = await store.saveNote({
			title,
			text: editor.getText({ blockSeparator: '\n\n' }).trim(),
			html: editor.getHTML(),
			dirty,
		});
		if (ok) markClean();
		else if (dirty && !title) focusTitle();
	}, [dirty, editorMatchesTarget, focusTitle, markClean, store]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
			if (previewRef.current) return;
			e.preventDefault();
			if (savingRef.current) return;
			void onSave();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onSave]);

	const listToggleBtn = useCallback(
		() => (
			<Btn
				title={
					store.listOpen
						? t('learningNotes.closeList')
						: t('learningNotes.openList')
				}
				onClick={() => store.toggleListOpen()}
			>
				<NotebookText size={15} />
			</Btn>
		),
		[store.listOpen, t],
	);

	const popoutBtn = useCallback(() => {
		const mod = api.modules?.learningNotes;
		if (!mod?.openPopoutWindow || mod.isPopoutWindow()) return null;
		return (
			<Btn
				title={t('learningNotes.popout')}
				onClick={() => void mod.openPopoutWindow?.()}
			>
				<AppWindow size={15} />
			</Btn>
		);
	}, [api.modules?.learningNotes, t]);

	const toolbarExtra = useMemo(
		() => (
			<>
				<Btn title={t('learningNotes.new')} onClick={() => store.openNew()}>
					<FilePenLine size={15} />
				</Btn>
				{popoutBtn()}
				<Btn
					title={
						store.saving
							? t('learningNotes.saving')
							: store.saveTargetId
								? t('learningNotes.update')
								: t('learningNotes.save')
					}
					onClick={() => void onSave()}
					disabled={store.saving}
					className="relative"
				>
					<Save size={15} />
					{dirty ? (
						<span
							className="pointer-events-none absolute right-0 top-0 size-2 rounded-full bg-orange-500"
							aria-hidden
						/>
					) : null}
				</Btn>
				{store.editingId ? (
					<Btn
						title={t('learningNotes.preview')}
						onClick={() => {
							const id = store.editingId;
							if (id) void store.openPreview(id);
						}}
					>
						<Eye size={15} />
					</Btn>
				) : null}
				{listToggleBtn()}
			</>
		),
		[
			dirty,
			listToggleBtn,
			onSave,
			popoutBtn,
			store.editingId,
			store.saveTargetId,
			store.saving,
			t,
		],
	);

	const previewOwned = store.preview?.isOwned !== false;
	const previewHeaderExtra = useMemo(
		() => (
			<>
				<Btn title={t('learningNotes.new')} onClick={() => store.openNew()}>
					<FilePenLine size={15} />
				</Btn>
				{popoutBtn()}
				{previewOwned ? (
					<>
						<Btn
							title={t('learningNotes.edit')}
							disabled={store.loadingDetail}
							onClick={() => {
								if (store.preview) store.openEdit(store.preview);
							}}
						>
							<SquarePen size={15} />
						</Btn>
						<Btn
							title={t('learningNotes.delete')}
							onClick={() => {
								if (store.preview) store.requestDelete(store.preview.id);
							}}
						>
							<Trash2 size={15} />
						</Btn>
						<Btn
							title={
								store.exportingDocx
									? t('learningNotes.exportingDocx')
									: t('learningNotes.exportDocx')
							}
							disabled={store.exportingDocx || store.loadingDetail}
							onClick={() => void store.exportPreviewDocx()}
						>
							<FileDown size={15} />
						</Btn>
					</>
				) : null}
				{listToggleBtn()}
			</>
		),
		[
			listToggleBtn,
			popoutBtn,
			previewOwned,
			store.exportingDocx,
			store.loadingDetail,
			store.preview,
			t,
		],
	);

	const editorLocale = useMemo(() => richEditorLocaleOf(locale), [locale]);
	const editorKey = `${store.editorSeed}:${locale}`;
	const editorReady = readyKey === editorKey;
	const useLarge = isLargeNoteHtml(store.editorInitial);

	const onUploadImage = useCallback(
		(file: File) => store.uploadNoteImage(file),
		[],
	);

	// 先画 Loading，下一帧再挂 TipTap，避免长文解析时连遮罩都刷不出来
	useEffect(() => {
		if (store.preview) {
			setMountEditor(false);
			return;
		}
		setMountEditor(false);
		pagedSaveRef.current = null;
		const id = requestAnimationFrame(() => setMountEditor(true));
		return () => cancelAnimationFrame(id);
	}, [editorKey, store.preview]);

	return (
		<div
			className={cn(
				'bg-theme-background text-textcolor flex h-full min-h-0 min-w-0 flex-col text-sm rounded-md',
			)}
		>
			<Confirm
				open={store.confirmOpen}
				onOpenChange={(open) => store.setConfirmOpen(open)}
				title={t('learningNotes.deleteConfirmTitle')}
				description={t('learningNotes.deleteConfirmDesc')}
				onConfirm={() => void store.confirmDelete()}
			/>
			<Confirm
				open={store.visibilityConfirmOpen}
				onOpenChange={(open) => store.setVisibilityConfirmOpen(open)}
				title={
					store.pendingVisibility?.isPublic
						? t('learningNotes.publicConfirmTitle')
						: t('learningNotes.privateConfirmTitle')
				}
				description={
					store.pendingVisibility?.isPublic
						? t('learningNotes.publicConfirmDesc')
						: t('learningNotes.privateConfirmDesc')
				}
				onConfirm={() => void store.confirmVisibility()}
			/>
			<ResizablePanelGroup
				id="learning-notes-split"
				orientation="horizontal"
				className="h-full min-h-0 min-w-0 flex-1"
			>
				{store.listOpen ? (
					<>
						<ResizablePanel
							id="learning-notes-list"
							defaultSize={35}
							minSize={0}
							className="min-h-0 min-w-0 overflow-hidden!"
						>
							<NotesListPanel locale={locale} />
						</ResizablePanel>
						<ResizableHandle withHandle className="w-0 -translate-x-px" />
					</>
				) : null}
				<ResizablePanel
					id="learning-notes-editor"
					defaultSize={store.listOpen ? 65 : 100}
					minSize={0}
					className="min-h-0 min-w-0 overflow-hidden!"
				>
					<div className="border-theme/10 relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
						{!store.preview ? (
							<>
								{mountEditor ? (
									useLarge && typeof store.editorInitial === 'string' ? (
										<LargeNoteEditor
											key={editorKey}
											defaultContent={store.editorInitial}
											placeholder={t('learningNotes.placeholder')}
											locale={editorLocale}
											onUploadImage={onUploadImage}
											onReady={(e, save) => {
												editorRef.current = e;
												pagedSaveRef.current = save;
												editorBoundNoteIdRef.current = store.editingId;
												editorReadyEpochRef.current = editorEpochRef.current;
												applyEditorReadyDirty(save.getHTML());
												setReadyKey(editorKey);
											}}
											onChange={syncDirty}
											className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
											editorClassName="min-h-[6rem]"
											toolbarExtra={toolbarExtra}
										/>
									) : (
										<RichEditor
											key={editorKey}
											defaultContent={store.editorInitial}
											autofocus="end"
											placeholder={t('learningNotes.placeholder')}
											locale={editorLocale}
											showCharCount={false}
											onUploadImage={onUploadImage}
											onCreate={(e) => {
												editorRef.current = e;
												pagedSaveRef.current = null;
												editorBoundNoteIdRef.current = store.editingId;
												editorReadyEpochRef.current = editorEpochRef.current;
												applyEditorReadyDirty(e.getHTML());
												setReadyKey(editorKey);
											}}
											onChange={syncDirty}
											className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
											editorClassName="min-h-[6rem]"
											toolbarExtra={toolbarExtra}
										/>
									)
								) : null}
								{!editorReady ? (
									<div className="rounded-md absolute inset-0 z-10 flex items-center justify-center">
										<Loading />
									</div>
								) : null}
							</>
						) : (
							<div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden contain-[layout_paint]">
								{isLargeNoteHtml(store.preview.html) ? (
									<NotePreview
										title={store.preview.title}
										headerExtra={previewHeaderExtra}
										loading={store.loadingDetail}
										downloadBlob={api.ui?.downloadBlob}
									>
										<WindowedPreviewBody
											key={store.preview.id}
											html={store.preview.html}
											downloadBlob={api.ui?.downloadBlob}
										/>
									</NotePreview>
								) : (
									<NotePreview
										title={store.preview.title}
										html={store.preview.html}
										headerExtra={previewHeaderExtra}
										loading={store.loadingDetail}
										downloadBlob={api.ui?.downloadBlob}
									/>
								)}
								{store.loadingDetail ? (
									<div className="w-full h-full absolute inset-0 z-10 flex items-center justify-center">
										<Loading />
									</div>
								) : null}
							</div>
						)}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}

// LearningNotesApp.activate = async (api: HostBridgeProps['api']) => {
// 	console.log('[learning-notes] activate', api);
// };

LearningNotesApp.deactivate = () => {
	void learningNotesStore.leavePage().finally(() => {
		// 保留 listOpen，只丢列表缓存，下次进入若仍开着会重新拉
		learningNotesStore.clearList();
	});
};

export default observer(LearningNotesApp);
