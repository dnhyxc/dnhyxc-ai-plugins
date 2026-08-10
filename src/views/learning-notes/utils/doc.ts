import {
	splitPreviewBlocks,
	stripNoteTitleHtml,
} from '@/components/design/NotePreview/previewHtml';

/** 超过该块数启用长文滚动窗口 */
export const LARGE_MIN_BLOCKS = 80;
/** 编辑器内正文块数 */
export const WINDOW_SIZE = 100;
/** origin 变化至少这么多块才换窗，减少抖动 */
export const ORIGIN_HYSTERESIS = 24;
/** 块高估算（px） */
export const EST_BLOCK_H = 44;

const TITLE_RE =
	/<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i;

export type LargeNoteDoc = {
	blocks: string[];
	/** 当前窗口起点 */
	origin: number;
	/** 当前窗口块数 */
	count: number;
};

export function extractTitleHtml(html: string): string {
	return html.match(TITLE_RE)?.[0] ?? '';
}

export function extractTitleText(html: string): string {
	const node = extractTitleHtml(html);
	if (!node) return '';
	const fromAttr = node.match(/data-value=["']([^"']*)["']/i)?.[1];
	if (fromAttr != null) return fromAttr.trim();
	return node.replace(/<[^>]+>/g, '').trim();
}

export function titleToHtml(title: string): string {
	const safe = title
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
	return `<div data-type="note-title" data-value="${safe}">${safe}</div>`;
}

export function isLargeNoteHtml(content: unknown): content is string {
	if (typeof content !== 'string' || !content) return false;
	const body = stripNoteTitleHtml(content);
	if (content.length >= 80_000) return true;
	return splitPreviewBlocks(body).length >= LARGE_MIN_BLOCKS;
}

export function createLargeNoteDoc(html: string): {
	doc: LargeNoteDoc;
	title: string;
	editorHtml: string;
} {
	// 不折叠空段：预览/长文编辑窗口与短文编辑态空行一致
	const title = extractTitleText(html);
	const body = stripNoteTitleHtml(html);
	const parts = splitPreviewBlocks(body);
	const blocks = parts.length ? parts : ['<p></p>'];
	const count = Math.min(WINDOW_SIZE, blocks.length);
	const doc: LargeNoteDoc = { blocks, origin: 0, count };
	return {
		doc,
		title,
		editorHtml: blocks.slice(0, count).join('') || '<p></p>',
	};
}

function isEffectivelyEmptyBody(blocks: string[]): boolean {
	if (blocks.length === 0) return true;
	if (blocks.length > 3) return false;
	return blocks.every((b) => /^<p\b[^>]*>\s*<\/p>$/i.test(b));
}

/** 写回当前窗口；拒绝空覆盖 */
export function flushWindow(doc: LargeNoteDoc, editorHtml: string): boolean {
	const bodyBlocks = splitPreviewBlocks(stripNoteTitleHtml(editorHtml));
	if (isEffectivelyEmptyBody(bodyBlocks) && doc.count > 3) return false;
	const next = bodyBlocks.length ? bodyBlocks : ['<p></p>'];
	doc.blocks.splice(doc.origin, doc.count, ...next);
	doc.count = next.length;
	return true;
}

export function windowBodyHtml(
	doc: LargeNoteDoc,
	origin: number,
): {
	html: string;
	count: number;
} {
	const count = Math.min(WINDOW_SIZE, Math.max(0, doc.blocks.length - origin));
	const html =
		count > 0 ? doc.blocks.slice(origin, origin + count).join('') : '<p></p>';
	return { html, count: count > 0 ? count : 1 };
}

/** 由滚动位置算窗口 origin（居中可视区） */
export function originForScroll(
	scrollTop: number,
	viewH: number,
	blockCount: number,
	estH: number,
): number {
	const center = scrollTop + viewH / 2;
	const centerIdx = Math.max(
		0,
		Math.min(blockCount - 1, Math.floor(center / estH)),
	);
	const maxOrigin = Math.max(0, blockCount - WINDOW_SIZE);
	return Math.max(
		0,
		Math.min(maxOrigin, centerIdx - Math.floor(WINDOW_SIZE / 2)),
	);
}

export function stitchFullHtml(
	doc: LargeNoteDoc,
	title: string,
	editorHtml: string,
): string {
	flushWindow(doc, editorHtml);
	return `${titleToHtml(title)}${doc.blocks.join('')}`;
}

export function stitchFullText(
	doc: LargeNoteDoc,
	title: string,
	editorHtml: string,
): string {
	flushWindow(doc, editorHtml);
	const full = `${titleToHtml(title)}${doc.blocks.join('')}`;
	return full
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
