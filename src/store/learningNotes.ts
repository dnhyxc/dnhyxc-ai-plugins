import { EMPTY_NOTE_DOC } from '@design/RichEditor';
import { makeAutoObservable, runInAction } from 'mobx';
import { translateSync } from '@/i18n';
import {
	acquireNoteOriginSession,
	ensureSharedNoteOrigin,
	getLocalNoteOriginWindowId,
	type NoteOriginSnapshot,
	readSharedNoteOrigin,
	releaseNoteOriginSession,
	removeNoteOriginSession,
	writeSharedNoteOrigin,
} from '@/utils/noteOrigin';
import {
	createNotesApi,
	discardUploadSessionKeepalive,
	type HostHttp,
	NOTES_PAGE_SIZE,
	type Note,
	type NotesApi,
	saveNoteKeepalive,
	settleUploadSessionKeepalive,
} from '@/views/learning-notes/api';
import { hasNoteBodyContent } from '@/views/learning-notes/utils/doc';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;
type TFn = (key: string, params?: Record<string, unknown>) => string;

type HostDownloadBlob = (options: {
	fileName: string;
	data: ArrayBuffer | Uint8Array;
	mimeType?: string;
}) => Promise<{ ok: boolean; hostToasted: boolean; message?: string }>;

/** 页面注入：读取当前编辑器快照（离页自动保存用） */
export type NoteEditorSnapshot = {
	title: string;
	html: string;
	text: string;
	dirty: boolean;
};

const DOCX_MIME =
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Host `http.*` 失败时 fetch 层已 Toast；仅本地 Error（如导出校验）再提示 */
function toastUnlessHostHttp(toast: ToastFn, e: unknown, t: TFn) {
	if (e instanceof Error)
		toast(e.message || t('common.requestFailed'), 'error');
}

/**
 * 学习笔记域 store（对齐主站 MobX 单例模式）。
 * HTTP 由页面 bind(http, toast, t) 注入，列表分页与编辑态集中在此。
 */
class LearningNotesStore {
	private api: NotesApi | null = null;
	private toast: ToastFn = () => {};
	private t: TFn = translateSync;
	/** Host 透传的 downloadBlob（Web / Tauri2）；独立预览可由 mock 注入 */
	private downloadBlob: HostDownloadBlob | null = null;
	private syncPublish: {
		saved?: (payload: { noteId: string; html: string; title: string }) => void;
		deleted?: (noteId: string) => void;
		listChanged?: (reason?: string) => void;
	} | null = null;
	private editorSnapshotReader: (() => NoteEditorSnapshot | null) | null = null;
	/**
	 * 编辑过程中缓存的离页快照。SPA 路由离开时编辑器先卸载，
	 * takeEditorSnapshot 会读空，需靠此缓存才能自动保存。
	 */
	private leaveSnap: (NoteEditorSnapshot & { noteId: string | null }) | null =
		null;
	private remoteDraftApplier:
		| ((
				noteId: string,
				draft: {
					html: string;
					title: string;
					uploadSessionId?: string | null;
					dirty?: boolean;
				},
		  ) => boolean)
		| null = null;
	private remoteSavedApplier:
		| ((noteId: string, payload: { html: string; title: string }) => boolean)
		| null = null;
	/** detail 返回前对端推送的未保存草稿，避免被服务端正文盖掉 */
	private pendingPeerDraft: {
		noteId: string;
		html: string;
		title: string;
		uploadSessionId?: string | null;
		dirty?: boolean;
		/** 服务端干净正文；预览→编辑时用作 dirty 基线 */
		baselineHtml?: string;
	} | null = null;
	/** 当前篇服务端干净正文（预览合并对端草稿后仍保留） */
	private savedBaselineHtml: string | null = null;
	/**
	 * 当前篇共享原始基线（主/子窗同一份，存 localStorage）。
	 * 脏判断只对比它，避免各窗本地 TipTap 基线漂移。
	 */
	private noteOrigin: NoteOriginSnapshot | null = null;
	/** 与 Host learningNotesSyncBus 一致的本窗 windowId */
	private localWindowId: string | null = null;
	/** 本窗已通过 acquire 登记的 noteId（切篇/离页时 release） */
	private heldOriginNoteId: string | null = null;

	/** 列表（分页累积） */
	list: Note[] = [];
	total = 0;
	pageNo = 1;
	pageSize = NOTES_PAGE_SIZE;
	loading = false;
	loadingMore = false;
	/** 列表已有数据时的刷新，不卸列表 */
	refreshing = false;

	listOpen = false;
	preview: Note | null = null;
	loadingDetail = false;
	editingId: string | null = null;
	/**
	 * 正文所属笔记 id。预览会清空 editingId，但保存必须仍能 update，
	 * 否则偶发 POST /save 把已有笔记存成副本。
	 */
	boundNoteId: string | null = null;
	/**
	 * 新建/编辑共用的上传会话：图片先记 pending，
	 * 保存时认领正文图；内容回到基线或放弃会话时回收。
	 */
	uploadSessionId: string | null = null;
	/** 本窗创建的会话才可 discard；对端 adopt 的会话丢弃时只摘引用 */
	uploadSessionOwned = true;
	editorSeed = 0;
	editorInitial: string | typeof EMPTY_NOTE_DOC = EMPTY_NOTE_DOC;
	saving = false;
	confirmOpen = false;
	pendingDeleteId: string | null = null;
	/** 公开/取消公开确认 */
	visibilityConfirmOpen = false;
	pendingVisibility: { id: string; isPublic: boolean } | null = null;
	exportingDocx = false;

