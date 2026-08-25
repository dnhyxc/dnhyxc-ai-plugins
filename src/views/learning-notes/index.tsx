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
	Eye,
	FileDown,
	FilePenLine,
	NotebookText,
	Save,
	SquarePen,
	Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Confirm from '@/components/design/Confirm';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { useHostLocale, useI18n } from '@/hooks';
import type { Locale } from '@/i18n';
import { cn } from '@/lib/utils';
import useStore from '@/store';
import learningNotesStore from '@/store/learningNotes';
import type { HostHttp } from './api';
import { LargeNoteEditor, type LargeNoteSaveApi } from './components/Editor';
import { NotesListPanel } from './components/NotesListPanel';
import { WindowedPreviewBody } from './components/PreviewBody';
import {
	type HostApi,
	scheduleLearningNotesDraftPublish,
	useLearningNotesHostSync,
} from './useLearningNotesHostSync';
import { isLargeNoteHtml } from './utils';
import '@/styles.css';

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

function LearningNotesApp({ api }: HostBridgeProps) {
	const { learningNotesStore: store } = useStore();
	const { t, locale } = useI18n();
	useHostLocale(api);
	useLearningNotesHostSync(api, store);

	const editorRef = useRef<Editor | null>(null);
	const pagedSaveRef = useRef<LargeNoteSaveApi | null>(null);
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
	}, [alignCleanBaseline, currentHtml]);

	const applyEditorReadyDirty = useCallback(
		(html: string) => {
			const forceClean = pendingRemoteCleanRef.current;
			pendingRemoteCleanRef.current = false;
			if (forceClean) {
				remoteDirtyLockRef.current = false;
				pendingRemoteDirtyRef.current = false;
				pendingRemoteBaselineRef.current = '';
				alignCleanBaseline(html);
				dirtyRef.current = false;
				setDirty(false);
				return;
			}
			const openBase = openBaselineRef.current;
			const tipTapBase = baselineHtmlRef.current || openBase;
			const pending = pendingRemoteDirtyRef.current;
			pendingRemoteDirtyRef.current = false;
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
			// 首次挂载干净：用 TipTap 序列化结果作基线，后续删回才能判干净
			alignCleanBaseline(html);
			dirtyRef.current = false;
			setDirty(false);
		},
		[alignCleanBaseline],
	);

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
		if (!noteId) return null;
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
	}, [store.editingId]);

	const syncDirty = useCallback(() => {
		if (applyingRemoteRef.current) return;
		const html = currentHtml();
		// 优先 TipTap 基线；锁不参与脏判断，只防 remount 丢标记
		const baseline = baselineHtmlRef.current || openBaselineRef.current;
		const nextDirty = !editorHtmlEquals(html, baseline);
		const wasDirty = dirtyRef.current;
		if (!nextDirty) {
			remoteDirtyLockRef.current = false;
			pendingRemoteDirtyRef.current = false;
			pendingRemoteCleanRef.current = false;
			alignCleanBaseline(html);
		}
		dirtyRef.current = nextDirty;
		setDirty(nextDirty);
		if (wasDirty && !nextDirty) {
			void store.settleUploadSessionIfNeeded(html);
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
	}, [alignCleanBaseline, api, currentHtml, readDraft, store]);

	useEffect(() => {
		store.bind(api.http, toast, t, api.ui?.downloadBlob);
	}, [api.http, api.ui?.downloadBlob, toast, t]);

	useEffect(() => {
		store.registerEditorSnapshot(() => {
			if (store.preview) return null;
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
	}, [store.preview]);

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

			// dirty:false 权威清脏；否则正文相对 TipTap 基线（忽略对端误报的 dirty:true）
			const nextDirty =
				draft.dirty === false
					? false
					: !editorHtmlEquals(draft.html, tipTapBase);

			if (nextDirty) {
				remoteDirtyLockRef.current = true;
				pendingRemoteCleanRef.current = false;
			} else {
				remoteDirtyLockRef.current = false;
				pendingRemoteDirtyRef.current = false;
				pendingRemoteCleanRef.current = true;
				dirtyRef.current = false;
				setDirty(false);
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
			if (editor.getHTML() === draft.html) {
				if (nextDirty) {
					baselineHtmlRef.current = tipTapBase;
				} else {
					alignCleanBaseline(editor.getHTML());
					pendingRemoteCleanRef.current = false;
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
					baselineHtmlRef.current = tipTapBase;
				} else {
					alignCleanBaseline(normalized);
					pendingRemoteCleanRef.current = false;
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
				alignCleanBaseline(editor.getHTML());
			} else if (html) {
				alignCleanBaseline(html);
			} else {
				alignCleanBaseline(currentHtml());
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

	/** 刷新/关页/离开 Host 路由：keepalive 自动保存 */
	useEffect(() => {
		if (store.preview) return;
		const onPageHide = () => store.flushNoteOnPageHide();
		window.addEventListener('pagehide', onPageHide);
		return () => window.removeEventListener('pagehide', onPageHide);
	}, [store.preview]);

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
	}, [focusTitle, markClean, dirty]);

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

	const toolbarExtra = useMemo(
		() => (
			<>
				<Btn title={t('learningNotes.new')} onClick={() => store.openNew()}>
					<FilePenLine size={15} />
				</Btn>
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

LearningNotesApp.activate = async (api: HostBridgeProps['api']) => {
	console.log('[learning-notes] activate', api);
};

LearningNotesApp.deactivate = () => {
	void learningNotesStore.autoSaveIfDirty({ silent: true });
};

export default observer(LearningNotesApp);
