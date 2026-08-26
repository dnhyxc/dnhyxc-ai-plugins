import { useEffect } from 'react';
import type LearningNotesStore from '@/store/learningNotes';
import { hasNoteBodyContent } from '@/views/learning-notes/utils/doc';

/** 与 Host learningNotesSyncBus 消息形状对齐（插件侧消费） */
type SyncMessage = {
	type: string;
	windowId?: string;
	noteId?: string;
	html?: string;
	text?: string;
	title?: string;
	revision?: number;
	uploadSessionId?: string | null;
	dirty?: boolean;
	mode?: 'edit' | 'preview' | null;
	reason?: string;
	updatedAt?: string;
	draft?: {
		html: string;
		text: string;
		title: string;
		revision: number;
		dirty?: boolean;
		uploadSessionId?: string | null;
	};
	preview?: { html: string; title: string };
};

/** 学习笔记 Host 模块类型 */
type LearningNotesHostModule = {
	getWindowId(): string;
	isPopoutWindow(): boolean;
	openPopoutWindow?(): Promise<void>;
	consumeInitialNoteId(): string | null;
	registerBeforeClose?(fn: () => void | Promise<void>): () => void;
	sync: {
		publishSelection(payload: {
			noteId: string | null;
			mode: 'edit' | 'preview' | null;
		}): void;
		publishDraft(payload: {
			noteId: string;
			html: string;
			text: string;
			title: string;
			revision: number;
			uploadSessionId?: string | null;
			dirty?: boolean;
		}): void;
		publishSaved?(payload: {
			noteId: string;
			html: string;
			title: string;
			updatedAt?: string;
		}): void;
		publishDeleted?(noteId: string): void;
		publishListChanged?(reason?: string): void;
		requestState(noteId: string): void;
		publishStateSnapshot?(payload: {
			noteId: string;
			draft?: {
				html: string;
				text: string;
				title: string;
				revision: number;
				dirty?: boolean;
				uploadSessionId?: string | null;
			};
			preview?: { html: string; title: string };
		}): void;
		subscribe(handler: (msg: SyncMessage) => void): () => void;
	};
};

/** Host API 类型 */
type HostApi = {
	event?: {
		on: (event: string, handler: (data?: unknown) => void) => void;
		off: (event: string, handler: (data?: unknown) => void) => void;
	};
	modules?: { learningNotes?: LearningNotesHostModule };
};

/** 学习笔记草稿读取器类型 */
export type { HostApi };

/** 学习笔记草稿读取器类型 */
export type LearningNotesDraftReader = () => {
	noteId: string;
	html: string;
	text: string;
	title: string;
} | null;

/** 草稿防抖延迟 */
const DRAFT_DEBOUNCE_MS = 180;
/** 切笔记后抑制外发草稿，避免把服务端旧正文推给对端覆盖未保存内容 */
const SUPPRESS_DRAFT_AFTER_OPEN_MS = 1000;

let suppressDraftUntil = 0;

function getHostModule(api: HostApi): LearningNotesHostModule | undefined {
	return api.modules?.learningNotes;
}

function getEditingId(store: typeof LearningNotesStore): string | null {
	return store.editingId;
}

function getPreviewId(store: typeof LearningNotesStore): string | null {
	return store.preview?.id ?? null;
}

/**
 * 远端同步消息分发（原 Host learningNotesStoreSync.handleRemoteMessage）。
 * 行为保持不变：回声过滤 → 按 type 调 store.applyRemote* / refreshList。
 */
