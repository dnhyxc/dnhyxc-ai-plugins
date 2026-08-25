import { EMPTY_NOTE_DOC } from '@design/RichEditor';
import { makeAutoObservable, runInAction } from 'mobx';
import { translateSync } from '@/i18n';
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
	private editorSnapshotReader: (() => NoteEditorSnapshot | null) | null = null;
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

	registerEditorSnapshot(fn: (() => NoteEditorSnapshot | null) | null): void {
		this.editorSnapshotReader = fn;
	}

	/** Host / 关窗：读取当前编辑器快照 */
	takeEditorSnapshot(): NoteEditorSnapshot | null {
		return this.editorSnapshotReader?.() ?? null;
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

	/** 刷新/关页：keepalive 保存或结算 pending（不用 visibilitychange） */
	flushNoteOnPageHide(): void {
		if (this.preview) return;
		const snap = this.takeEditorSnapshot();
		const sid = this.uploadSessionId;
		const owned = this.uploadSessionOwned;
		if (snap?.dirty && hasNoteBodyContent(snap.html, snap.text)) {
			saveNoteKeepalive({
				id: this.saveTargetId,
				title: snap.title.trim() || this.t('common.untitledNote'),
				html: snap.html,
				uploadSessionId: sid,
			});
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
		await this.leaveEditor();
		this.preview = null;
		this.editingId = null;
		this.bindNoteId(null);
		this.pendingPeerDraft = null;
		this.savedBaselineHtml = null;
		this.rotateUploadSession();
		this.editorInitial = EMPTY_NOTE_DOC;
		this.editorSeed += 1;
	}

	async openPreview(id: string): Promise<void> {
		if (!this.api) return;
		await this.leaveEditor();
		const listHit = this.list.find((n) => n.id === id);
		// 立刻进入预览壳：卸掉编辑器，避免与即将挂载的预览双实例并存
		runInAction(() => {
			this.bindNoteId(id);
			// 预览其他篇时清空 editingId，并卸掉旧正文，避免无 id 编辑器残留后误走新建
			if (this.editingId !== id) {
				this.editingId = null;
				this.editorInitial = EMPTY_NOTE_DOC;
				this.editorSeed += 1;
			}
			this.loadingDetail = true;
			this.savedBaselineHtml = null;
			if (this.pendingPeerDraft?.noteId !== id) {
				this.pendingPeerDraft = null;
			}
			this.preview = {
				id,
				title: listHit?.title ?? this.preview?.title ?? '',
				html: this.preview?.id === id ? this.preview.html : '',
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
				this.bindNoteId(id);
				// 对端未保存草稿优先于服务端旧正文
				this.preview = peer
					? {
							...note,
							html: peer.html,
							title: peer.title.trim() || note.title,
						}
					: note;
				if (peer && peer.dirty !== false) {
					this.pendingPeerDraft = {
						...peer,
						baselineHtml: serverHtml,
					};
				} else {
					this.pendingPeerDraft = null;
				}
			});
		} catch {
			// Host http 已 Toast（如「笔记不存在」）
			runInAction(() => {
				if (this.preview?.id === id && !this.preview.html) {
					this.preview = null;
				}
			});
		} finally {
			runInAction(() => {
				this.loadingDetail = false;
			});
		}
	}

	async openEdit(note: Note) {
		await this.leaveEditor();
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
		const baselineHtml =
			peer?.baselineHtml ||
			this.savedBaselineHtml ||
			(typeof note.html === 'string' ? note.html : '');
		this.savedBaselineHtml = null;

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
	}

	async openEditById(id: string): Promise<void> {
		if (!this.api) return;
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
		this.saving = true;
		try {
			const sessionId = this.uploadSessionId;
			const payload = {
				title: input.title.trim() || this.t('common.untitledNote'),
				html: input.html,
				uploadSessionId: sessionId,
			};
			const noteId = this.saveTargetId;
			if (noteId) {
				const updated = await this.api.update(noteId, payload);
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
			});
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