	constructor() {
		makeAutoObservable(this, {}, { autoBind: true });
	}

	bind(
		http: HostHttp | undefined,
		toast: ToastFn,
		t?: TFn,
		downloadBlob?: HostDownloadBlob,
	) {
		this.api = http ? createNotesApi(http) : null;
		this.toast = toast;
		this.downloadBlob = downloadBlob ?? null;
		if (t) this.t = t;
	}

	/** 跨窗同步：保存/删除后由插件显式 publish（不再依赖 Host HTTP 包装） */
	bindSyncPublish(
		sync: {
			saved?: (payload: {
				noteId: string;
				html: string;
				title: string;
			}) => void;
			deleted?: (noteId: string) => void;
			listChanged?: (reason?: string) => void;
		} | null,
	) {
		this.syncPublish = sync;
	}

	/** 由 useNoteHostSync 注入，与 Host getWindowId() 一致 */
	bindLocalWindowId(windowId: string | null | undefined): void {
		this.localWindowId = windowId?.trim() || null;
	}

	/**
	 * 读取共享原始基线。优先 localStorage（主/子窗写入的权威源），
	 * 避免内存缓存挡住对端刚写入的基线。
	 */
	getNoteOrigin(noteId: string | null | undefined): NoteOriginSnapshot | null {
		if (!noteId) return null;
		const shared = readSharedNoteOrigin(noteId);
		if (shared) {
			this.noteOrigin = shared;
			return shared;
		}
		return this.noteOrigin?.noteId === noteId ? this.noteOrigin : null;
	}

	/**
	 * 覆盖写入共享原始基线（保存成功 / 明确以服务端为准时）。
	 * 主子窗经 localStorage 共用同一份。
	 */
	captureNoteOrigin(noteId: string, html: string, title: string): void {
		if (!noteId) return;
		const snap = writeSharedNoteOrigin(noteId, html, title);
		if (snap) {
			this.noteOrigin = snap;
			this.savedBaselineHtml = html;
		}
	}

	/**
	 * 尚无共享基线时写入（首窗编辑器 ready 后 TipTap 规范化稿抢占）。
	 * 他窗打开同篇时沿用已有基线，不再各自重建。
	 */
	ensureNoteOrigin(
		noteId: string,
		html: string,
		title: string,
	): NoteOriginSnapshot | null {
		if (!noteId) return null;
		const snap = ensureSharedNoteOrigin(noteId, html, title);
		if (snap) {
			this.noteOrigin = snap;
			if (!this.savedBaselineHtml) this.savedBaselineHtml = snap.html;
		}
		return snap;
	}

	/** 相对共享原始基线是否脏（标题或正文任一不同） */
	isDirtyAgainstOrigin(
		noteId: string | null | undefined,
		html: string,
		title?: string,
	): boolean {
		const origin = this.getNoteOrigin(noteId);
		if (!origin) return false;
		if (html !== origin.html) return true;
		if (title !== undefined && title.trim() !== origin.title.trim())
			return true;
		return false;
	}

	clearNoteOrigin(noteId: string | null | undefined): void {
		if (!noteId) return;
		removeNoteOriginSession(noteId);
		if (this.noteOrigin?.noteId === noteId) this.noteOrigin = null;
		if (this.heldOriginNoteId === noteId) this.heldOriginNoteId = null;
	}

	private originWindowId(): string {
		return this.localWindowId ?? getLocalNoteOriginWindowId();
	}

	private sessionNoteId(): string | null {
		return this.editingId ?? this.preview?.id ?? this.boundNoteId;
	}

	private acquireOriginSession(noteId: string | null | undefined): void {
		const windowId = this.originWindowId();
		if (!noteId) return;
		if (this.heldOriginNoteId === noteId) return;
		if (this.heldOriginNoteId && this.heldOriginNoteId !== noteId) {
			this.releaseOriginSession(this.heldOriginNoteId);
		}
		acquireNoteOriginSession(noteId, windowId);
		this.heldOriginNoteId = noteId;
	}

	/**
	 * 本窗离开该篇；仅当所有窗都 release 后才清 localStorage 基线。
	 * 本窗内存 noteOrigin 总是清掉，避免切走后仍误用。
	 */
	private releaseOriginSession(noteId: string | null | undefined): void {
		if (!noteId) return;
		const windowId = this.originWindowId();
		const lastHolder = releaseNoteOriginSession(noteId, windowId);
		if (this.heldOriginNoteId === noteId) this.heldOriginNoteId = null;
		if (this.noteOrigin?.noteId === noteId) this.noteOrigin = null;
		if (lastHolder) removeNoteOriginSession(noteId);
	}

	private releaseOriginSessionIfLeaving(
		prevId: string | null | undefined,
		nextId: string | null | undefined,
	): void {
		if (!prevId || prevId === nextId) return;
		this.releaseOriginSession(prevId);
	}

	/** 刷新/关页：释放 holder，避免泄漏导致基线永不清 */
	releaseHeldOriginSession(): void {
		const id = this.heldOriginNoteId ?? this.sessionNoteId();
		if (id) this.releaseOriginSession(id);
	}

