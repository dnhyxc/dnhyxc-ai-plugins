import { EMPTY_NOTE_DOC } from '@design/RichEditor';
import { makeAutoObservable, runInAction } from 'mobx';
import { translateSync } from '@/i18n';
import {
	createNotesApi,
	type HostHttp,
	NOTES_PAGE_SIZE,
	type Note,
	type NotesApi,
} from '@/views/learning-notes/api';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;
type TFn = (key: string, params?: Record<string, unknown>) => string;

type HostDownloadBlob = (options: {
	fileName: string;
	data: ArrayBuffer | Uint8Array;
	mimeType?: string;
}) => Promise<{ ok: boolean; hostToasted: boolean; message?: string }>;

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

	get hasMore(): boolean {
		return this.list.length < this.total;
	}

	get hasActive(): boolean {
		return !!(this.preview?.id ?? this.editingId);
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

	async fetchPage(page: number, append: boolean): Promise<void> {
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
				// 关闭列表后丢弃迟到回包，避免清空后又被写回
				if (!this.listOpen) return;
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

	async loadMore(): Promise<void> {
		if (!this.hasMore || this.loading || this.refreshing || this.loadingMore)
			return;
		await this.fetchPage(this.pageNo + 1, true);
	}

	openNew() {
		this.preview = null;
		this.editingId = null;
		this.editorInitial = EMPTY_NOTE_DOC;
		this.editorSeed += 1;
	}

	async openPreview(id: string): Promise<void> {
		if (!this.api) return;
		const listHit = this.list.find((n) => n.id === id);
		// 立刻进入预览壳：卸掉编辑器，避免与即将挂载的预览双实例并存
		runInAction(() => {
			this.loadingDetail = true;
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
				// 慢网下用户可能已点开另一篇
				if (this.preview?.id === id) this.preview = note;
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

	openEdit(note: Note) {
		this.preview = null;
		this.editingId = note.id;
		this.editorInitial = note.html || EMPTY_NOTE_DOC;
		// 预览态编辑器已卸载，重新挂载时用 editorInitial；seed 保证同 key 残留实例也被清掉
		this.editorSeed += 1;
	}

	async openEditById(id: string): Promise<void> {
		if (!this.api) return;
		try {
			const note = await this.api.detail(id);
			runInAction(() => {
				this.openEdit(note);
			});
		} catch {
			// Host http 已 Toast
		}
	}

	/** 由页面从 editor 取出最新内容后调用；成功返回 true */
	async saveNote(input: {
		title: string;
		html: string;
		text: string;
		dirty: boolean;
	}): Promise<boolean> {
		if (!input.dirty) {
			this.toast(this.t('learningNotes.toast.noSave'), 'info');
			return false;
		}
		if (!input.title.trim()) {
			this.toast(this.t('learningNotes.toast.needTitle'), 'info');
			return false;
		}
		if (!input.text.trim()) {
			this.toast(this.t('learningNotes.toast.needContent'), 'info');
			return false;
		}
		if (!this.api) {
			this.toast(this.t('learningNotes.toast.httpDeniedSave'), 'error');
			return false;
		}
		this.saving = true;
		try {
			const payload = {
				title: input.title.trim() || this.t('common.untitledNote'),
				html: input.html,
			};
			if (this.editingId) {
				const updated = await this.api.update(this.editingId, payload);
				runInAction(() => {
					this.editingId = updated.id;
				});
				this.toast(this.t('learningNotes.toast.updated'), 'success');
			} else {
				const { id } = await this.api.save(payload);
				runInAction(() => {
					this.editingId = id;
				});
				this.toast(this.t('learningNotes.toast.saved'), 'success');
			}
			await this.refreshList();
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
