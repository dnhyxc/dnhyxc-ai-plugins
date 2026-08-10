import type { Editor } from '@tiptap/react';

const DOCX_SAFE = new Set([
	'image/jpeg',
	'image/jpg',
	'image/png',
	'image/gif',
]);

/** 把浏览器能解码的图统一成 JPEG data URL（避免 webp/avif 线上导出失败） */
function bitmapToJpegDataUrl(
	source: ImageBitmap | HTMLImageElement,
	quality = 0.9,
): string {
	const canvas = document.createElement('canvas');
	canvas.width = Math.max(1, source.width);
	canvas.height = Math.max(1, source.height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('canvas unsupported');
	ctx.drawImage(source, 0, 0);
	return canvas.toDataURL('image/jpeg', quality);
}

async function fileToJpegDataUrl(file: File): Promise<string> {
	if (typeof createImageBitmap === 'function') {
		const bmp = await createImageBitmap(file);
		try {
			return bitmapToJpegDataUrl(bmp);
		} finally {
			bmp.close();
		}
	}
	const objectUrl = URL.createObjectURL(file);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error('image decode failed'));
			el.src = objectUrl;
		});
		return bitmapToJpegDataUrl(img);
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

/** 本地文件 → data URL；非 jpeg/png/gif 先转 JPEG，兼容 DOCX 导出 */
export function fileToDataUrl(file: File): Promise<string> {
	const type = (file.type || '').toLowerCase();
	if (DOCX_SAFE.has(type)) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error('read failed'));
			reader.readAsDataURL(file);
		});
	}
	return fileToJpegDataUrl(file).catch(() => {
		// 浏览器解不了（如部分 heic）时退回原始 data URL，交给服务端 sharp
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error ?? new Error('read failed'));
			reader.readAsDataURL(file);
		});
	});
}

/** 系统文件选择器选本地图片（不用 window.prompt） */
export function pickImageFile(accept = 'image/*'): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.multiple = false;
		let settled = false;
		const done = (file: File | null) => {
			if (settled) return;
			settled = true;
			resolve(file);
		};
		input.onchange = () => done(input.files?.[0] ?? null);
		// Chromium / Tauri WebView 支持 cancel
		input.addEventListener('cancel', () => done(null));
		input.click();
	});
}

export function isImageFile(file: File): boolean {
	return file.type.startsWith('image/');
}

export function clipboardImageFiles(event: ClipboardEvent): File[] {
	const items = event.clipboardData?.items;
	if (!items) return [];
	const out: File[] = [];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		if (!item?.type.startsWith('image/')) continue;
		const file = item.getAsFile();
		if (file) out.push(file);
	}
	return out;
}

/** 剪贴板是否同时携带文本/HTML 内容（用于判断图片+文本混合粘贴） */
export function clipboardHasTextContent(event: ClipboardEvent): boolean {
	const data = event.clipboardData;
	if (!data) return false;
	const html = data.getData('text/html');
	if (html?.trim()) return true;
	const text = data.getData('text/plain');
	if (text?.trim()) return true;
	return false;
}

export function dataTransferImageFiles(dt: DataTransfer | null): File[] {
	if (!dt?.files?.length) return [];
	return [...dt.files].filter(isImageFile);
}

export type ResolveImageSrc = (
	file: File,
) => string | Promise<string | null | undefined>;

export async function insertImages(
	editor: Editor,
	files: File[],
	resolveSrc: ResolveImageSrc,
): Promise<void> {
	for (const file of files) {
		if (!isImageFile(file)) continue;
		const src = await resolveSrc(file);
		if (!src?.trim()) continue;
		editor.chain().focus().setImage({ src: src.trim(), alt: file.name }).run();
	}
}