	registerEditorSnapshot(fn: (() => NoteEditorSnapshot | null) | null): void {
		this.editorSnapshotReader = fn;
	}

	/** 关窗 / 跨窗 / 离页 snapshot：优先读编辑器；已卸载则回落到离页缓存 */
	takeEditorSnapshot(): NoteEditorSnapshot | null {
		const live = this.editorSnapshotReader?.() ?? null;
		if (live) return live;
		const stashed = this.leaveSnap;
		if (!stashed) return null;
		const target = this.editingId ?? this.boundNoteId;
		// 切篇空隙：有明确 target 且缓存是另一篇时丢弃；target 已空（卸载途中）仍用缓存
		if (target && stashed.noteId && stashed.noteId !== target) return null;
		return stashed;
	}

	/** 编辑 onChange 时写入；预览/无效编辑器时清掉 */
	stashLeaveSnap(
		snap: (NoteEditorSnapshot & { noteId: string | null }) | null,
	): void {
		this.leaveSnap = snap;
	}

	/** SPA 离页：用缓存快照静默保存（编辑器可能已卸载） */
	async flushLeaveSnap(): Promise<boolean> {
		if (this.saving || this.preview) return false;
		const snap = this.takeEditorSnapshot();
		if (!snap?.dirty) return false;
		if (!hasNoteBodyContent(snap.html, snap.text) && !snap.title.trim()) {
			return false;
		}
		const ok = await this.saveNote(
			{
				title: snap.title,
				html: snap.html,
				text: snap.text,
				dirty: true,
			},
			{ silent: true, auto: true },
		);
		if (ok && this.leaveSnap) {
			this.leaveSnap = { ...this.leaveSnap, dirty: false };
		}
		return ok;
	}

	/**
	 * 离开学习笔记页：清编辑/预览选中态（保留 listOpen）。
	 * 重进不再挂着旧 editingId + editorInitial，避免用过期正文顶掉服务端最新稿。
	 */
	resetEditorSession(): void {
		this.releaseHeldOriginSession();
		this.preview = null;
		this.editingId = null;
		this.boundNoteId = null;
		this.pendingPeerDraft = null;
		this.savedBaselineHtml = null;
		this.leaveSnap = null;
		this.loadingDetail = false;
		this.confirmOpen = false;
		this.pendingDeleteId = null;
		this.visibilityConfirmOpen = false;
		this.pendingVisibility = null;
		this.editorInitial = EMPTY_NOTE_DOC;
		this.editorSeed += 1;
		void this.discardUploadSession();
	}

	/**
	 * 离页：先保存脏稿，再清选中（顺序不能反，否则 saveTargetId 丢失会误新建）。
	 * SPA 切路由时 Host 仍在，必须走 Host http；keepalive 仅作刷新/关页兜底，
	 * 且插件 env 常无 API domain，keepalive 可能空操作。
	 */
	async leavePage(): Promise<void> {
		// 子树/reader 可能已卸：take 失败时直接用 leaveSnap（须在 reset 前）
		const snap =
			this.takeEditorSnapshot() ??
			(this.leaveSnap?.dirty ? this.leaveSnap : null);
		if (
			snap?.dirty &&
			!this.preview &&
			(hasNoteBodyContent(snap.html, snap.text) || snap.title.trim())
		) {
			const ok = await this.saveNote(
				{
					title: snap.title,
					html: snap.html,
					text: snap.text,
					dirty: true,
				},
				{ silent: true, auto: true },
			);
			// Host http 失败时再 keepalive 兜底（刷新/关页同路径）
			if (!ok) {
				const noteId = this.saveTargetId;
				const title = snap.title.trim() || this.t('common.untitledNote');
				saveNoteKeepalive({
					id: noteId,
					title,
					html: snap.html,
					uploadSessionId: this.uploadSessionId,
				});
				this.notifyPeerSavedAfterKeepalive(noteId, snap.html, title);
			}
		} else if (!this.preview) {
			// 无脏稿：结算/丢弃上传会话
			this.flushNoteOnPageHide();
		}
		this.resetEditorSession();
	}

	registerRemoteDraftApplier(
		fn:
			| ((
					noteId: string,
					draft: {
						html: string;
						title: string;
						uploadSessionId?: string | null;
						dirty?: boolean;
					},
			  ) => boolean)
			| null,
	): void {
		this.remoteDraftApplier = fn;
	}

	registerRemoteSavedApplier(
		fn:
			| ((noteId: string, payload: { html: string; title: string }) => boolean)
			| null,
	): void {
		this.remoteSavedApplier = fn;
	}

	/** 切笔记 / 新建 / 离页前：有改动则静默保存 */
	async autoSaveIfDirty(opts?: { silent?: boolean }): Promise<boolean> {
		if (this.saving || this.preview) return false;
		const snap = this.takeEditorSnapshot();
		if (!snap) return false;
		if (!snap.dirty) {
			await this.settleUploadSessionIfNeeded(snap.html);
			return false;
		}
		return this.saveNote(
			{
				title: snap.title,
				html: snap.html,
				text: snap.text,
				dirty: true,
			},
			{ silent: opts?.silent ?? true, auto: true },
		);
	}

