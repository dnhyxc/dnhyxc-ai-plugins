/**
 * 视频播放器常量与工具
 */

export const LIMIT = 100;

export const PLAY_OPTIONS = [
	{ labelKey: 'videoPlayer.playModeAuto', value: 'auto' as const },
	{ labelKey: 'videoPlayer.playModeLoop', value: 'loop' as const },
	{ labelKey: 'videoPlayer.playModeStop', value: 'stop' as const },
];

export const SCREEN_TYPE = [
	{ labelKey: 'videoPlayer.screenAuto', value: 'auto' as const },
	{ labelKey: 'videoPlayer.screenMirrorOn', value: 'mirror' as const },
];

export type PlayType = (typeof PLAY_OPTIONS)[number]['value'];
export type ScreenType = (typeof SCREEN_TYPE)[number]['value'];

/** 播放列表项（由外部传入，播放器不负责上传） */
export interface VideoItem {
	url: string;
	name: string;
	size?: number;
	type?: string;
}

/** @deprecated 用 VideoItem */
export type VideoUrlList = VideoItem;

/** 将 File 转为 VideoItem 并合并进已有列表（去重、限量） */
export function appendVideoFiles(
	files: readonly File[],
	existing: readonly VideoItem[] = [],
	limit = LIMIT,
): VideoItem[] {
	const next = [...existing];
	for (const file of files) {
		if (next.length >= limit) break;
		if (next.some((i) => i.name === file.name && i.size === file.size)) {
			continue;
		}
		next.push({
			url: URL.createObjectURL(file),
			name: file.name,
			size: file.size,
			type: file.type,
		});
	}
	return next.length === existing.length ? [...existing] : next;
}

/** 释放 blob: URL，避免泄漏 */
export function revokeVideoUrls(items: readonly VideoItem[]): void {
	for (const item of items) {
		if (item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
	}
}

export function formatTime(time: number, withHours = false): string {
	if (time === undefined || time === null || Number.isNaN(time)) {
		return '00:00';
	}
	const h = Math.floor(time / 3600);
	const m = Math.floor((time % 3600) / 60);
	const s = Math.floor(time % 60);
	const pad = (n: number) => String(n).padStart(2, '0');
	if (h > 0 || withHours) {
		return `${pad(h)}:${pad(m)}:${pad(s)}`;
	}
	return `${pad(m)}:${pad(s)}`;
}

type FsEl = HTMLElement & {
	webkitRequestFullscreen?: () => Promise<void> | void;
	webkitRequestFullScreen?: () => Promise<void> | void;
	mozRequestFullScreen?: () => Promise<void> | void;
	msRequestFullscreen?: () => Promise<void> | void;
};

type FsDoc = Document & {
	webkitFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => Promise<void> | void;
	webkitCancelFullScreen?: () => Promise<void> | void;
	mozCancelFullScreen?: () => Promise<void> | void;
	msExitFullscreen?: () => Promise<void> | void;
};

export function getFullscreenElement(): Element | null {
	const doc = document as FsDoc;
	return document.fullscreenElement || doc.webkitFullscreenElement || null;
}

/** 元素全屏；失败时返回 'css' 由调用方挂 CSS 全屏 class */
export async function enterFullscreen(
	el: HTMLElement,
): Promise<'native' | 'css'> {
	const node = el as FsEl;
	const req =
		el.requestFullscreen?.bind(el) ||
		node.webkitRequestFullscreen?.bind(node) ||
		node.webkitRequestFullScreen?.bind(node) ||
		node.mozRequestFullScreen?.bind(node) ||
		node.msRequestFullscreen?.bind(node);
	if (!req) return 'css';
	try {
		await Promise.resolve(req());
		return 'native';
	} catch {
		return 'css';
	}
}

export async function exitFullscreen(): Promise<void> {
	if (!getFullscreenElement()) return;
	const doc = document as FsDoc;
	const exit =
		document.exitFullscreen?.bind(document) ||
		doc.webkitExitFullscreen?.bind(doc) ||
		doc.webkitCancelFullScreen?.bind(doc) ||
		doc.mozCancelFullScreen?.bind(doc) ||
		doc.msExitFullscreen?.bind(doc);
	if (!exit) return;
	try {
		await Promise.resolve(exit());
	} catch {
		/* ignore */
	}
}

/**
 * 无 Host 影院态时的默认实现（独立预览 / mockHost 同源）：document 全屏。
 * 嵌入主站时由 Host `api.ui.setAppFullscreen` 覆盖。
 */
export async function setDocumentAppFullscreen(full: boolean): Promise<void> {
	try {
		if (full) {
			if (!document.fullscreenElement) {
				await document.documentElement.requestFullscreen();
			}
		} else if (document.fullscreenElement) {
			await document.exitFullscreen();
		}
	} catch {
		/* ignore */
	}
}
