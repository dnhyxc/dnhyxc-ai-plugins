import {
	type Editor,
	NoteTitleField,
	RichEditor,
	type RichEditorLocale,
	type RichEditorProps,
} from '@design/RichEditor';
import {
	type ReactNode,
	type UIEvent,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from 'react';
import { cn } from '@/lib/utils';
import {
	createLargeNoteDoc,
	EST_BLOCK_H,
	flushWindow,
	type LargeNoteDoc,
	ORIGIN_HYSTERESIS,
	originForScroll,
	stitchFullHtml,
	stitchFullText,
	WINDOW_SIZE,
	windowBodyHtml,
} from '../utils';

export type LargeNoteSaveApi = {
	getHTML: () => string;
	getText: () => string;
	getTitle: () => string;
};

type Props = {
	defaultContent: string;
	locale: Partial<RichEditorLocale>;
	placeholder?: string;
	toolbarExtra?: RichEditorProps['toolbarExtra'];
	className?: string;
	editorClassName?: string;
	onReady: (editor: Editor, save: LargeNoteSaveApi) => void;
	/** 标题或正文变更时回调（用于未保存标记） */
	onChange?: () => void;
};

function bootLargeNote(defaultContent: string) {
	const created = createLargeNoteDoc(defaultContent);
	// 进编辑要对齐短文「光标在文末」：初始就挂最后一窗，避免 focus(end) 停在全文中段
	const maxOrigin = Math.max(0, created.doc.blocks.length - WINDOW_SIZE);
	if (maxOrigin > 0) {
		const { html, count } = windowBodyHtml(created.doc, maxOrigin);
		created.doc.origin = maxOrigin;
		created.doc.count = count;
		created.editorHtml = html;
	}
	return created;
}

function scrollViewportToEnd(editor: Editor) {
	const vp = editor.view.dom.closest(
		'[data-slot="scroll-area-viewport"]',
	) as HTMLElement | null;
	if (vp) vp.scrollTop = vp.scrollHeight;
	if (!editor.isDestroyed) editor.commands.focus('end');
}

/**
 * 长笔记连续滚动编辑。
 * 标题与短文共用 NoteTitleField，自然文档流紧贴正文（勿用固定 TITLE 槽高，否则会留大缝）。
 */
export function LargeNoteEditor({
	defaultContent,
	locale,
	placeholder,
	toolbarExtra,
	className,
	editorClassName,
	onReady,
	onChange,
}: Props) {
	const boot = useRef(bootLargeNote(defaultContent));
	const docRef = useRef<LargeNoteDoc>(boot.current.doc);
	const editorRef = useRef<Editor | null>(null);
	const titleWrapRef = useRef<HTMLDivElement | null>(null);
	const titleHRef = useRef(0);
	const [title, setTitle] = useState(boot.current.title);
	const titleRef = useRef(title);
	titleRef.current = title;
	const originRef = useRef(boot.current.doc.origin);
	const shiftingRef = useRef(false);
	const scrollRafRef = useRef(0);
	const onReadyRef = useRef(onReady);
	onReadyRef.current = onReady;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const [blockCount, setBlockCount] = useState(boot.current.doc.blocks.length);
	const [offsetY, setOffsetY] = useState(boot.current.doc.origin * EST_BLOCK_H);
	/** 块数不足一窗时勿按 WINDOW_SIZE 垫高（大图笔记常因 base64 进长文路径，否则文末巨空白） */
	const windowed = blockCount > WINDOW_SIZE;
	const bodyH = Math.max(blockCount, 1) * EST_BLOCK_H;

	useLayoutEffect(() => {
		const el = titleWrapRef.current;
		if (!el) return;
		const sync = () => {
			titleHRef.current = el.offsetHeight;
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const saveApi = useCallback((): LargeNoteSaveApi => {
		return {
			getHTML: () => {
				const e = editorRef.current;
				const html = e && !e.isDestroyed ? e.getHTML() : '';
				return stitchFullHtml(docRef.current, titleRef.current, html);
			},
			getText: () => {
				const e = editorRef.current;
				const html = e && !e.isDestroyed ? e.getHTML() : '';
				return stitchFullText(docRef.current, titleRef.current, html);
			},
			getTitle: () => titleRef.current.trim(),
		};
	}, []);

	const focusBody = useCallback(() => {
		editorRef.current?.commands.focus('start');
	}, []);

	const onTitleChange = useCallback((next: string) => {
		titleRef.current = next;
		setTitle(next);
		onChangeRef.current?.();
	}, []);

	const applyOrigin = useCallback((editor: Editor, nextOrigin: number) => {
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
		try {
			flushWindow(doc, editor.getHTML());
			const { html, count } = windowBodyHtml(doc, nextOrigin);
			const ok = editor.commands.setContent(html, { emitUpdate: false });
			if (ok === false) return;
			doc.origin = nextOrigin;
			doc.count = count;
			originRef.current = nextOrigin;
			setOffsetY(nextOrigin * EST_BLOCK_H);
			setBlockCount(doc.blocks.length);
		} finally {
			requestAnimationFrame(() => {
				shiftingRef.current = false;
			});
		}
	}, []);

	const onBodyScroll = useCallback(
		(e: UIEvent<HTMLDivElement>) => {
			const editor = editorRef.current;
			if (!editor || editor.isDestroyed || shiftingRef.current) return;
			const vp = e.currentTarget;
			const titleH =
				titleHRef.current || titleWrapRef.current?.offsetHeight || 0;
			const top = Math.max(0, vp.scrollTop - titleH);
			const viewH = vp.clientHeight || 600;
			if (scrollRafRef.current) return;
			scrollRafRef.current = requestAnimationFrame(() => {
				scrollRafRef.current = 0;
				if (shiftingRef.current) return;
				const next = originForScroll(
					top,
					viewH,
					docRef.current.blocks.length,
					EST_BLOCK_H,
				);
				applyOrigin(editor, next);
			});
		},
		[applyOrigin],
	);

	const renderBody = useCallback(
		(editorContent: ReactNode) => (
			<div className="relative w-full">
				{/* 文档流标题：与短文 TipTap node-title 同距，mb-2 即空隙 */}
				<div ref={titleWrapRef} className="relative z-1">
					<NoteTitleField
						value={title}
						onChange={onTitleChange}
						onContinue={focusBody}
					/>
				</div>
				{windowed ? (
					<div className="relative w-full" style={{ height: bodyH }}>
						<div
							className="absolute top-0 right-0 left-0"
							style={{ transform: `translateY(${offsetY}px)` }}
						>
							{editorContent}
						</div>
					</div>
				) : (
					<div className="relative w-full">{editorContent}</div>
				)}
			</div>
		),
		[bodyH, focusBody, offsetY, onTitleChange, title, windowed],
	);

	return (
		<div className={cn('flex h-full min-h-0 min-w-0 flex-col', className)}>
			<RichEditor
				defaultContent={boot.current.editorHtml}
				showTitle={false}
				autofocus={false}
				placeholder={placeholder}
				locale={locale}
				showCharCount={false}
				showBubbleMenu={false}
				onBodyScroll={onBodyScroll}
				renderBody={renderBody}
				onChange={() => onChangeRef.current?.()}
				onCreate={(e) => {
					editorRef.current = e;
					docRef.current.origin = originRef.current;
					onReadyRef.current(e, saveApi());
					// 布局完成后再滚到底 + 焦点文末（双 rAF 等绝对定位 offset 生效）
					requestAnimationFrame(() => {
						scrollViewportToEnd(e);
						requestAnimationFrame(() => scrollViewportToEnd(e));
					});
				}}
				className="flex min-h-0 flex-1 flex-col overflow-hidden"
				editorClassName={editorClassName}
				toolbarExtra={toolbarExtra}
			/>
		</div>
	);
}