	/** 离开编辑区：先自动保存，再清 pending 会话 */
	private async leaveEditor(): Promise<void> {
		if (this.saving) {
			await this.waitForSaving();
		} else {
			await this.autoSaveIfDirty({ silent: true });
		}
		await this.discardUploadSession();
	}

	private waitForSaving(): Promise<void> {
		if (!this.saving) return Promise.resolve();
		return new Promise((resolve) => {
			const check = () => {
				if (!this.saving) resolve();
				else requestAnimationFrame(check);
			};
			check();
		});
	}

	/** keepalive 保存后通知对端清脏（刷新/关页不走 saveNote，须显式广播 saved） */
	private notifyPeerSavedAfterKeepalive(
		noteId: string | null,
		html: string,
		title: string,
	): void {
		if (!noteId) return;
		const savedTitle = title.trim() || this.t('common.untitledNote');
		this.captureNoteOrigin(noteId, html, savedTitle);
		this.syncPublish?.saved?.({
			noteId,
			html,
			title: savedTitle,
		});
		this.syncPublish?.listChanged?.('pagehide-save');
	}

	/** 刷新/关页/SPA 离页：keepalive 保存或结算 pending（不用 visibilitychange） */
	flushNoteOnPageHide(): void {
		if (this.preview) return;
		const snap = this.takeEditorSnapshot();
		const sid = this.uploadSessionId;
		const owned = this.uploadSessionOwned;
		if (
			snap?.dirty &&
			(hasNoteBodyContent(snap.html, snap.text) || snap.title.trim())
		) {
			const noteId = this.saveTargetId;
			const title = snap.title.trim() || this.t('common.untitledNote');
			saveNoteKeepalive({
				id: noteId,
				title,
				html: snap.html,
				uploadSessionId: sid,
			});
			this.notifyPeerSavedAfterKeepalive(noteId, snap.html, title);
			// 避免 leavePage / pagehide 重复 keepalive
			if (this.leaveSnap?.noteId === (this.editingId ?? this.boundNoteId)) {
				this.leaveSnap = { ...this.leaveSnap, dirty: false };
			}
			this.uploadSessionId = null;
			this.uploadSessionOwned = true;
			return;
		}
		if (sid && snap) {
			settleUploadSessionKeepalive(sid, snap.html);
			if (this.uploadSessionId === sid) {
				this.uploadSessionId = null;
				this.uploadSessionOwned = true;
			}
			return;
		}
		if (sid) {
			// 仅 discard 本窗创建的会话，避免误删对端仍在用的 pending 图
			if (owned) discardUploadSessionKeepalive(sid);
			if (this.uploadSessionId === sid) {
				this.uploadSessionId = null;
				this.uploadSessionOwned = true;
			}
		}
	}

	get hasMore(): boolean {
		return this.list.length < this.total;
	}

	get hasActive(): boolean {
		return !!(this.preview?.id ?? this.editingId);
	}

	/** 保存目标 id：优先编辑态，其次绑定态（预览清空 editingId 后的回退） */
	get saveTargetId(): string | null {
		return this.editingId ?? this.boundNoteId;
	}

	private bindNoteId(id: string | null) {
		this.boundNoteId = id?.trim() || null;
	}

	clearList() {
		this.list = [];
		this.total = 0;
		this.pageNo = 1;
		this.loading = false;
		this.loadingMore = false;
		this.refreshing = false;
	}

	setListOpen(open: boolean) {
		this.listOpen = open;
		if (open) {
			void this.refreshList();
		} else {
			this.clearList();
		}
	}

	toggleListOpen() {
		this.setListOpen(!this.listOpen);
	}

	setConfirmOpen(open: boolean) {
		this.confirmOpen = open;
		if (!open) this.pendingDeleteId = null;
	}

	setVisibilityConfirmOpen(open: boolean) {
		this.visibilityConfirmOpen = open;
		if (!open) this.pendingVisibility = null;
	}

	setLoadingDetail(loading: boolean) {
		this.loadingDetail = loading;
	}

	async fetchPage(
		page: number,
		append: boolean,
		opts?: { ignoreListOpen?: boolean },
	): Promise<void> {
		if (!this.api) {
			this.toast(this.t('learningNotes.toast.httpDeniedSync'), 'error');
			return;
		}
		if (this.loading || this.refreshing) return;
		if (append) {
			if (this.loadingMore || !this.hasMore) return;
			this.loadingMore = true;
		} else if (this.list.length > 0) {
			this.refreshing = true;
		} else {
			this.loading = true;
		}
		try {
			const data = await this.api.list(page, this.pageSize);
			runInAction(() => {
				// 关闭列表后丢弃迟到回包，避免清空后又被写回（跨窗同步除外）
				if (!opts?.ignoreListOpen && !this.listOpen) return;
				this.total = data.total;
				this.pageNo = page;
				if (append) {
					const seen = new Set(this.list.map((n) => n.id));
					this.list = [
						...this.list,
						...data.list.filter((n) => !seen.has(n.id)),
					];
				} else {
					this.list = data.list;
				}
			});
		} catch {
			// Host http 已 Toast
		} finally {
			runInAction(() => {
				this.loading = false;
				this.loadingMore = false;
				this.refreshing = false;
			});
		}
	}

	async refreshList(): Promise<void> {
		if (!this.listOpen) return;
		await this.fetchPage(1, false);
	}

