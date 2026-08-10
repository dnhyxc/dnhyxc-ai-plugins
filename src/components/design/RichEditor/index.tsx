import { isTextSelection } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import {
	EditorContent,
	EditorContext,
	useEditor,
	useEditorState,
} from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { createExtensions } from './extensions';
import { fileToDataUrl, type ResolveImageSrc } from './image';
import { LinkForm, useLinkEditor } from './link';
import { type RichEditorLocale, zhCN } from './locale';
import './styles.css';
import { getDocTitleText, normalizeNoteContent } from './title';
import { FormatBubble, Toolbar } from './toolbar';
import type { RichEditorProps } from './types';

function mergeLocale(
	partial?: Partial<RichEditorLocale>,
	base: RichEditorLocale = zhCN,
): RichEditorLocale {
	return { ...base, ...partial };
}

function CharCount({
	editor,
	locale,
	maxLength,
}: {
	editor: Editor;
	locale: RichEditorLocale;
	maxLength?: number;
}) {
	const count = useEditorState({
		editor,
		selector: ({ editor: e }) => {
			const storage = e.storage.characterCount as
				| { characters: () => number; words: () => number }
				| undefined;
			return {
				chars: storage?.characters() ?? 0,
				words: storage?.words() ?? 0,
			};
		},
	});

	const over = maxLength != null && count.chars >= maxLength;

	return (
		<div className={cn('rich-editor-footer', over && 'is-limit')}>
			<span>
				{count.words} {locale.words}
			</span>
			<span>
				{count.chars}
				{maxLength != null ? ` / ${maxLength}` : ''} {locale.chars}
				{over ? ` · ${locale.limitReached}` : ''}
			</span>
		</div>
	);
}

/**
 * TipTap 二次封装富文本编辑器。
 * - 默认中文 UI
 * - 内置 Formatting / 表格 / 本地图片(选图·粘贴·拖放) / 任务 / 字数 / RTL
 * - 通过 extraExtensions / toolbarExtra / onUploadImage 扩展
 */
