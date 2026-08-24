/** 学习笔记：经 HostBridge 调用主站 `/english-learning/notes/*` */

import { translateSync } from '@/i18n';

export type HostHttp = {
	get: <T = unknown>(url: string) => Promise<T>;
	post: <T = unknown>(url: string, body?: unknown) => Promise<T>;
	put: <T = unknown>(url: string, body?: unknown) => Promise<T>;
	delete: <T = unknown>(url: string) => Promise<T>;
};

const BASE = '/english-learning/notes';

function notesApiBaseUrl(): string {
	const base = (
		import.meta.env.PROD
			? import.meta.env.VITE_PROD_API_DOMAIN
			: import.meta.env.VITE_DEV_API_DOMAIN
	)?.trim();
	return base || '';
}

/** 刷新/关页时 keepalive discard（async Host http 会被浏览器掐断） */
export function discardUploadSessionKeepalive(sessionId: string): void {
	if (typeof window === 'undefined') return;
	const sid = sessionId.trim();
	if (!sid) return;
	const token = localStorage.getItem('token')?.trim();
	const base = notesApiBaseUrl();
	if (!token || !base) return;
	void fetch(`${base}${BASE}/upload-session/${encodeURIComponent(sid)}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${token}` },
		keepalive: true,
	});
}

/** 刷新/关页时 keepalive 结算 pending（无脏保存时） */
export function settleUploadSessionKeepalive(
	sessionId: string,
	content: string,
): void {
	if (typeof window === 'undefined') return;
	const sid = sessionId.trim();
	if (!sid) return;
	const token = localStorage.getItem('token')?.trim();
	const base = notesApiBaseUrl();
	if (!token || !base) return;
	void fetch(
		`${base}${BASE}/upload-session/${encodeURIComponent(sid)}/settle`,
		{
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ content }),
			keepalive: true,
		},
	);
}

/** 刷新/关页时 keepalive 保存笔记 */
export function saveNoteKeepalive(input: {
	id?: string | null;
	title: string;
	html: string;
	uploadSessionId?: string | null;
}): void {
	if (typeof window === 'undefined') return;
	const token = localStorage.getItem('token')?.trim();
	const base = notesApiBaseUrl();
	if (!token || !base) return;
	const title = input.title.trim() || translateSync('common.untitledNote');
	const payload: Record<string, string> = {
		title,
		content: input.html,
	};
	const sid = input.uploadSessionId?.trim();
	if (sid) payload.uploadSessionId = sid;
	const headers = {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	};
	const id = input.id?.trim();
	if (id) {
		void fetch(`${base}${BASE}/update/${encodeURIComponent(id)}`, {
			method: 'PUT',
			headers,
			body: JSON.stringify({ id, ...payload }),
			keepalive: true,
		});
		return;
	}
	void fetch(`${base}${BASE}/save`, {
		method: 'POST',
		headers,
		body: JSON.stringify(payload),
		keepalive: true,
	});
}

/** 列表默认每页条数 */
export const NOTES_PAGE_SIZE = 20;

export type NoteRecord = {
	id: string;
	title: string | null;
	content: string;
	userId?: number;
	/** 作者用户名 */
	author?: string;
	isPublic?: boolean;
	/** 当前登录用户是否为作者；缺省按本人（写接口回包） */
	isOwned?: boolean;
	createdAt?: string;
	updatedAt?: string;
};

export type NoteListItem = Omit<NoteRecord, 'content'>;

export type Note = {
	id: string;
	title: string;
	html: string;
	at: number;
	author: string;
	isPublic: boolean;
	isOwned: boolean;
};

export type NoteListPage = {
	list: Note[];
	total: number;
	pageNo: number;
	pageSize: number;
};

function unwrapData<T>(res: unknown): T {
	if (res && typeof res === 'object' && 'data' in res) {
		return (res as { data: T }).data;
	}
	return res as T;
}

function toNote(row: NoteListItem | NoteRecord): Note {
	const html =
		'content' in row && typeof row.content === 'string' ? row.content : '';
	const atRaw = row.updatedAt ?? row.createdAt;
	const at = atRaw ? new Date(atRaw).getTime() : Date.now();
	return {
		id: row.id,
		title: (row.title ?? '').trim() || translateSync('common.untitledNote'),
		html,
		at: Number.isFinite(at) ? at : Date.now(),
		author: (row.author ?? '').trim() || String(row.userId ?? ''),
		isPublic: Boolean(row.isPublic),
		// 列表/详情带 isOwned；update 等本人写回包可不带，默认本人
		isOwned: row.isOwned !== false,
	};
}

