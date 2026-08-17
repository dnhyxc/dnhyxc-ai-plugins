/**
 * 笔记预览：点击 img → ImagePreview；下载走 Host downloadBlob（独立预览为 mock）。
 */

import {
	type ReactNode,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import ImagePreview, {
	type SelectedImage,
} from '@/components/design/ImagePreview';

export type HostDownloadBlob = (options: {
	fileName: string;
	data: ArrayBuffer | Uint8Array;
	mimeType?: string;
}) => Promise<{ ok: boolean; hostToasted: boolean; message?: string }>;

type TFn = (key: string, params?: Record<string, unknown>) => string;

function fileNameFromUrl(url: string): string {
	try {
		const path = new URL(url, window.location.href).pathname;
		const base = decodeURIComponent(path.split('/').pop() || '');
		if (base && /\.[a-z0-9]+$/i.test(base)) return base;
	} catch {
		/* ignore */
	}
	return 'image.png';
}

/** 从笔记 HTML 抽出全部图片地址（窗口化预览也能翻页） */
export function extractPreviewImageUrls(html: string): string[] {
	if (!html.trim()) return [];
	try {
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const seen = new Set<string>();
		const out: string[] = [];
		for (const img of doc.querySelectorAll('img')) {
			const src = img.getAttribute('src')?.trim();
			if (!src || seen.has(src)) continue;
			seen.add(src);
			out.push(src);
		}
		return out;
	} catch {
		return [];
	}
}

async function downloadViaBlob(
	url: string,
	downloadBlob?: HostDownloadBlob,
): Promise<void> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = await res.arrayBuffer();
	const mime =
		res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
	const fileName = fileNameFromUrl(url);

	if (downloadBlob) {
		const result = await downloadBlob({ fileName, data, mimeType: mime });
		if (!result.ok) throw new Error(result.message || 'download failed');
		return;
	}

	// 无 Host：浏览器落盘（独立预览兜底）
	const blob = new Blob([data], { type: mime });
	const obj = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = obj;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(obj);
}

export type UseNoteImagePreviewResult = {
	noteImagePreviewModal: ReactNode;
};

/**
 * 在 `rootRef` 子树内委托点击 img，打开 ImagePreview。
 * @param rebindWhen 预览 html / 窗口 origin 变化时重绑，避免 innerHTML 替换后监听失效
 */
export function useNoteImagePreview(options: {
	rootRef: RefObject<HTMLElement | null>;
	/** 全文 HTML，用于图库列表；缺省则只收集当前 DOM 内图片 */
	html?: string;
	downloadBlob?: HostDownloadBlob;
	t?: TFn;
	enabled?: boolean;
	rebindWhen?: unknown;
}): UseNoteImagePreviewResult {
	const {
		rootRef,
		html,
		downloadBlob,
		t,
		enabled = true,
		rebindWhen,
	} = options;

	const [visible, setVisible] = useState(false);
	const [selected, setSelected] = useState<SelectedImage>({ url: '' });
	const [list, setList] = useState<SelectedImage[]>([]);
	const downloadBlobRef = useRef(downloadBlob);
	downloadBlobRef.current = downloadBlob;

	const galleryFromHtml = useMemo(
		() => (html ? extractPreviewImageUrls(html) : null),
		[html],
	);

	useEffect(() => {
		const root = rootRef.current;
		if (!root || !enabled) return;

		const onClick = (e: MouseEvent) => {
			const el = e.target;
			if (!(el instanceof Element)) return;
			const img = el.closest('img');
			if (!img || !root.contains(img)) return;
			const url =
				(img as HTMLImageElement).currentSrc || img.getAttribute('src');
			if (!url?.trim()) return;
			e.preventDefault();
			e.stopPropagation();

			const urls =
				galleryFromHtml && galleryFromHtml.length > 0
					? galleryFromHtml
					: Array.from(root.querySelectorAll('img'))
							.map((node) => {
								const n = node as HTMLImageElement;
								return (n.currentSrc || n.getAttribute('src') || '').trim();
							})
							.filter(Boolean);

			const uniq: string[] = [];
			const seen = new Set<string>();
			for (const u of urls) {
				if (seen.has(u)) continue;
				seen.add(u);
				uniq.push(u);
			}
			const images = uniq.map((u, i) => ({ id: String(i), url: u }));
			const hit =
				images.find((i) => i.url === url) ??
				({ id: '0', url } as SelectedImage);
			setList(images);
			setSelected(hit);
			setVisible(true);
		};

		root.addEventListener('click', onClick);
		return () => root.removeEventListener('click', onClick);
	}, [rootRef, enabled, rebindWhen, galleryFromHtml]);

	const onVisibleChange = useCallback((next: boolean) => {
		setVisible(next);
		if (!next) {
			setSelected({ url: '' });
			setList([]);
		}
	}, []);

	const onDownload = useCallback(async (image: SelectedImage) => {
		if (!image.url) return;
		try {
			await downloadViaBlob(image.url, downloadBlobRef.current);
		} catch (err) {
			console.warn('[note-preview] image download failed', err);
		}
	}, []);

	const noteImagePreviewModal = (
		<ImagePreview
			visible={visible}
			selectedImage={selected}
			imageList={list}
			showDownload
			showPrevAndNext={list.length > 1}
			download={onDownload}
			onVisibleChange={onVisibleChange}
			title={t?.('imagePreview.title')}
			t={t}
		/>
	);

	return { noteImagePreviewModal };
}
