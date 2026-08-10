import {
	type UIEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	decoratePreviewHtml,
	preserveEmptyParagraphs,
} from '@/components/design/NotePreview/previewHtml';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
	createLargeNoteDoc,
	EST_BLOCK_H,
	type LargeNoteDoc,
	ORIGIN_HYSTERESIS,
	originForScroll,
	WINDOW_SIZE,
	windowBodyHtml,
} from '../utils';

type Props = {
	html: string;
	className?: string;
};

/**
 * 长文只读预览：与 LargeNoteEditor 同一套滚动窗口，避免全文 DOM 拖垮左侧列表滚动。
 */
export function WindowedPreviewBody({ html, className }: Props) {
	const boot = useMemo(() => createLargeNoteDoc(html), [html]);
	const docRef = useRef<LargeNoteDoc>(boot.doc);
	const originRef = useRef(0);
	const shiftingRef = useRef(false);
	const scrollRafRef = useRef(0);

	const [origin, setOrigin] = useState(0);
	const [offsetY, setOffsetY] = useState(0);
	const blockCount = boot.doc.blocks.length;
	const bodyH = Math.max(blockCount, 1) * EST_BLOCK_H;
	const windowed = blockCount > WINDOW_SIZE;

	docRef.current = boot.doc;

	const windowHtml = useMemo(() => {
		const { html: slice } = windowBodyHtml(boot.doc, origin);
		// 仅文档窗口起点才允许「以图开头 → 首图去顶距」
		return decoratePreviewHtml(preserveEmptyParagraphs(slice), {
			flushLeadingImg: origin === 0,
		});
	}, [boot.doc, origin]);

	const applyOrigin = useCallback((nextOrigin: number) => {
		const doc = docRef.current;
		if (shiftingRef.current) return;
		if (nextOrigin === originRef.current) return;

		const maxOrigin = Math.max(0, doc.blocks.length - WINDOW_SIZE);
		const snapEdge =
			(nextOrigin === 0 && originRef.current !== 0) ||
			(nextOrigin === maxOrigin && originRef.current !== maxOrigin);
		if (
			!snapEdge &&
			Math.abs(nextOrigin - originRef.current) < ORIGIN_HYSTERESIS
		) {
			return;
		}

		shiftingRef.current = true;
		originRef.current = nextOrigin;
		doc.origin = nextOrigin;
		doc.count = Math.min(
			WINDOW_SIZE,
			Math.max(0, doc.blocks.length - nextOrigin),
		);
		setOrigin(nextOrigin);
		setOffsetY(nextOrigin * EST_BLOCK_H);
		requestAnimationFrame(() => {
			shiftingRef.current = false;
		});
	}, []);

	const onScroll = useCallback(
		(e: UIEvent<HTMLDivElement>) => {
			if (shiftingRef.current) return;
			const vp = e.currentTarget;
			const top = Math.max(0, vp.scrollTop);
			const viewH = vp.clientHeight || 600;
			if (scrollRafRef.current) return;
			scrollRafRef.current = requestAnimationFrame(() => {
				scrollRafRef.current = 0;
				if (shiftingRef.current) return;
				applyOrigin(
					originForScroll(
						top,
						viewH,
						docRef.current.blocks.length,
						EST_BLOCK_H,
					),
				);
			});
		},
		[applyOrigin],
	);

	useEffect(
		() => () => {
			if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
		},
		[],
	);

	return (
		<ScrollArea
			className={cn(
				'rich-editor-body note-preview-static text-textcolor min-h-0 flex-1',
				className,
			)}
			onScroll={windowed ? onScroll : undefined}
		>
			{windowed ? (
				<div className="relative w-full" style={{ height: bodyH }}>
					<div
						className="tiptap note-preview-tiptap ProseMirror absolute top-0 right-0 left-0"
						style={{ transform: `translateY(${offsetY}px)` }}
						dangerouslySetInnerHTML={{ __html: windowHtml }}
					/>
				</div>
			) : (
				<div
					className="tiptap note-preview-tiptap ProseMirror relative w-full"
					dangerouslySetInnerHTML={{ __html: windowHtml }}
				/>
			)}
		</ScrollArea>
	);
}
