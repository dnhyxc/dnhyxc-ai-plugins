import { useEffect } from 'react';
import type LearningNotesStore from '@/store/learningNotes';

type SyncMessage = {
	type: string;
	windowId?: string;
	noteId?: string;
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

type LearningNotesHostModule = {
	getWindowId(): string;
	isPopoutWindow(): boolean;
	consumeInitialNoteId(): string | null;
	connectStore(binding: {
		getEditingId(): string | null;
		getPreviewId(): string | null;
		refreshList(): Promise<void>;
		applyRemoteDraft(
			noteId: string,
			draft: {
				html: string;
				text: string;
				title: string;
				revision: number;
				uploadSessionId?: string | null;
				dirty?: boolean;
			},
		): void;
		applyRemoteSaved(
			noteId: string,
			payload: { html: string; title: string },
		): void;
		applyRemoteDeleted(noteId: string): void;
	}): () => void;
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
		requestState(noteId: string): void;
		subscribe(handler: (msg: SyncMessage) => void): () => void;
	};
};

type HostApi = {
	event?: {
		on: (event: string, handler: (data?: unknown) => void) => void;
		off: (event: string, handler: (data?: unknown) => void) => void;
	};
	modules?: { learningNotes?: LearningNotesHostModule };
};

export type { HostApi };

export type LearningNotesDraftReader = () => {
	noteId: string;
	html: string;
	text: string;
	title: string;
} | null;

const GLOBAL_STORE_KEY = '__DNHYXC_LN_STORE__';
const DRAFT_DEBOUNCE_MS = 180;
/** 切笔记后抑制外发草稿，避免把服务端旧正文推给对端覆盖未保存内容 */
const SUPPRESS_DRAFT_AFTER_OPEN_MS = 1000;

let suppressDraftUntil = 0;

function getHostModule(api: HostApi): LearningNotesHostModule | undefined {
	return api.modules?.learningNotes;
}

function beginAwaitRemoteSnapshot() {
	suppressDraftUntil = Date.now() + SUPPRESS_DRAFT_AFTER_OPEN_MS;
}

function endAwaitRemoteSnapshot() {
	suppressDraftUntil = 0;
}

export function useLearningNotesHostSync(
	api: HostApi,
	store: typeof LearningNotesStore,
) {
	useEffect(() => {
		const mod = getHostModule(api);
		if (!mod) return;

		(window as unknown as Record<string, unknown>)[GLOBAL_STORE_KEY] = store;

		const binding = {
			getEditingId: () => store.editingId,
			getPreviewId: () => store.preview?.id ?? null,
			refreshList: () => store.refreshListFromSync(),
			applyRemoteDraft: (
				noteId: string,
				draft: {
					html: string;
					text: string;
					title: string;
					revision: number;
					uploadSessionId?: string | null;
					dirty?: boolean;
				},
			) => {
				store.applyRemoteDraft(noteId, {
					html: draft.html,
					title: draft.title,
					uploadSessionId: draft.uploadSessionId,
					dirty: draft.dirty,
				});
			},
			applyRemoteSaved: (
				noteId: string,
				payload: { html: string; title: string },
			) => {
				store.applyRemoteSaved(noteId, payload);
			},
			applyRemoteDeleted: (noteId: string) => {
				store.applyRemoteDeleted(noteId);
			},
		};

		const disposers: Array<() => void> = [];
		disposers.push(mod.connectStore(binding));

		const initialId = mod.consumeInitialNoteId();
		if (initialId) {
			void store.openEditById(initialId);
		}

		return () => {
			for (const d of disposers) d();
			delete (window as unknown as Record<string, unknown>)[GLOBAL_STORE_KEY];
		};
	}, [api, store]);

	/** 切到同一笔记（编辑或预览）：广播 selection，并向对端拉未保存草稿 */
	useEffect(() => {
		const mod = getHostModule(api);
		if (!mod) return;
		// 预览优先：UI 以 preview 为准，不能被残留 editingId 抢 noteId
		const noteId = store.preview?.id ?? store.editingId ?? null;
		mod.sync.publishSelection({
			noteId,
			mode: store.preview ? 'preview' : store.editingId ? 'edit' : null,
		});
		if (!noteId) {
			endAwaitRemoteSnapshot();
			return undefined;
		}
		// loadingDetail 期间也要拉：对端快照进 pending，避免 detail 用服务端旧稿盖掉
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

	/** 对端回包 state-snapshot：结束外发抑制（正文由 connectStore 单路应用） */
	useEffect(() => {
		const mod = getHostModule(api);
		if (!mod?.sync.subscribe) return;
		const localId = mod.getWindowId();
		return mod.sync.subscribe((msg) => {
			if (msg.type !== 'state-snapshot' || msg.windowId === localId) return;
			const noteId = store.preview?.id ?? store.editingId ?? null;
			if (!msg.noteId || msg.noteId !== noteId) return;
			endAwaitRemoteSnapshot();
		});
	}, [api, store]);
}

const draftRevisionRef = { current: 0 };
let draftDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 编辑器 onChange 时 debounce 广播草稿；dirty→clean 立即发，避免对端一直脏 */
export function scheduleLearningNotesDraftPublish(
	api: HostApi,
	draft: NonNullable<ReturnType<LearningNotesDraftReader>>,
	uploadSessionId?: string | null,
	dirty?: boolean,
) {
	if (Date.now() < suppressDraftUntil) return;
	const mod = getHostModule(api);
	if (!mod) return;
	const publish = () => {
		if (Date.now() < suppressDraftUntil) return;
		draftRevisionRef.current += 1;
		mod.sync.publishDraft({
			...draft,
			revision: draftRevisionRef.current,
			uploadSessionId: uploadSessionId ?? null,
			dirty: dirty ?? true,
		});
	};
	if (draftDebounceTimer) clearTimeout(draftDebounceTimer);
	// 变干净必须马上广播，否则 debounce 期间对端仍显示未保存
	if (dirty === false) {
		draftDebounceTimer = null;
		publish();
		return;
	}
	draftDebounceTimer = setTimeout(publish, DRAFT_DEBOUNCE_MS);
}
