/**
 * 按 noteId 共享的「原始基线」正文（主窗 / 子窗通用）。
 * 脏判断只对比这份基线，避免各窗 TipTap 本地基线漂移导致变更错乱。
 *
 * 生命周期：
 * - 某窗打开/编辑/预览某篇 → acquire（holders +1）
 * - 编辑中保存 / 清脏 → capture 更新基线，不 release
 * - 某窗切走该篇 → release（holders -1）
 * - 所有窗都 release 后 → 才 removeSharedNoteOrigin
 * - 删除笔记 → removeNoteOriginSession（基线 + holders 一并清）
 *
 * windowId 与 Host learningNotesSyncBus 一致（各 WebView 独立 sessionStorage）。
 */
export const LN_WINDOW_ID_KEY = 'dnhyxc_ln_window_id';

export type NoteOriginSnapshot = {
	noteId: string;
	html: string;
	title: string;
	updatedAt: number;
};

export const NOTE_ORIGIN_STORAGE_PREFIX = 'dnhyxc.ln.origin.v1:';
export const NOTE_ORIGIN_HOLDERS_PREFIX = 'dnhyxc.ln.origin.holders.v1:';

function originKey(noteId: string): string {
	return `${NOTE_ORIGIN_STORAGE_PREFIX}${noteId}`;
}

function holdersKey(noteId: string): string {
	return `${NOTE_ORIGIN_HOLDERS_PREFIX}${noteId}`;
}

/** 本 WebView 的 windowId（与 Host getLearningNotesWindowId 同 key） */
export function getLocalNoteOriginWindowId(): string {
	if (typeof sessionStorage === 'undefined') return 'ssr';
	let id = sessionStorage.getItem(LN_WINDOW_ID_KEY);
	if (!id) {
		id =
			typeof crypto !== 'undefined' && 'randomUUID' in crypto
				? crypto.randomUUID()
				: `w-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		sessionStorage.setItem(LN_WINDOW_ID_KEY, id);
	}
	return id;
}

function readHolders(noteId: string): string[] {
	if (!noteId || typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(holdersKey(noteId));
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(x): x is string => typeof x === 'string' && x.length > 0,
		);
	} catch {
		return [];
	}
}

function writeHolders(noteId: string, windowIds: string[]): void {
	if (!noteId || typeof localStorage === 'undefined') return;
	try {
		if (windowIds.length === 0) {
			localStorage.removeItem(holdersKey(noteId));
		} else {
			localStorage.setItem(holdersKey(noteId), JSON.stringify(windowIds));
		}
	} catch (e) {
		console.warn('[learningNotes] note origin holders write failed', e);
	}
}

/** 本窗开始编辑/预览该篇：登记 holder，不碰基线正文 */
export function acquireNoteOriginSession(
	noteId: string,
	windowId: string,
): void {
	if (!noteId || !windowId || typeof localStorage === 'undefined') return;
	const ids = new Set(readHolders(noteId));
	ids.add(windowId);
	writeHolders(noteId, [...ids]);
}

/**
 * 本窗离开该篇：移除 holder。
 * @returns true 表示已无其他窗持有 → 可清除 shared origin
 */
export function releaseNoteOriginSession(
	noteId: string,
	windowId: string,
): boolean {
	if (!noteId || !windowId || typeof localStorage === 'undefined') return false;
	const ids = new Set(readHolders(noteId));
	if (!ids.delete(windowId)) return ids.size === 0;
	writeHolders(noteId, [...ids]);
	return ids.size === 0;
}

export function readSharedNoteOrigin(
	noteId: string,
): NoteOriginSnapshot | null {
	if (!noteId || typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(originKey(noteId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as NoteOriginSnapshot;
		if (
			!parsed ||
			parsed.noteId !== noteId ||
			typeof parsed.html !== 'string'
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

/** 覆盖写入共享基线（保存成功 / 清脏时） */
export function writeSharedNoteOrigin(
	noteId: string,
	html: string,
	title: string,
): NoteOriginSnapshot | null {
	if (!noteId || typeof localStorage === 'undefined') return null;
	const snap: NoteOriginSnapshot = {
		noteId,
		html,
		title,
		updatedAt: Date.now(),
	};
	try {
		localStorage.setItem(originKey(noteId), JSON.stringify(snap));
	} catch (e) {
		console.warn('[learningNotes] note origin write failed', e);
	}
	return snap;
}

/** 仅当尚无共享基线时写入（首窗 TipTap 规范化抢占，他窗沿用） */
export function ensureSharedNoteOrigin(
	noteId: string,
	html: string,
	title: string,
): NoteOriginSnapshot | null {
	const existing = readSharedNoteOrigin(noteId);
	if (existing) return existing;
	return writeSharedNoteOrigin(noteId, html, title);
}

export function removeSharedNoteOrigin(noteId: string): void {
	if (!noteId || typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(originKey(noteId));
	} catch {
		/* ignore */
	}
}

/** 删除笔记：基线与 holders 一并移除 */
export function removeNoteOriginSession(noteId: string): void {
	removeSharedNoteOrigin(noteId);
	if (!noteId || typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(holdersKey(noteId));
	} catch {
		/* ignore */
	}
}