	/** 跨窗同步：无论列表是否展开都刷新 */
	async refreshListFromSync(): Promise<void> {
		await this.fetchPage(1, false, { ignoreListOpen: true });
	}

	/** 跨窗同步：共用上传方 uploadSessionId；标记为非本窗所有，离开时不 discard */
	adoptUploadSessionIdForSync(sessionId: string | null | undefined) {
		const sid = sessionId?.trim();
		if (!sid || this.uploadSessionId === sid) return;
		this.uploadSessionId = sid;
		this.uploadSessionOwned = false;
	}

	private rotateUploadSession() {
		this.uploadSessionId = crypto.randomUUID();
		this.uploadSessionOwned = true;
	}

	applyRemoteDraft(
		noteId: string,
		draft: {
			html: string;
			title: string;
			uploadSessionId?: string | null;
			dirty?: boolean;
		},
	) {
		if (this.preview?.id === noteId) {
			const baseline =
				this.savedBaselineHtml ?? this.pendingPeerDraft?.baselineHtml;
			// openPreview 合并本窗编辑稿期间：只记 pending，勿用对端旧快照盖预览正文
			if (this.loadingDetail) {
				if (draft.dirty === false) {
					this.pendingPeerDraft = null;
					if (draft.html.trim()) this.savedBaselineHtml = draft.html;
				} else {
					this.pendingPeerDraft = {
						noteId,
						html: draft.html,
						title: draft.title,
						uploadSessionId: draft.uploadSessionId,
						dirty: draft.dirty ?? true,
						baselineHtml: baseline,
					};
				}
				return;
			}
			if (draft.dirty === false) {
				this.pendingPeerDraft = null;
				if (draft.html.trim()) this.savedBaselineHtml = draft.html;
			} else {
				// 预览期间保留 pending，供预览→编辑恢复「服务端基线 + 未保存草稿」
				this.pendingPeerDraft = {
					noteId,
					html: draft.html,
					title: draft.title,
					uploadSessionId: draft.uploadSessionId,
					dirty: draft.dirty ?? true,
					baselineHtml: baseline,
				};
			}
			this.preview = { ...this.preview, html: draft.html, title: draft.title };
			return;
		}
		if (this.editingId === noteId) {
			this.pendingPeerDraft = null;
			this.adoptUploadSessionIdForSync(draft.uploadSessionId);
			if (this.remoteDraftApplier?.(noteId, draft)) return;
			this.editorInitial = draft.html;
			this.editorSeed += 1;
			return;
		}
		// 对端已推快照但本窗还在 openEditById / detail 途中
		this.pendingPeerDraft = {
			noteId,
			html: draft.html,
			title: draft.title,
			uploadSessionId: draft.uploadSessionId,
			dirty: draft.dirty,
			baselineHtml: this.savedBaselineHtml ?? undefined,
		};
	}

	applyRemoteSaved(noteId: string, payload: { html: string; title: string }) {
		if (this.pendingPeerDraft?.noteId === noteId) {
			this.pendingPeerDraft = null;
		}
		if (payload.html.trim()) {
			this.savedBaselineHtml = payload.html;
			this.captureNoteOrigin(noteId, payload.html, payload.title || '');
		}
		if (this.preview?.id === noteId) {
			this.preview = {
				...this.preview,
				title: payload.title || this.preview.title,
				...(payload.html.trim() ? { html: payload.html } : {}),
			};
		}
		if (payload.title) {
			this.list = this.list.map((n) =>
				n.id === noteId ? { ...n, title: payload.title } : n,
			);
		}
		if (this.editingId === noteId) {
			this.remoteSavedApplier?.(noteId, payload);
			this.rotateUploadSession();
		}
	}

	applyRemoteDeleted(noteId: string) {
		runInAction(() => {
			if (this.preview?.id === noteId) this.preview = null;
			if (this.editingId === noteId) {
				this.editingId = null;
				this.editorInitial = EMPTY_NOTE_DOC;
				this.editorSeed += 1;
			}
			if (this.boundNoteId === noteId) this.boundNoteId = null;
			if (this.pendingDeleteId === noteId) {
				this.pendingDeleteId = null;
				this.confirmOpen = false;
			}
			this.list = this.list.filter((n) => n.id !== noteId);
		});
		void this.discardUploadSession();
	}

	async loadMore(): Promise<void> {
		if (!this.hasMore || this.loading || this.refreshing || this.loadingMore)
			return;
		await this.fetchPage(this.pageNo + 1, true);
	}

	async openNew() {
		const prevId = this.sessionNoteId();
		await this.leaveEditor();
		this.releaseOriginSessionIfLeaving(prevId, null);
		this.preview = null;
		this.editingId = null;
		this.bindNoteId(null);
		this.pendingPeerDraft = null;
		this.savedBaselineHtml = null;
		this.leaveSnap = null;
		this.rotateUploadSession();
		this.editorInitial = EMPTY_NOTE_DOC;
		this.editorSeed += 1;
	}