function handleRemoteSyncMessage(
	msg: SyncMessage,
	store: typeof LearningNotesStore,
	localWindowId: string,
) {
	if (msg.windowId === localWindowId) return;

	switch (msg.type) {
		case 'list-changed':
			void store.refreshListFromSync();
			break;
		case 'deleted':
			if (msg.noteId) {
				store.applyRemoteDeleted(msg.noteId);
				void store.refreshListFromSync();
			}
			break;
		case 'saved':
			if (
				msg.noteId &&
				(getPreviewId(store) === msg.noteId ||
					getEditingId(store) === msg.noteId)
			) {
				store.applyRemoteSaved(msg.noteId, {
					html: msg.html ?? '',
					title: msg.title ?? '',
				});
			}
			void store.refreshListFromSync();
			break;
		case 'draft':
			if (
				msg.noteId &&
				(getEditingId(store) === msg.noteId ||
					getPreviewId(store) === msg.noteId)
			) {
				store.applyRemoteDraft(msg.noteId, {
					html: msg.html ?? '',
					title: msg.title ?? '',
					uploadSessionId: msg.uploadSessionId,
					dirty: msg.dirty,
				});
			}
			break;
		case 'state-snapshot':
			if (
				!msg.noteId ||
				(getEditingId(store) !== msg.noteId &&
					getPreviewId(store) !== msg.noteId)
			) {
				break;
			}
			if (msg.draft?.html.trim()) {
				store.applyRemoteDraft(msg.noteId, {
					html: msg.draft.html,
					title: msg.draft.title,
					uploadSessionId: msg.draft.uploadSessionId,
					dirty: msg.draft.dirty,
				});
			} else if (msg.preview?.html.trim()) {
				store.applyRemoteDraft(msg.noteId, {
					html: msg.preview.html,
					title: msg.preview.title,
				});
			}
			break;
		default:
			break;
	}
}

/** 本窗正在看 noteId 时，把未保存草稿/预览推给对端 */
function publishLocalStateSnapshot(
	mod: LearningNotesHostModule,
	store: typeof LearningNotesStore,
	noteId: string,
) {
	if (!mod.sync.publishStateSnapshot) return;
	const editing = store.editingId === noteId;
	const previewing = store.preview?.id === noteId;
	if (!editing && !previewing) return;

	const snap = editing ? store.takeEditorSnapshot() : null;
	const draft =
		snap && (snap.html.trim() || snap.dirty)
			? {
					html: snap.html,
					text: snap.text,
					title: snap.title,
					revision: Date.now(),
					dirty: snap.dirty,
					uploadSessionId: store.uploadSessionId ?? null,
				}
			: undefined;

	const preview = previewing
		? {
				html: store.preview?.html ?? '',
				title: store.preview?.title ?? '',
			}
		: undefined;

	// 切篇空隙快照为空时不要推，避免对端用空稿清掉未保存内容
	if (!draft && !preview) return;

	mod.sync.publishStateSnapshot({
		noteId,
		draft,
		preview,
	});
}

/** 关窗前保存：插件业务；Host 仅 await registerBeforeClose 回调 */
async function saveLearningNotesOnWindowClose(
	api: HostApi,
	store: typeof LearningNotesStore,
): Promise<void> {
	(document.activeElement as HTMLElement | null)?.blur?.();
	if (store.preview) return;

	const snap = store.takeEditorSnapshot();
	let saved = false;

	if (snap?.dirty) {
		saved = await store.autoSaveIfDirty({ silent: true });
	}

	// 仅在仍脏时重试；勿对「无 id + 不脏」强制 save，否则会反复 POST 出同标题副本
	if (!saved && snap?.dirty && hasNoteBodyContent(snap.html, snap.text)) {
		saved = await store.saveNote(
			{
				title: snap.title,
				html: snap.html,
				text: snap.text,
				dirty: true,
			},
			{ silent: true, auto: true },
		);
	}

	if (!saved) {
		store.flushNoteOnPageHide();
		saved = Boolean(snap?.dirty);
	}

	/** 释放笔记原始基线会话 */
	store.releaseHeldOriginSession();

	if (saved) {
		getHostModule(api)?.sync.publishListChanged?.('popout-close-save');
	}
}

/** 开始等待远端快照 */
function beginAwaitRemoteSnapshot() {
	suppressDraftUntil = Date.now() + SUPPRESS_DRAFT_AFTER_OPEN_MS;
}

/** 结束等待远端快照 */
function endAwaitRemoteSnapshot() {
	suppressDraftUntil = 0;
}