export function RichEditor({
	content,
	defaultContent = '',
	onChange,
	editable = true,
	autofocus = true,
	placeholder,
	className,
	editorClassName,
	maxLength,
	textDirection = 'auto',
	showToolbar = true,
	showBubbleMenu = true,
	showCharCount = true,
	showTitle = true,
	imageResize = false,
	tableResizable = false,
	locale: localePartial,
	extensions,
	extraExtensions,
	toolbarExtra,
	onUploadImage,
	onCreate,
	onBodyScroll,
	renderBody,
}: RichEditorProps) {
	const locale = useMemo(() => mergeLocale(localePartial), [localePartial]);

	const resolveImageSrcRef = useRef<ResolveImageSrc>(fileToDataUrl);
	resolveImageSrcRef.current = async (file) => {
		if (onUploadImage) return onUploadImage(file);
		return fileToDataUrl(file);
	};

	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const onCreateRef = useRef(onCreate);
	onCreateRef.current = onCreate;

	// 无字数 UI 且无上限时不挂 CharacterCount，避免每键 Segmenter
	const enableCharacterCount = showCharCount || maxLength != null;

	const editor = useEditor({
		immediatelyRender: false,
		extensions: createExtensions({
			placeholder: placeholder ?? locale.placeholder,
			maxLength,
			characterCount: enableCharacterCount,
			extensions,
			extraExtensions,
			resolveImageSrcRef,
			showTitle,
			imageResize,
			tableResizable,
		}),
		content: showTitle
			? normalizeNoteContent(content ?? defaultContent)
			: (content ?? defaultContent ?? ''),
		editable,
		autofocus,
		textDirection,
		editorProps: {
			attributes: {
				class: cn('tiptap focus:outline-none', editorClassName),
				lang: 'zh-CN',
			},
		},
		onCreate: ({ editor: e }) => {
			const focusBodyEnd = () => {
				if (e.isDestroyed) return;
				// 有 title 节点，或显式 autofocus=end：都钉到正文末尾
				if (
					autofocus === 'end' ||
					e.state.doc.firstChild?.type.name === 'title'
				) {
					e.commands.focus('end');
				}
			};
			focusBodyEnd();
			// Title NodeView 挂载可能打乱选区，下一帧再钉到末尾
			requestAnimationFrame(() => {
				focusBodyEnd();
				requestAnimationFrame(focusBodyEnd);
			});
			onCreateRef.current?.(e);
		},
		onUpdate: ({ editor: e }) => {
			const cb = onChangeRef.current;
			if (!cb) return;
			// 热路径不做 getJSON（学习笔记等只用 html/text/title）
			cb({
				html: e.getHTML(),
				text: e.getText({ blockSeparator: '\n\n' }),
				title: getDocTitleText(e.state.doc),
			});
		},
	});

	const link = useLinkEditor(editor);
	const linkDraftRef = useRef(link.draft);
	linkDraftRef.current = link.draft;

	/** 仅有真实文本选区时显示；补回 TipTap 默认的空块判断，避免空段落误显 */
	const shouldShowBubble = useCallback(
		({
			editor: e,
			view,
			state,
			from,
			to,
		}: {
			editor: Editor;
			view: { hasFocus: () => boolean };
			state: {
				doc: { textBetween: (a: number, b: number) => string };
				selection: { empty: boolean };
			};
			from: number;
			to: number;
		}) => {
			if (linkDraftRef.current || !e.isEditable) return false;
			if (!view.hasFocus()) return false;
			const { doc, selection } = state;
			if (
				!isTextSelection(selection) ||
				selection.empty ||
				from === to ||
				!doc.textBetween(from, to).length
			) {
				return false;
			}
			if (e.isActive('image') || e.isActive('codeBlock')) return false;
			return true;
		},
		[],
	);

	useEffect(() => {
		if (!editor) return;
		editor.setEditable(editable);
	}, [editor, editable]);

	// 受控同步：仅在外部 content 与当前不一致时写入，避免打断输入
	useEffect(() => {
		if (!editor || content === undefined) return;
		const next =
			typeof content === 'string' ? content : JSON.stringify(content);
		const current =
			typeof content === 'string'
				? editor.getHTML()
				: JSON.stringify(editor.getJSON());
		if (next === current) return;
		editor.commands.setContent(normalizeNoteContent(content), {
			emitUpdate: false,
		});
	}, [editor, content]);

	const ctx = useMemo(() => ({ editor }), [editor]);

	const extra = useMemo(() => {
		if (!editor) return null;
		return typeof toolbarExtra === 'function'
			? toolbarExtra(editor)
			: toolbarExtra;
	}, [editor, toolbarExtra]);

	if (!editor) return null;

	return (
		<EditorContext.Provider value={ctx}>
			<div className={cn('rich-editor rounded-r-md', className)} lang="zh-CN">
				{showToolbar && (
					<Toolbar
						editor={editor}
						locale={locale}
						onUploadImage={onUploadImage}
						onOpenLink={link.open}
						linkOpen={!!link.draft}
						extra={extra}
					/>
				)}

				{link.draft && (
					<LinkForm
						locale={locale}
						href={link.draft.href}
						onHrefChange={link.setHref}
						onApply={link.apply}
						onRemove={link.remove}
						onClose={link.close}
						hint={link.draft.range ? undefined : locale.linkEmptyHint}
					/>
				)}

				{showBubbleMenu && (
					<BubbleMenu
						editor={editor}
						shouldShow={shouldShowBubble}
						options={{ placement: 'top', offset: 8, flip: true }}
					>
						<FormatBubble
							editor={editor}
							locale={locale}
							onOpenLink={link.open}
						/>
					</BubbleMenu>
				)}

				<ScrollArea className="rich-editor-body" onScroll={onBodyScroll}>
					{renderBody ? (
						renderBody(<EditorContent editor={editor} spellCheck="false" />)
					) : (
						<EditorContent editor={editor} spellCheck="false" />
					)}
				</ScrollArea>

				{showCharCount && (
					<CharCount editor={editor} locale={locale} maxLength={maxLength} />
				)}
			</div>
		</EditorContext.Provider>
	);
}

export default RichEditor;
export type { Editor } from '@tiptap/react';
export type { CodeLanguage } from './code';
export { CODE_LANGUAGES } from './code';
export { createExtensions } from './extensions';
export type { ResolveImageSrc } from './image';
export { fileToDataUrl, pickImageFile } from './image';
export type { RichEditorLocale } from './locale';
export { enUS, richEditorLocaleOf, zhCN } from './locale';
export {
	EMPTY_NOTE_DOC,
	getDocTitleText,
	NoteTitleField,
	normalizeNoteContent,
	TitleNode,
} from './title';
export { Btn } from './toolbar';
export type {
	CreateExtensionsOptions,
	RichEditorChangePayload,
	RichEditorContent,
	RichEditorProps,
	TextDirection,
} from './types';