	async openPreview(id: string): Promise<void> {
		if (!this.api) return;
		// 已在预览同篇：勿再 detail，避免把当前预览（含未保存稿）盖成服务端旧稿
		if (this.preview?.id === id && !this.loadingDetail) return;

		const prevId = this.sessionNoteId();
		const editingSame = this.editingId === id && !this.preview;
		// 同篇编辑中：优先编辑器快照，其次离页缓存（reader 偶发失败时不丢稿）
		const localFromEdit = editingSame
			? (this.takeEditorSnapshot() ??
				(this.leaveSnap?.noteId === id ? this.leaveSnap : null))
			: null;
		// 读不到本地稿就别卸编辑器 + 拉 detail，否则未保存正文会直接丢
		if (editingSame && !localFromEdit) return;

		await this.leaveEditor();
		this.releaseOriginSessionIfLeaving(prevId, id);
		const listHit = this.list.find((n) => n.id === id);
		// 立刻进入预览壳：卸掉编辑器，避免与即将挂载的预览双实例并存
		runInAction(() => {
			this.bindNoteId(id);
			// 进预览一律卸编辑态，避免 editingId 与 preview 同时挂着同篇
			this.editingId = null;
			this.editorInitial = EMPTY_NOTE_DOC;
			this.editorSeed += 1;
			this.loadingDetail = true;
			this.savedBaselineHtml = null;
			if (this.pendingPeerDraft?.noteId !== id) {
				this.pendingPeerDraft = null;
			}
			this.preview = {
				id,
				title:
					localFromEdit?.title.trim() ||
					listHit?.title ||
					this.preview?.title ||
					'',
				html:
					localFromEdit?.html ||
					(this.preview?.id === id ? this.preview.html : ''),
				at: listHit?.at ?? this.preview?.at ?? Date.now(),
				author:
					listHit?.author ??
					(this.preview?.id === id ? this.preview.author : ''),
				isPublic:
					listHit?.isPublic ??
					(this.preview?.id === id ? this.preview.isPublic : false),
				isOwned:
					listHit?.isOwned ??
					(this.preview?.id === id ? this.preview.isOwned : true),
			};
		});
		try {
			const note = await this.api.detail(id);
			runInAction(() => {
				if (this.preview?.id !== id) return;
				const peer =
					this.pendingPeerDraft?.noteId === id ? this.pendingPeerDraft : null;
				const serverHtml = note.html || '';
				this.savedBaselineHtml = serverHtml;
				// 共享基线只由编辑器 ready / 保存 / 清脏写入（TipTap 规范化稿），
				// 这里不拿服务端原始串抢占，避免主子窗脏判断起点不一致
				this.getNoteOrigin(id);
				this.bindNoteId(id);
				// 优先级：本窗刚离开的编辑快照 > 对端 pending > 服务端
				// （对端旧快照不能盖掉本窗未保存正文——这正是「点同篇预览/列表看到旧稿」的根因之一）
				if (localFromEdit) {
					const title = localFromEdit.title.trim() || note.title;
					this.preview = {
						...note,
						html: localFromEdit.html,
						title,
					};
					// leaveEditor 若已静默保存成功，leaveSnap.dirty===false，不必再挂 pending
					const stillDirty =
						this.leaveSnap?.noteId === id
							? this.leaveSnap.dirty
							: localFromEdit.dirty;
					if (stillDirty) {
						this.pendingPeerDraft = {
							noteId: id,
							html: localFromEdit.html,
							title: localFromEdit.title,
							dirty: true,
							baselineHtml: serverHtml,
						};
					} else {
						this.pendingPeerDraft = null;
					}
					return;
				}
				if (peer) {
					this.preview = {
						...note,
						html: peer.html,
						title: peer.title.trim() || note.title,
					};
					if (peer.dirty !== false) {
						this.pendingPeerDraft = {
							...peer,
							baselineHtml: serverHtml,
						};
					} else {
						this.pendingPeerDraft = null;
					}
					return;
				}
				this.preview = note;
				this.pendingPeerDraft = null;
			});
		} catch {
			// Host http 已 Toast（如「笔记不存在」）；同篇编辑快照已写入壳则保留
			runInAction(() => {
				if (this.preview?.id === id && !this.preview.html) {
					this.preview = null;
				}
			});
		} finally {
			runInAction(() => {
				this.loadingDetail = false;
				if (this.preview?.id === id) this.acquireOriginSession(id);
			});
		}
	}

	async openEdit(note: Note) {
		// 已在编辑同篇：勿 remount 盖掉未保存稿
		if (this.editingId === note.id && !this.preview) return;
		const prevId = this.sessionNoteId();
		await this.leaveEditor();
		this.releaseOriginSessionIfLeaving(prevId, note.id);
		this.preview = null;
		this.editingId = note.id;
		this.bindNoteId(note.id);
		this.rotateUploadSession();
		const peer =
			this.pendingPeerDraft?.noteId === note.id ? this.pendingPeerDraft : null;
		this.pendingPeerDraft = null;

		const draftHtml =
			(typeof note.html === 'string' && note.html) ||
			peer?.html ||
			EMPTY_NOTE_DOC;
		const serverHtml = typeof note.html === 'string' ? note.html : '';
		const sharedOrigin = this.getNoteOrigin(note.id);
		// 无对端草稿时以服务端稿为「是否未保存」判据，勿用 LS 陈旧 origin 误挂脏稿
		const baselineHtml = peer
			? (peer.baselineHtml ??
				sharedOrigin?.html ??
				this.savedBaselineHtml ??
				serverHtml)
			: serverHtml || sharedOrigin?.html || this.savedBaselineHtml || '';
		this.savedBaselineHtml = null;
		if (sharedOrigin && peer) this.noteOrigin = sharedOrigin;

		const draftStr = typeof draftHtml === 'string' ? draftHtml : '';
		const hasUnsaved =
			Boolean(baselineHtml) &&
			draftStr !== baselineHtml &&
			peer?.dirty !== false;

		// 有未保存草稿时先挂服务端基线，再套草稿，避免把草稿当成基线导致脏标记闪灭
		this.editorInitial = hasUnsaved ? baselineHtml : draftHtml;
		this.editorSeed += 1;

		if (hasUnsaved) {
			const draft = {
				html: draftStr,
				title: peer?.title || note.title || '',
				uploadSessionId: peer?.uploadSessionId,
				dirty: true as boolean | undefined,
			};
			queueMicrotask(() => {
				if (this.editingId === note.id) this.applyRemoteDraft(note.id, draft);
			});
		}
		this.acquireOriginSession(note.id);
	}

