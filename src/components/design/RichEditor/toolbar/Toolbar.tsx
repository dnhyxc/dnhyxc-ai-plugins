import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
	AlignCenter,
	AlignJustify,
	AlignLeft,
	AlignRight,
	Bold,
	CheckSquare,
	Code,
	Heading,
	Heading1,
	Heading2,
	Heading3,
	Heading4,
	Heading5,
	Highlighter,
	ImageIcon,
	Italic,
	Link2,
	Link2Off,
	List,
	ListOrdered,
	Minus,
	MoreHorizontal,
	Quote,
	Redo2,
	RemoveFormatting,
	Strikethrough,
	Table,
	Underline,
	Undo2,
} from 'lucide-react';
import {
	Fragment,
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { CODE_LANGUAGES } from '../code';
import {
	fileToDataUrl,
	insertImages,
	pickImageFile,
	type ResolveImageSrc,
} from '../image';
import type { RichEditorLocale } from '../locale';

type Props = {
	editor: Editor;
	locale: RichEditorLocale;
	onUploadImage?: ResolveImageSrc;
	onOpenLink: () => void;
	linkOpen?: boolean;
	extra?: ReactNode;
	className?: string;
};

type ToolItem = {
	id: string;
	/** 工具栏内联节点 */
	node: ReactNode;
	/** 「更多」菜单内节点；缺省则仅内联展示 */
	menu?: ReactNode;
};

const ICON = 15;
/** More 按钮自身宽度（1.75rem + ml-0.5），不含 flex gap */
const MORE_W = 30;

export function Btn({
	title,
	active,
	disabled,
	onClick,
	children,
	className,
}: {
	title: string;
	active?: boolean;
	disabled?: boolean;
	onClick: (e?: MouseEvent) => void;
	children: ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-label={title}
			aria-pressed={active}
			disabled={disabled}
			className={cn(
				'rich-editor-btn lucide-stroke-draw-hover ml-0.5 [&_svg]:overflow-visible',
				active && 'is-active',
				className,
			)}
			onMouseDown={(e) => e.preventDefault()}
			onClick={(e) => onClick(e as unknown as MouseEvent)}
		>
			{children}
		</button>
	);
}

function MenuRow({
	title,
	active,
	disabled,
	onSelect,
	children,
}: {
	title: string;
	active?: boolean;
	disabled?: boolean;
	onSelect: () => void;
	children: ReactNode;
}) {
	return (
		<DropdownMenuItem
			disabled={disabled}
			title={title}
			className={cn(active && 'bg-theme/10')}
			onSelect={onSelect}
		>
			<div className="flex w-full items-center gap-2">
				{children}
				<span className="text-sm text-textcolor/90">{title}</span>
			</div>
		</DropdownMenuItem>
	);
}

export function Toolbar({
	editor,
	locale: t,
	onUploadImage,
	onOpenLink,
	linkOpen,
	extra,
	className,
}: Props) {
	const state = useEditorState({
		editor,
		selector: ({ editor: e }) => ({
			bold: e.isActive('bold'),
			italic: e.isActive('italic'),
			underline: e.isActive('underline'),
			strike: e.isActive('strike'),
			code: e.isActive('code'),
			highlight: e.isActive('highlight'),
			h1: e.isActive('heading', { level: 1 }),
			h2: e.isActive('heading', { level: 2 }),
			h3: e.isActive('heading', { level: 3 }),
			h4: e.isActive('heading', { level: 4 }),
			h5: e.isActive('heading', { level: 5 }),
			bullet: e.isActive('bulletList'),
			ordered: e.isActive('orderedList'),
			task: e.isActive('taskList'),
			quote: e.isActive('blockquote'),
			codeBlock: e.isActive('codeBlock'),
			codeLanguage:
				(e.getAttributes('codeBlock').language as string | undefined) ??
				'javascript',
			link: e.isActive('link'),
			alignLeft: e.isActive({ textAlign: 'left' }),
			alignCenter: e.isActive({ textAlign: 'center' }),
			alignRight: e.isActive({ textAlign: 'right' }),
			alignJustify: e.isActive({ textAlign: 'justify' }),
			inTable: e.isActive('table'),
			canUndo: e.can().undo(),
			canRedo: e.can().redo(),
		}),
	});

	const insertImage = async () => {
		const file = await pickImageFile();
		if (!file) return;
		const resolve = onUploadImage ?? fileToDataUrl;
		await insertImages(editor, [file], resolve);
	};

	const HEADING_LEVELS = [
		{ level: 1 as const, icon: Heading1, title: t.h1 },
		{ level: 2 as const, icon: Heading2, title: t.h2 },
		{ level: 3 as const, icon: Heading3, title: t.h3 },
		{ level: 4 as const, icon: Heading4, title: t.h4 },
		{ level: 5 as const, icon: Heading5, title: t.h5 },
	];

	const activeHeading =
		HEADING_LEVELS.find(({ level }) => state[`h${level}` as const]) ?? null;
	const HeadingTriggerIcon = activeHeading?.icon ?? Heading;

	const handleHeading = (level: 1 | 2 | 3 | 4 | 5) => {
		editor.chain().focus().toggleHeading({ level }).run();
	};

	const tools = useMemo((): ToolItem[] => {
		const items: ToolItem[] = [
			{
				id: 'undo',
				node: (
					<Btn
						title={t.undo}
						disabled={!state.canUndo}
						className="ml-0"
						onClick={() => editor.chain().focus().undo().run()}
					>
						<Undo2 size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.undo}
						disabled={!state.canUndo}
						onSelect={() => editor.chain().focus().undo().run()}
					>
						<Undo2 size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'redo',
				node: (
					<Btn
						title={t.redo}
						disabled={!state.canRedo}
						onClick={() => editor.chain().focus().redo().run()}
					>
						<Redo2 size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.redo}
						disabled={!state.canRedo}
						onSelect={() => editor.chain().focus().redo().run()}
					>
						<Redo2 size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'bold',
				node: (
					<Btn
						title={t.bold}
						active={state.bold}
						onClick={() => editor.chain().focus().toggleBold().run()}
					>
						<Bold size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.bold}
						active={state.bold}
						onSelect={() => editor.chain().focus().toggleBold().run()}
					>
						<Bold size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'italic',
				node: (
					<Btn
						title={t.italic}
						active={state.italic}
						onClick={() => editor.chain().focus().toggleItalic().run()}
					>
						<Italic size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.italic}
						active={state.italic}
						onSelect={() => editor.chain().focus().toggleItalic().run()}
					>
						<Italic size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'underline',
				node: (
					<Btn
						title={t.underline}
						active={state.underline}
						onClick={() => editor.chain().focus().toggleUnderline().run()}
					>
						<Underline size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.underline}
						active={state.underline}
						onSelect={() => editor.chain().focus().toggleUnderline().run()}
					>
						<Underline size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'strike',
				node: (
					<Btn
						title={t.strike}
						active={state.strike}
						onClick={() => editor.chain().focus().toggleStrike().run()}
					>
						<Strikethrough size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.strike}
						active={state.strike}
						onSelect={() => editor.chain().focus().toggleStrike().run()}
					>
						<Strikethrough size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'highlight',
				node: (
					<Btn
						title={t.highlight}
						active={state.highlight}
						onClick={() => editor.chain().focus().toggleHighlight().run()}
					>
						<Highlighter size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.highlight}
						active={state.highlight}
						onSelect={() => editor.chain().focus().toggleHighlight().run()}
					>
						<Highlighter size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'clearFormat',
				node: (
					<Btn
						title={t.clearFormat}
						onClick={() =>
							editor.chain().focus().unsetAllMarks().clearNodes().run()
						}
					>
						<RemoveFormatting size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.clearFormat}
						onSelect={() =>
							editor.chain().focus().unsetAllMarks().clearNodes().run()
						}
					>
						<RemoveFormatting size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'heading',
				node: (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								title={activeHeading?.title ?? '标题级别'}
								aria-label={activeHeading?.title ?? '标题级别'}
								className={cn(
									'rich-editor-btn lucide-stroke-draw-hover ml-0.5 [&_svg]:overflow-visible',
									activeHeading && 'is-active',
								)}
								onMouseDown={(e) => e.preventDefault()}
							>
								<HeadingTriggerIcon size={ICON} />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="center"
							sideOffset={8}
							className="w-20"
							onCloseAutoFocus={(e) => e.preventDefault()}
						>
							<DropdownMenuGroup>
								<DropdownMenuLabel className="text-textcolor/90">
									标题级别
								</DropdownMenuLabel>
								{HEADING_LEVELS.map(({ level, icon: Icon, title }) => {
									const active = state[`h${level}` as const];
									return (
										<DropdownMenuItem
											key={level}
											title={title}
											className={cn(active && 'bg-theme/10')}
											onSelect={() => handleHeading(level)}
										>
											<div className="flex w-full items-center justify-between">
												<Icon size={ICON} className="text-textcolor" />
												<span className="text-sm text-textcolor/90">
													{title}
												</span>
											</div>
										</DropdownMenuItem>
									);
								})}
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				),
				menu: (
					<>
						<DropdownMenuLabel className="text-textcolor/90">
							标题级别
						</DropdownMenuLabel>
						{HEADING_LEVELS.map(({ level, icon: Icon, title }) => {
							const active = state[`h${level}` as const];
							return (
								<MenuRow
									key={level}
									title={title}
									active={active}
									onSelect={() => handleHeading(level)}
								>
									<Icon size={ICON} />
								</MenuRow>
							);
						})}
					</>
				),
			},
			{
				id: 'bullet',
				node: (
					<Btn
						title={t.bulletList}
						active={state.bullet}
						onClick={() => editor.chain().focus().toggleBulletList().run()}
					>
						<List size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.bulletList}
						active={state.bullet}
						onSelect={() => editor.chain().focus().toggleBulletList().run()}
					>
						<List size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'ordered',
				node: (
					<Btn
						title={t.orderedList}
						active={state.ordered}
						onClick={() => editor.chain().focus().toggleOrderedList().run()}
					>
						<ListOrdered size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.orderedList}
						active={state.ordered}
						onSelect={() => editor.chain().focus().toggleOrderedList().run()}
					>
						<ListOrdered size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'task',
				node: (
					<Btn
						title={t.taskList}
						active={state.task}
						onClick={() => editor.chain().focus().toggleTaskList().run()}
					>
						<CheckSquare size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.taskList}
						active={state.task}
						onSelect={() => editor.chain().focus().toggleTaskList().run()}
					>
						<CheckSquare size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'quote',
				node: (
					<Btn
						title={t.blockquote}
						active={state.quote}
						onClick={() => editor.chain().focus().toggleBlockquote().run()}
					>
						<Quote size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.blockquote}
						active={state.quote}
						onSelect={() => editor.chain().focus().toggleBlockquote().run()}
					>
						<Quote size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'codeBlock',
				node: (
					<Btn
						title={t.codeBlock}
						active={state.codeBlock}
						onClick={() =>
							editor
								.chain()
								.focus()
								.toggleCodeBlock({
									language: state.codeLanguage || 'javascript',
								})
								.run()
						}
					>
						<Code size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.codeBlock}
						active={state.codeBlock}
						onSelect={() =>
							editor
								.chain()
								.focus()
								.toggleCodeBlock({
									language: state.codeLanguage || 'javascript',
								})
								.run()
						}
					>
						<Code size={ICON} />
					</MenuRow>
				),
			},
		];

		if (state.codeBlock) {
			items.push({
				id: 'codeLanguage',
				node: (
					<select
						className="rich-editor-lang"
						title={t.codeLanguage}
						aria-label={t.codeLanguage}
						value={state.codeLanguage}
						onMouseDown={(e) => e.stopPropagation()}
						onChange={(e) => {
							editor
								.chain()
								.focus()
								.updateAttributes('codeBlock', { language: e.target.value })
								.run();
						}}
					>
						{CODE_LANGUAGES.map((lang) => (
							<option key={lang.value} value={lang.value}>
								{lang.label}
							</option>
						))}
					</select>
				),
				menu: (
					<>
						<DropdownMenuLabel className="text-textcolor/90">
							{t.codeLanguage}
						</DropdownMenuLabel>
						{CODE_LANGUAGES.map((lang) => (
							<MenuRow
								key={lang.value}
								title={lang.label}
								active={state.codeLanguage === lang.value}
								onSelect={() =>
									editor
										.chain()
										.focus()
										.updateAttributes('codeBlock', { language: lang.value })
										.run()
								}
							>
								<Code size={ICON} />
							</MenuRow>
						))}
					</>
				),
			});
		}

		items.push(
			{
				id: 'hr',
				node: (
					<Btn
						title={t.horizontalRule}
						onClick={() => editor.chain().focus().setHorizontalRule().run()}
					>
						<Minus size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.horizontalRule}
						onSelect={() => editor.chain().focus().setHorizontalRule().run()}
					>
						<Minus size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'alignLeft',
				node: (
					<Btn
						title={t.alignLeft}
						active={state.alignLeft}
						onClick={() => editor.chain().focus().setTextAlign('left').run()}
					>
						<AlignLeft size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.alignLeft}
						active={state.alignLeft}
						onSelect={() => editor.chain().focus().setTextAlign('left').run()}
					>
						<AlignLeft size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'alignCenter',
				node: (
					<Btn
						title={t.alignCenter}
						active={state.alignCenter}
						onClick={() => editor.chain().focus().setTextAlign('center').run()}
					>
						<AlignCenter size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.alignCenter}
						active={state.alignCenter}
						onSelect={() => editor.chain().focus().setTextAlign('center').run()}
					>
						<AlignCenter size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'alignRight',
				node: (
					<Btn
						title={t.alignRight}
						active={state.alignRight}
						onClick={() => editor.chain().focus().setTextAlign('right').run()}
					>
						<AlignRight size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.alignRight}
						active={state.alignRight}
						onSelect={() => editor.chain().focus().setTextAlign('right').run()}
					>
						<AlignRight size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'alignJustify',
				node: (
					<Btn
						title={t.alignJustify}
						active={state.alignJustify}
						onClick={() => editor.chain().focus().setTextAlign('justify').run()}
					>
						<AlignJustify size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.alignJustify}
						active={state.alignJustify}
						onSelect={() =>
							editor.chain().focus().setTextAlign('justify').run()
						}
					>
						<AlignJustify size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'link',
				node: (
					<Btn
						title={t.link}
						active={state.link || !!linkOpen}
						onClick={onOpenLink}
					>
						<Link2 size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.link}
						active={state.link || !!linkOpen}
						onSelect={onOpenLink}
					>
						<Link2 size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'unlink',
				node: (
					<Btn
						title={t.unlink}
						disabled={!state.link}
						onClick={() => editor.chain().focus().unsetLink().run()}
					>
						<Link2Off size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.unlink}
						disabled={!state.link}
						onSelect={() => editor.chain().focus().unsetLink().run()}
					>
						<Link2Off size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'image',
				node: (
					<Btn title={t.imagePick} onClick={() => void insertImage()}>
						<ImageIcon size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow title={t.imagePick} onSelect={() => void insertImage()}>
						<ImageIcon size={ICON} />
					</MenuRow>
				),
			},
			{
				id: 'table',
				node: (
					<Btn
						title={t.table}
						onClick={() =>
							editor
								.chain()
								.focus()
								.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
								.run()
						}
					>
						<Table size={ICON} />
					</Btn>
				),
				menu: (
					<MenuRow
						title={t.table}
						onSelect={() =>
							editor
								.chain()
								.focus()
								.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
								.run()
						}
					>
						<Table size={ICON} />
					</MenuRow>
				),
			},
		);

		if (state.inTable) {
			items.push(
				{
					id: 'addCol',
					node: (
						<Btn
							title={t.addColumnAfter}
							onClick={() => editor.chain().focus().addColumnAfter().run()}
						>
							<span className="text-[10px] font-semibold">+列</span>
						</Btn>
					),
					menu: (
						<MenuRow
							title={t.addColumnAfter}
							onSelect={() => editor.chain().focus().addColumnAfter().run()}
						>
							<span className="text-[10px] font-semibold">+列</span>
						</MenuRow>
					),
				},
				{
					id: 'addRow',
					node: (
						<Btn
							title={t.addRowAfter}
							onClick={() => editor.chain().focus().addRowAfter().run()}
						>
							<span className="text-[10px] font-semibold">+行</span>
						</Btn>
					),
					menu: (
						<MenuRow
							title={t.addRowAfter}
							onSelect={() => editor.chain().focus().addRowAfter().run()}
						>
							<span className="text-[10px] font-semibold">+行</span>
						</MenuRow>
					),
				},
				{
					id: 'delTable',
					node: (
						<Btn
							title={t.deleteTable}
							onClick={() => editor.chain().focus().deleteTable().run()}
						>
							<span className="text-[10px] font-semibold">删表</span>
						</Btn>
					),
					menu: (
						<MenuRow
							title={t.deleteTable}
							onSelect={() => editor.chain().focus().deleteTable().run()}
						>
							<span className="text-[10px] font-semibold">删表</span>
						</MenuRow>
					),
				},
			);
		}

		return items;
		// ponytail: tools 随编辑状态重建；溢出宽度靠 measure 重算
		// eslint-disable-next-line react-hooks/exhaustive-deps -- 与 state / locale 字段对齐即可
	}, [editor, t, state, linkOpen, onOpenLink, onUploadImage]);

	const rootRef = useRef<HTMLDivElement>(null);
	const extraRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLDivElement>(null);
	const [visibleCount, setVisibleCount] = useState(tools.length);

	useLayoutEffect(() => {
		const root = rootRef.current;
		const measure = measureRef.current;
		if (!root || !measure) return;

		const recalc = () => {
			const cs = getComputedStyle(root);
			const padX =
				(parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
			const gap = parseFloat(cs.columnGap || cs.gap) || 0;
			const contentW = root.clientWidth - padX;
			const extraW = extraRef.current?.offsetWidth ?? 0;

			/** [start=tools+more][+extra] 是否放得进 contentW */
			const fits = (toolsW: number, withMore: boolean) => {
				const startW = toolsW + (withMore ? MORE_W : 0);
				let used = startW;
				if (extraW > 0) used += extraW + gap;
				// 偏保守，避免亚像素导致多塞一项被裁切
				return used <= contentW - 0.5;
			};

			const nodes = [...measure.children] as HTMLElement[];
			if (nodes.length === 0) {
				setVisibleCount(0);
				return;
			}

			const widths = nodes.map((el) => el.getBoundingClientRect().width);
			const total = widths.reduce((a, b) => a + b, 0);

			// 全放下：不显示 More
			if (fits(total, false)) {
				setVisibleCount(widths.length);
				return;
			}

			let used = 0;
			let count = 0;
			for (const w of widths) {
				if (!fits(used + w, true)) break;
				used += w;
				count += 1;
			}
			setVisibleCount(count);
		};

		recalc();
		const ro = new ResizeObserver(recalc);
		ro.observe(root);
		if (extraRef.current) ro.observe(extraRef.current);
		return () => ro.disconnect();
		// ponytail: 勿依赖 tools 引用——每键 state 变都会新数组，触发全量 getBoundingClientRect
		// 按钮槽位数 / 文案 / 右侧插槽变化时才需要重测
		// eslint-disable-next-line react-hooks/exhaustive-deps -- tools.length 足够代表槽位变化
	}, [tools.length, t, linkOpen]);

	const visible = tools.slice(0, visibleCount);
	const overflow = tools.slice(visibleCount);
	const showMore = overflow.length > 0;

	return (
		<div
			ref={rootRef}
			className={cn(
				'rich-editor-toolbar px-1.5 flex h-10 items-center justify-between border-b border-theme/10',
				className,
			)}
			role="toolbar"
			aria-label="格式工具栏"
		>
			{/* 隐形测量行：与真实按钮同构，用于算每项宽度 */}
			<div ref={measureRef} className="rich-editor-toolbar-measure" aria-hidden>
				{tools.map((item) => (
					<span key={item.id} className="inline-flex shrink-0">
						{item.node}
					</span>
				))}
			</div>

			<div className="rich-editor-toolbar-start">
				<div className="rich-editor-toolbar-main">
					{visible.map((item) => (
						<span key={item.id} className="inline-flex shrink-0">
							{item.node}
						</span>
					))}
				</div>

				{showMore ? (
					<span className="rich-editor-toolbar-more inline-flex shrink-0">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									title="更多"
									aria-label="更多"
									className="rich-editor-btn lucide-stroke-draw-hover ml-0.5 [&_svg]:overflow-visible"
									onMouseDown={(e) => e.preventDefault()}
								>
									<MoreHorizontal size={ICON} />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								sideOffset={8}
								className="min-w-40"
								onCloseAutoFocus={(e) => e.preventDefault()}
							>
								<DropdownMenuGroup>
									{overflow.map((item) => (
										<Fragment key={item.id}>{item.menu}</Fragment>
									))}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</span>
				) : null}
			</div>

			{extra != null && (
				<div ref={extraRef} className="rich-editor-toolbar-extra shrink-0">
					<div className="rich-editor-toolbar-group">{extra}</div>
				</div>
			)}
		</div>
	);
}
