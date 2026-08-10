import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';

function isEmptyParagraphNode(node: PmNode): boolean {
	if (node.type.name !== 'paragraph') return false;
	if (node.content.size === 0) return true;
	// <p><br></p> 也算空行
	let onlyBreaks = true;
	node.forEach((child) => {
		if (child.type.name !== 'hardBreak') onlyBreaks = false;
	});
	return onlyBreaks;
}

/** 当前是否在空段落内 */
function emptyParagraphAt(selection: Selection) {
	if (!(selection instanceof TextSelection) || !selection.empty) return null;
	const { $from } = selection;
	const parent = $from.parent;
	if (!isEmptyParagraphNode(parent)) return null;
	return {
		$from,
		parent,
		from: $from.before(),
		to: $from.before() + parent.nodeSize,
	};
}

/** 删掉后文档是否仍满足最少块数（有 title 时至少 title+1 块，否则至少 1 块） */
function canRemoveBlock(doc: {
	childCount: number;
	firstChild?: { type: { name: string } } | null;
}): boolean {
	const min = doc.firstChild?.type.name === 'title' ? 2 : 1;
	return doc.childCount > min;
}

/**
 * 空段落卡在 title/文档开头与图片之间时，原生 Backspace 无法「并进」atom，表现为删不掉。
 * 在空段开头 Backspace / 空段末尾 Delete 时直接删掉该段。
 */
export const EmptyParagraphDelete = Extension.create({
	name: 'emptyParagraphDelete',

	addKeyboardShortcuts() {
		return {
			Backspace: ({ editor }) => {
				const hit = emptyParagraphAt(editor.state.selection);
				if (!hit || hit.$from.parentOffset !== 0) return false;
				if (!canRemoveBlock(editor.state.doc)) return false;

				const { from, to } = hit;
				return editor
					.chain()
					.command(({ tr, dispatch }) => {
						tr.delete(from, to);
						const pos = Math.min(from, tr.doc.content.size);
						tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
						dispatch?.(tr);
						return true;
					})
					.run();
			},
			Delete: ({ editor }) => {
				const hit = emptyParagraphAt(editor.state.selection);
				if (!hit) return false;
				if (hit.$from.parentOffset !== hit.parent.content.size) return false;
				if (!canRemoveBlock(editor.state.doc)) return false;
				if (hit.to >= editor.state.doc.content.size) return false;

				const { from, to } = hit;
				return editor
					.chain()
					.command(({ tr, dispatch }) => {
						tr.delete(from, to);
						const pos = Math.min(from, tr.doc.content.size);
						tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
						dispatch?.(tr);
						return true;
					})
					.run();
			},
		};
	},
});