/** 使用学习笔记 Host 同步 */
export function useLearningNotesHostSync(
	api: HostApi,
	store: typeof LearningNotesStore,
) {
	useEffect(() => {
		const mod = getHostModule(api);
		if (!mod) return;

		store.bindSyncPublish({
			saved: (payload) => mod.sync.publishSaved?.(payload),
			deleted: (noteId) => mod.sync.publishDeleted?.(noteId),
			listChanged: (reason) => mod.sync.publishListChanged?.(reason),
		});

		const localWindowId = mod.getWindowId();
		store.bindLocalWindowId(localWindowId);
		const disposers: Array<() => void> = [];

		/** 订总线：入站分发 + 出站 snapshot 应答（原 connectStore + Host 分发） */
		disposers.push(
			mod.sync.subscribe((msg) => {
				if (msg.windowId === localWindowId) return;

				if (msg.type === 'request-state' && msg.noteId) {
					publishLocalStateSnapshot(mod, store, msg.noteId);
					return;
				}

				if (msg.type === 'selection' && msg.noteId) {
					if (store.editingId !== msg.noteId) return;
					const snap = store.takeEditorSnapshot();
					if (snap?.dirty) publishLocalStateSnapshot(mod, store, msg.noteId);
					return;
				}

				handleRemoteSyncMessage(msg, store, localWindowId);

				if (msg.type === 'state-snapshot') {
					const noteId = store.preview?.id ?? store.editingId ?? null;
					if (msg.noteId && msg.noteId === noteId) {
						endAwaitRemoteSnapshot();
					}
				}
			}),
		);

		if (mod.isPopoutWindow() && mod.registerBeforeClose) {
			disposers.push(
				mod.registerBeforeClose(() =>
					saveLearningNotesOnWindowClose(api, store),
				),
			);
		}

		const initialId = mod.consumeInitialNoteId();
		if (initialId) {
			void store.openEditById(initialId);
		}

		return () => {
			for (const d of disposers) d();
			store.bindSyncPublish(null);
		};
	}, [api, store]);

	/** 切到同一笔记（编辑或预览）：广播 selection，并向对端拉未保存草稿 */
	useEffect(() => {
		const mod = getHostModule(api);
		if (!mod) return;
		const noteId = store.preview?.id ?? store.editingId ?? null;
		mod.sync.publishSelection({
			noteId,
			mode: store.preview ? 'preview' : store.editingId ? 'edit' : null,
		});
		if (!noteId) {
			endAwaitRemoteSnapshot();
			return undefined;
		}
		beginAwaitRemoteSnapshot();
		mod.sync.requestState(noteId);
		const retry = window.setTimeout(() => {
			mod.sync.requestState(noteId);
		}, 320);
		const timer = window.setTimeout(
			endAwaitRemoteSnapshot,
			SUPPRESS_DRAFT_AFTER_OPEN_MS,
		);
		return () => {
			window.clearTimeout(retry);
			window.clearTimeout(timer);
		};
	}, [api, store.editingId, store.preview?.id, store.loadingDetail]);
}

const draftRevisionRef = { current: 0 };
let draftDebounceTimer: ReturnType<typeof setTimeout> | null = null;
/** 每次调度递增；过期 timer 回调直接丢弃，避免保存/撤回后仍推 dirty:true */
let draftPublishGen = 0;

/** 取消未发出的防抖草稿（保存成功 / 离页时调用） */
export function cancelScheduledLearningNotesDraftPublish() {
	draftPublishGen += 1;
	if (draftDebounceTimer) {
		clearTimeout(draftDebounceTimer);
		draftDebounceTimer = null;
	}
}

/** 编辑器 onChange 时 debounce 广播草稿；dirty→clean 立即发 */
export function scheduleLearningNotesDraftPublish(
	api: HostApi,
	draft: NonNullable<ReturnType<LearningNotesDraftReader>>,
	uploadSessionId?: string | null,
	dirty?: boolean,
) {
	const mod = getHostModule(api);
	if (!mod) return;

	// 切篇后抑制 dirty:true，避免旧正文盖对端未保存稿；dirty:false 必须放行
	if (dirty !== false && Date.now() < suppressDraftUntil) return;

	const gen = ++draftPublishGen;
	if (draftDebounceTimer) {
		clearTimeout(draftDebounceTimer);
		draftDebounceTimer = null;
	}

	const publish = () => {
		if (gen !== draftPublishGen) return;
		if (dirty !== false && Date.now() < suppressDraftUntil) return;
		draftRevisionRef.current += 1;
		mod.sync.publishDraft({
			...draft,
			revision: draftRevisionRef.current,
			uploadSessionId: uploadSessionId ?? null,
			dirty: dirty ?? true,
		});
	};

	if (dirty === false) {
		publish();
		return;
	}
	draftDebounceTimer = setTimeout(publish, DRAFT_DEBOUNCE_MS);
}
