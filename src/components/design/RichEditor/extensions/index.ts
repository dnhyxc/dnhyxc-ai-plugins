import { Extension } from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Document from '@tiptap/extension-document';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extension-placeholder';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { CharacterCount } from '@tiptap/extensions';
import type { Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { fileToDataUrl, ImageUpload } from '../image';
import { zhCN } from '../locale';
import { indentEditor, TitleNode } from '../title';
import type { CreateExtensionsOptions } from '../types';
import { EmptyParagraphDelete } from './EmptyParagraphDelete';

const lowlight = createLowlight(common);

/** Tab：列表下沉 / 正文插入缩进；并吞掉默认焦点切换（避免跳到标题 input） */
const TabIndent = Extension.create({
	name: 'tabIndent',
	priority: 1000,
	addKeyboardShortcuts() {
		return {
			Tab: ({ editor }) => {
				if (editor.isActive('codeBlock')) return false;
				return indentEditor(editor);
			},
			'Shift-Tab': ({ editor }) => {
				if (editor.isActive('codeBlock')) return false;
				if (editor.commands.liftListItem('listItem')) return true;
				if (editor.commands.liftListItem('taskItem')) return true;
				return true;
			},
		};
	},
});

function scrollEditorViewport(
	editor: { view: { dom: Element } },
	to: 'top' | 'bottom',
) {
	const vp = editor.view.dom.closest(
		'[data-slot="scroll-area-viewport"]',
	) as HTMLElement | null;
	if (!vp) return;
	vp.scrollTop = to === 'top' ? 0 : vp.scrollHeight;
}

/** Cmd/Ctrl+↑↓：滚到顶/底并落光标（避开 title atom 把 ↑ 纠到文末） */
const DocEdgeNav = Extension.create({
	name: 'docEdgeNav',
	addKeyboardShortcuts() {
		return {
			'Mod-ArrowUp': ({ editor }) => {
				if (editor.isActive('codeBlock')) return false;
				const title = editor.state.doc.firstChild;
				const start = title?.type.name === 'title' ? title.nodeSize + 1 : 1;
				if (start <= editor.state.doc.content.size) {
					editor.chain().setTextSelection(start).focus().run();
				} else {
					editor.commands.focus('start');
				}
				scrollEditorViewport(editor, 'top');
				return true;
			},
			'Mod-ArrowDown': ({ editor }) => {
				if (editor.isActive('codeBlock')) return false;
				editor.commands.focus('end');
				scrollEditorViewport(editor, 'bottom');
				return true;
			},
		};
	},
});

/** 首位固定 title，其后至少一段正文（避免仅有 atom 时 GapCursor 无法输入） */
const CustomDocument = Document.extend({
	content: 'title block+',
});

/** 组装默认扩展；业务可通过 extensions / extraExtensions 覆盖或追加 */
export function createExtensions(
	options: CreateExtensionsOptions = {},
): Extensions {
	if (options.extensions) return options.extensions;

	const placeholder = options.placeholder ?? zhCN.placeholder;
	const resolveImageSrcRef = options.resolveImageSrcRef ?? {
		current: fileToDataUrl,
	};
	// 默认开启；显式 false 时跳过（无字数 UI 且无上限）
	const withCharCount = options.characterCount !== false;
	// 默认显示标题
	const withTitle = options.showTitle !== false;

	const baseExtensions: Extensions = [
		...(withTitle ? [CustomDocument, TitleNode] : []),
		TabIndent,
		DocEdgeNav,
		EmptyParagraphDelete,
		StarterKit.configure({
			document: withTitle ? false : undefined,
			trailingNode: {
				node: 'paragraph',
			},
			heading: { levels: [1, 2, 3, 4, 5] },
			codeBlock: false,
			// TipTap 3：undoRedo（非 history）；长文降低深度，减轻内存与事务
			undoRedo: { depth: 50 },
			link: {
				openOnClick: false,
				autolink: true,
				defaultProtocol: 'https',
				HTMLAttributes: {
					rel: 'noopener noreferrer',
					target: '_blank',
				},
			},
		}),
		CodeBlockLowlight.configure({
			lowlight,
			defaultLanguage: 'javascript',
			enableTabIndentation: true,
			tabSize: 2,
			HTMLAttributes: { class: 'hljs' },
		}),
		Placeholder.configure({
			placeholder: ({ editor, node }) => {
				if (withTitle && node.type.name === 'title') return '';
				if (node.type.name === 'heading') {
					return `${zhCN.placeholderHeading} ${node.attrs.level}`;
				}
				void editor;
				return placeholder;
			},
			emptyEditorClass: 'is-editor-empty',
			emptyNodeClass: 'is-empty',
			showOnlyCurrent: true,
			showOnlyWhenEditable: true,
		}),
		Highlight.configure({ multicolor: true }),
		TextAlign.configure({
			types: ['heading', 'paragraph'],
			alignments: ['left', 'center', 'right', 'justify'],
		}),
		Image.configure({
			inline: false,
			allowBase64: true,
			HTMLAttributes: {
				class: 'rich-editor-image',
				// 内联间距/圆角：刷新后 MF @scope 样式常失效，不依赖 stylesheet
				style: 'margin: 0.75em 0; border-radius: 0.5rem',
			},
			...(options.imageResize
				? {
						resize: {
							enabled: true,
							alwaysPreserveAspectRatio: true,
						},
					}
				: {}),
		}),
		ImageUpload.configure({ resolveSrcRef: resolveImageSrcRef }),
		TableKit.configure({
			table: { resizable: options.tableResizable === true },
		}),
		TaskList,
		TaskItem.configure({ nested: true }),
		...(withCharCount
			? [
					CharacterCount.configure({
						limit: options.maxLength ?? null,
						textCounter: (text) =>
							[
								...new Intl.Segmenter('zh', {
									granularity: 'grapheme',
								}).segment(text),
							].length,
						wordCounter: (text) => {
							const cjk =
								text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g)
									?.length ?? 0;
							const latin = text
								.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ')
								.split(/\s+/)
								.filter(Boolean).length;
							return cjk + latin;
						},
					}),
				]
			: []),
		...(options.extraExtensions ?? []),
	];

	return baseExtensions;
}