	async openEditById(id: string): Promise<void> {
		if (!this.api) return;
		// 已在编辑同篇：勿 detail 重挂
		if (this.editingId === id && !this.preview) return;
		// 预览同篇已有正文（可能含未保存稿）：直接进编辑，避免 detail 旧稿覆盖
		if (this.preview?.id === id && this.preview.html) {
			await this.openEdit(this.preview);
			return;
		}
		try {
			const note = await this.api.detail(id);
			await this.openEdit(note);
		} catch {
			// Host http 已 Toast
		}
	}

	/** 由页面从 editor 取出最新内容后调用；成功返回 true */
	async saveNote(
		input: {
			title: string;
			html: string;
			text: string;
			dirty: boolean;
		},
		opts?: { silent?: boolean; auto?: boolean },
	): Promise<boolean> {
		if (!input.dirty) {
			await this.settleUploadSessionIfNeeded(input.html);
			if (!opts?.silent) {
				this.toast(this.t('learningNotes.toast.noSave'), 'info');
			}
			return false;
		}
		if (!input.title.trim() && !opts?.auto) {
			this.toast(this.t('learningNotes.toast.needTitle'), 'info');
			return false;
		}
		if (!hasNoteBodyContent(input.html, input.text)) {
			if (!opts?.silent) {
				this.toast(this.t('learningNotes.toast.needContent'), 'info');
			}
			return false;
		}
		if (!this.api) {
			this.toast(this.t('learningNotes.toast.httpDeniedSave'), 'error');
			return false;
		}
		// 离页时 unmount 会先卸 bindSyncPublish；await 前先抓住，否则对端收不到 saved
		const sync = this.syncPublish;
		this.saving = true;
		try {
			const sessionId = this.uploadSessionId;
			const payload = {
				title: input.title.trim() || this.t('common.untitledNote'),
				html: input.html,
				uploadSessionId: sessionId,
			};
			const noteId = this.saveTargetId;
			let savedId = noteId;
			const savedHtml = payload.html;
			const savedTitle = payload.title;
			if (noteId) {
				const updated = await this.api.update(noteId, payload);
				savedId = updated.id;
				runInAction(() => {
					this.editingId = updated.id;
					this.bindNoteId(updated.id);
					this.rotateUploadSession();
				});
				if (opts?.auto) {
					this.toast(this.t('learningNotes.toast.autoSaved'), 'success');
				} else if (!opts?.silent) {
					this.toast(this.t('learningNotes.toast.updated'), 'success');
				}
			} else {
				const { id } = await this.api.save(payload);
				savedId = id;
				runInAction(() => {
					this.editingId = id;
					this.bindNoteId(id);
					this.rotateUploadSession();
				});
				if (opts?.auto) {
					this.toast(this.t('learningNotes.toast.autoSaved'), 'success');
				} else if (!opts?.silent) {
					this.toast(this.t('learningNotes.toast.saved'), 'success');
				}
			}
			if (savedId) {
				this.leaveSnap = {
					noteId: savedId,
					title: savedTitle,
					html: savedHtml,
					text: this.leaveSnap?.text ?? '',
					dirty: false,
				};
				this.captureNoteOrigin(savedId, savedHtml, savedTitle);
				sync?.saved?.({
					noteId: savedId,
					html: savedHtml,
					title: savedTitle,
				});
				sync?.listChanged?.(noteId ? 'update' : 'save');
			}
			if (!opts?.silent) {
				await this.refreshList();
			} else {
				void this.refreshList();
			}
			return true;
		} catch {
			// Host http 已 Toast
			return false;
		} finally {
			runInAction(() => {
				this.saving = false;
			});
		}
	}

	requestDelete(id: string) {
		this.pendingDeleteId = id;
		this.confirmOpen = true;
	}

	requestVisibility(id: string, isPublic: boolean) {
		this.pendingVisibility = { id, isPublic };
		this.visibilityConfirmOpen = true;
	}

