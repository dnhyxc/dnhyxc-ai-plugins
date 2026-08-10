import type { Editor, Extensions, JSONContent } from '@tiptap/react';
import type { ReactNode, UIEventHandler } from 'react';
import type { ResolveImageSrc } from './image';
import type { RichEditorLocale } from './locale';

export type TextDirection = 'ltr' | 'rtl' | 'auto';

export type RichEditorContent = string | JSONContent;

export type RichEditorChangePayload = {
	html: string;
	/** 按需；热路径默认不序列化 JSON */
	json?: JSONContent;
	text: string;
	/** 文档首位 title 节点纯文本 */
	title: string;
};

export type CreateExtensionsOptions = {
	placeholder?: string;
	/** CharacterCount 上限；不传则只统计不限制 */
	maxLength?: number;
	/** 为 false 时不挂 CharacterCount（无字数 UI 且无上限时关掉，避免每键 Segmenter） */
	characterCount?: boolean;
	/** 粘贴/拖放图片解析（默认 FileReader → data URL） */
	resolveImageSrcRef?: { current: ResolveImageSrc };
	/** 追加扩展（在默认扩展之后） */
	extraExtensions?: Extensions;
	/** 完全替换默认扩展列表 */
	extensions?: Extensions;
	/** 是否显示笔记标题节点（默认 true） */
	showTitle?: boolean;
	/** 图片拖拽缩放（默认 false：长文下 NodeView/监听开销大） */
	imageResize?: boolean;
	/** 表格列宽拖拽（默认 false：同上） */
	tableResizable?: boolean;
};

export type RichEditorProps = {
	/** 受控内容（HTML 或 JSON） */
	content?: RichEditorContent;
	/** 非受控初始内容 */
	defaultContent?: RichEditorContent;
	onChange?: (payload: RichEditorChangePayload) => void;
	editable?: boolean;
	autofocus?: boolean | 'start' | 'end' | 'all' | number;
	placeholder?: string;
	className?: string;
	editorClassName?: string;
	/** 字数上限（长文 CharacterCount） */
	maxLength?: number;
	/** 默认文本方向；默认 auto 以支持 RTL */
	textDirection?: TextDirection;
	showToolbar?: boolean;
	showBubbleMenu?: boolean;
	showCharCount?: boolean;
	/** 是否显示笔记标题节点（默认 true） */
	showTitle?: boolean;
	/** 图片拖拽缩放（默认 false） */
	imageResize?: boolean;
	/** 表格列宽拖拽（默认 false） */
	tableResizable?: boolean;
	/** 覆盖 / 合并文案（默认中文） */
	locale?: Partial<RichEditorLocale>;
	/** 完全替换默认扩展 */
	extensions?: Extensions;
	/** 在默认扩展后追加 */
	extraExtensions?: Extensions;
	/** 工具栏尾部插槽，便于业务扩展 */
	toolbarExtra?: ReactNode | ((editor: Editor) => ReactNode);
	/**
	 * 自定义图片上传：工具栏选图 / 粘贴 / 拖放都会走这里。
	 * 不传则本地读成 base64 data URL（Tauri 桌面端可用）。
	 */
	onUploadImage?: ResolveImageSrc;
	onCreate?: (editor: Editor) => void;
	/** 正文 ScrollArea 滚动 */
	onBodyScroll?: UIEventHandler<HTMLDivElement>;
	/** 自定义包裹 EditorContent（长文外层虚拟滚动用） */
	renderBody?: (editorContent: ReactNode) => ReactNode;
};
