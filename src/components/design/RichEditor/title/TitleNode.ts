import type { Editor, JSONContent } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import { GapCursor } from '@tiptap/pm/gapcursor';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import TitleView from './Title';

/** 空笔记：必有 title + 一段正文，避免只有 atom 时光标落在 GapCursor 上无法输入 */
export const EMPTY_NOTE_DOC: JSONContent = {
	type: 'doc',
	content: [{ type: 'title', attrs: { value: '' } }, { type: 'paragraph' }],
};

/** 空 HTML / 空串 → 合法笔记文档 */
export function normalizeNoteContent(
	content: string | JSONContent | undefined | null,
): string | JSONContent {
	if (content == null || content === '' || content === '<p></p>') {
		return EMPTY_NOTE_DOC;
	}
	return content;
}

/**
 * 笔记常驻标题：atom + 原生 input（attrs.value）。
 * group 不用 block，保证文档仅首位一个 title。
 */
export const TitleNode = Node.create({
	name: 'title',

	group: 'title',

	atom: true,

	draggable: false,

	selectable: false,

	addAttributes() {
		return {
			value: {
				default: '',
				parseHTML: (el) =>
					(el as HTMLElement).getAttribute('data-value') ??
					(el as HTMLElement).textContent ??
					'',
				renderHTML: (attrs) =>
					attrs.value ? { 'data-value': attrs.value as string } : {},
			},
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-type="note-title"]' }];
	},

	renderHTML({ HTMLAttributes, node }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, {
				'data-type': 'note-title',
				'data-value': node.attrs.value ?? '',
			}),
			node.attrs.value ?? '',
		];
	},

	addNodeView() {
		// stopEvent：标题内交互不交给 PM，避免和正文抢输入
		return ReactNodeViewRenderer(TitleView, {
			stopEvent: () => true,
		});
	},

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('singleNoteTitle'),
				appendTransaction(transactions, _old, state) {
					const docChanged = transactions.some((tr) => tr.docChanged);
					const selectionSet = transactions.some((tr) => tr.selectionSet);
					if (!docChanged && !selectionSet) return null;

					let tr = state.tr;
					let changed = false;

					// 结构修复只在 doc 变化时做（选区变化不必扫多余 title）
					if (docChanged) {
						const extras: { pos: number; nodeSize: number }[] = [];
						let seen = 0;
						state.doc.forEach((node, offset) => {
							if (node.type.name !== 'title') return;
							seen += 1;
							if (seen > 1)
								extras.push({ pos: offset, nodeSize: node.nodeSize });
						});
						for (let i = extras.length - 1; i >= 0; i--) {
							const { pos, nodeSize } = extras[i];
							tr.replaceWith(
								pos,
								pos + nodeSize,
								state.schema.nodes.paragraph.create(),
							);
							changed = true;
						}

						const doc = changed ? tr.doc : state.doc;
						const title = doc.firstChild;
						// 没有正文块时补一段（atom 旁 GapCursor 看起来像有光标但输不进字）
						if (title?.type.name === 'title' && doc.childCount < 2) {
							tr = tr.insert(
								title.nodeSize,
								state.schema.nodes.paragraph.create(),
							);
							changed = true;
						}
					}

					const nextDoc = changed ? tr.doc : state.doc;
					const titleNode = nextDoc.firstChild;
					if (titleNode?.type.name === 'title') {
						const titleSize = titleNode.nodeSize;
						const sel = changed ? tr.selection : state.selection;
						const $from = sel.$from;
						const caretInBody =
							sel instanceof TextSelection &&
							sel.empty &&
							$from.parent.isTextblock &&
							$from.pos > titleSize;

						// 仅「空正文」或非法非文本选区才纠正。
						// 正文 GapCursor（如图片前）合法；非法选区钉回正文开头（勿 atEnd，否则 Cmd+↑ 会被纠到文末）。
						const bodyEmpty =
							nextDoc.childCount < 2 ||
							(nextDoc.childCount === 2 &&
								nextDoc.child(1).isTextblock &&
								nextDoc.child(1).content.size === 0);

						let needsFix = false;
						if (bodyEmpty && sel.empty && !caretInBody) {
							needsFix = true;
						} else if (
							sel.empty &&
							!(sel instanceof GapCursor) &&
							!$from.parent.isTextblock
						) {
							needsFix = true;
						}

						if (needsFix && titleSize + 1 <= nextDoc.content.size) {
							tr = tr.setSelection(
								TextSelection.near(nextDoc.resolve(titleSize + 1), 1),
							);
							changed = true;
						}
					}

					return changed ? tr : null;
				},
			}),
		];
	},

	addKeyboardShortcuts() {
		return {
			/** 全选只覆盖正文，避开 title NodeView，让浏览器能画出原生选区高亮 */
			'Mod-a': ({ editor }) => {
				const { doc } = editor.state;
				const title = doc.firstChild;
				if (title?.type.name !== 'title') return false;

				const start = title.nodeSize + 1;
				if (start >= doc.content.size) return true;

				const from = TextSelection.near(doc.resolve(start), 1).from;
				const to = Selection.atEnd(doc).to;
				if (from < to) {
					editor.commands.setTextSelection({ from, to });
				} else {
					editor.commands.setTextSelection(from);
				}
				return true;
			},
		};
	},
});

export default TitleNode;

/** 取文档首位 title 文本，供笔记列表展示 */
export function getDocTitleText(doc: {
	firstChild?: {
		type: { name: string };
		attrs: Record<string, unknown>;
		textContent: string;
	} | null;
}): string {
	const first = doc.firstChild;
	if (first?.type.name !== 'title') return '';
	const fromAttr = first.attrs.value;
	if (typeof fromAttr === 'string') return fromAttr.trim();
	return first.textContent.trim();
}

/** 正文 Tab 缩进：列表下沉，否则插入 \t */
export function indentEditor(editor: Editor): boolean {
	if (editor.isActive('codeBlock')) return false;
	if (editor.commands.sinkListItem('listItem')) return true;
	if (editor.commands.sinkListItem('taskItem')) return true;
	return editor.commands.insertContent('\t');
}

/** 标题 input 按 Enter / Tab：跳到正文末尾 */
export function focusAfterTitle(editor: Editor) {
	const title = editor.state.doc.firstChild;
	if (!title || title.type.name !== 'title') {
		editor.commands.focus('end');
		return;
	}
	const after = title.nodeSize;
	const next = editor.state.doc.nodeAt(after);
	if (!next) {
		editor
			.chain()
			.insertContentAt(after, { type: 'paragraph' })
			.focus('end')
			.run();
		return;
	}
	editor.commands.focus('end');
}