export function createNotesApi(http: HostHttp) {
	return {
		async list(pageNo = 1, pageSize = NOTES_PAGE_SIZE): Promise<NoteListPage> {
			const res = await http.get(
				`${BASE}/list?pageNo=${pageNo}&pageSize=${pageSize}`,
			);
			const page = unwrapData<{ list: NoteListItem[]; total: number }>(res);
			const rows = Array.isArray(page?.list) ? page.list : [];
			return {
				list: rows.map(toNote),
				total: typeof page?.total === 'number' ? page.total : rows.length,
				pageNo,
				pageSize,
			};
		},

		async detail(id: string): Promise<Note> {
			const res = await http.get(`${BASE}/detail/${id}`);
			return toNote(unwrapData<NoteRecord>(res));
		},

		/** 拉取单篇笔记 DOCX 二进制（服务端生成） */
		async exportDocx(id: string): Promise<ArrayBuffer> {
			const res = await http.get(`${BASE}/export-docx/${id}`);
			const data = unwrapData<unknown>(res);
			if (data instanceof ArrayBuffer) return data;
			if (ArrayBuffer.isView(data)) {
				const v = data as ArrayBufferView;
				return v.buffer.slice(
					v.byteOffset,
					v.byteOffset + v.byteLength,
				) as ArrayBuffer;
			}
			throw new Error(translateSync('learningNotes.toast.exportInvalid'));
		},

		async save(input: {
			title: string;
			html: string;
			uploadSessionId?: string | null;
		}): Promise<{ id: string }> {
			const res = await http.post(`${BASE}/save`, {
				title: input.title.trim() || null,
				content: input.html,
				...(input.uploadSessionId?.trim()
					? { uploadSessionId: input.uploadSessionId.trim() }
					: {}),
			});
			return unwrapData<{ id: string }>(res);
		},

		async update(
			id: string,
			input: {
				title: string;
				html: string;
				uploadSessionId?: string | null;
			},
		): Promise<{ id: string }> {
			const res = await http.put(`${BASE}/update/${id}`, {
				id,
				title: input.title.trim() || null,
				content: input.html,
				...(input.uploadSessionId?.trim()
					? { uploadSessionId: input.uploadSessionId.trim() }
					: {}),
			});
			return unwrapData<{ id: string }>(res);
		},

		async remove(id: string): Promise<void> {
			await http.delete(`${BASE}/delete/${id}`);
		},

		/** 所有者设置是否公开 */
		async setVisibility(id: string, isPublic: boolean): Promise<Note> {
			const res = await http.put(`${BASE}/visibility/${id}`, { isPublic });
			return toNote(unwrapData<NoteListItem>(res));
		},

		/**
		 * 笔记图片上传至 COS notes/。
		 * 优先带 uploadSessionId 记 pending；保存或内容回干净时再结算。
		 */
		async uploadImage(
			file: File,
			opts?: { noteId?: string | null; uploadSessionId?: string | null },
		): Promise<string> {
			const fd = new FormData();
			fd.append('file', file);
			const sessionId = opts?.uploadSessionId?.trim();
			const noteId = opts?.noteId?.trim();
			if (sessionId) fd.append('uploadSessionId', sessionId);
			else if (noteId) fd.append('noteId', noteId);
			const res = await http.post(`${BASE}/upload-image`, fd);
			const data = unwrapData<{ url?: string }>(res);
			const url = data?.url?.trim();
			if (!url) {
				throw new Error(translateSync('learningNotes.toast.uploadImageFailed'));
			}
			return url;
		},

		/** 放弃上传会话（回收该会话全部 pending） */
		async discardUploadSession(sessionId: string): Promise<void> {
			const sid = sessionId.trim();
			if (!sid) return;
			await http.delete(`${BASE}/upload-session/${encodeURIComponent(sid)}`);
		},

		/** 按正文结算会话（上传又删、无需保存时回收） */
		async settleUploadSession(
			sessionId: string,
			content: string,
		): Promise<void> {
			const sid = sessionId.trim();
			if (!sid) return;
			await http.post(
				`${BASE}/upload-session/${encodeURIComponent(sid)}/settle`,
				{ content },
			);
		},
	};
}

export type NotesApi = ReturnType<typeof createNotesApi>;