	async confirmVisibility(): Promise<void> {
		const pending = this.pendingVisibility;
		if (!this.api || !pending) return;
		try {
			const updated = await this.api.setVisibility(
				pending.id,
				pending.isPublic,
			);
			runInAction(() => {
				this.list = this.list.map((n) =>
					n.id === updated.id
						? { ...n, isPublic: updated.isPublic, isOwned: true }
						: n,
				);
				if (this.preview?.id === updated.id) {
					this.preview = {
						...this.preview,
						isPublic: updated.isPublic,
						isOwned: true,
					};
				}
				this.pendingVisibility = null;
				this.visibilityConfirmOpen = false;
			});
			this.syncPublish?.listChanged?.('visibility');
			this.toast(
				this.t(
					pending.isPublic
						? 'learningNotes.toast.madePublic'
						: 'learningNotes.toast.madePrivate',
				),
				'success',
			);
		} catch {
			// Host http 已 Toast
			runInAction(() => {
				this.pendingVisibility = null;
				this.visibilityConfirmOpen = false;
			});
		}
	}

	/** 导出当前预览笔记为 DOCX（服务端生成 + Host downloadBlob 落盘） */
	async exportPreviewDocx(): Promise<void> {
		const note = this.preview;
		if (!note?.id) {
			this.toast(this.t('learningNotes.toast.exportEmpty'), 'info');
			return;
		}
		if (!this.api) {
			this.toast(this.t('learningNotes.toast.httpDeniedExport'), 'error');
			return;
		}
		if (!this.downloadBlob) {
			this.toast(this.t('learningNotes.toast.exportNoDownload'), 'error');
			return;
		}
		if (this.exportingDocx) return;
		this.exportingDocx = true;
		try {
			const buf = await this.api.exportDocx(note.id);
			const safe =
				note.title
					.replace(/[\\/:*?"<>|]+/g, '_')
					.trim()
					.slice(0, 60) || 'learning-note';
			const result = await this.downloadBlob({
				fileName: `${safe}-${Date.now()}.docx`,
				data: buf,
				mimeType: DOCX_MIME,
			});
			if (!result.ok) {
				// 对齐收藏导出：Tauri 失败时 Host 已 Toast
				if (!result.hostToasted) {
					this.toast(
						result.message || this.t('learningNotes.toast.exportFail'),
						'error',
					);
				}
				return;
			}
			// Tauri：downloadBlob 内已成功 Toast；Web：由插件提示
			if (!result.hostToasted) {
				this.toast(this.t('learningNotes.toast.exportOk'), 'success');
			}
		} catch (e) {
			// 接口错误 Host 已 Toast；仅本地校验（如导出文件无效）再提示
			toastUnlessHostHttp(this.toast, e, this.t);
		} finally {
			runInAction(() => {
				this.exportingDocx = false;
			});
		}
	}

	/**
	 * 编辑器粘贴 / 拖放 / 选图：上传后返回 URL；失败返回 null（不插入 base64）。
	 * 始终带 uploadSessionId 记 pending，避免已保存笔记「上传又删且未保存」孤儿。
	 */
	async uploadNoteImage(
		file: File,
		noteId?: string | null,
	): Promise<string | null> {
		if (!this.api) {
			this.toast(this.t('learningNotes.toast.httpDeniedSync'), 'error');
			return null;
		}
		try {
			if (!this.uploadSessionId) {
				this.rotateUploadSession();
			}
			return await this.api.uploadImage(file, {
				noteId: noteId ?? this.saveTargetId,
				uploadSessionId: this.uploadSessionId,
			});
		} catch (e) {
			toastUnlessHostHttp(this.toast, e, this.t);
			return null;
		}
	}

	/**
	 * 内容已回到基线（无需保存）时，按当前 HTML 结算 pending。
	 * 上传后又删掉的图会在此回收 COS。
	 */
	async settleUploadSessionIfNeeded(html: string): Promise<void> {
		const sid = this.uploadSessionId;
		if (!sid || !this.api) return;
		try {
			await this.api.settleUploadSession(sid, html);
		} catch {
			// Host 已 Toast；离开时 discard / TTL 仍会清
		}
	}

	/** 放弃当前上传会话的 pending（切笔记 / 新建时调用） */
	async discardUploadSession(): Promise<void> {
		const sid = this.uploadSessionId;
		const owned = this.uploadSessionOwned;
		this.uploadSessionId = null;
		this.uploadSessionOwned = true;
		// 对端 adopt 的会话不可 DELETE，否则会误删上传方仍在用的 pending 图
		if (!sid || !owned || !this.api) return;
		try {
			await this.api.discardUploadSession(sid);
		} catch {
			// Host 已 Toast；离页 keepalive / TTL 仍会清
		}
	}

	async confirmDelete(): Promise<void> {
		const id = this.pendingDeleteId;
		if (!this.api || !id) return;
		try {
			await this.api.remove(id);
			runInAction(() => {
				if (this.preview?.id === id) this.preview = null;
				if (this.editingId === id) {
					this.editingId = null;
					this.editorInitial = EMPTY_NOTE_DOC;
					this.editorSeed += 1;
				}
				if (this.boundNoteId === id) this.boundNoteId = null;
				this.pendingDeleteId = null;
				this.clearNoteOrigin(id);
			});
			this.syncPublish?.deleted?.(id);
			this.syncPublish?.listChanged?.('delete');
			this.toast(this.t('learningNotes.toast.deleted'), 'success');
			await this.refreshList();
		} catch {
			// Host http 已 Toast
			runInAction(() => {
				this.pendingDeleteId = null;
			});
		}
	}
}

export default new LearningNotesStore();
