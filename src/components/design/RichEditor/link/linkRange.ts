import type { Editor } from '@tiptap/core';
import { getMarkRange, isTextSelection } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

export type LinkRange = { from: number; to: number };

/**
 * 解析「设链目标」选区（对齐常见富文本行为）：
 * 1. 已有文本选区 → 用选区
 * 2. 光标在已有链接内 → 扩展到整段 link mark
 * 3. 光标落在词/连续非空白内 → 扩展到该词（含中文连续字）
 * 4. 否则 → 扩展到当前行（文本块）的全部文本
 * 5. 空行 → null（绝不把 URL 插入正文）
 */
export function resolveLinkTarget(state: EditorState): LinkRange | null {
	const { selection, doc, schema } = state;
	const { from, to, empty, $from } = selection;

	if (!empty && to > from) return { from, to };

	if (isTextSelection(selection) && schema.marks.link) {
		const markRange = getMarkRange($from, schema.marks.link);
		if (markRange && markRange.to > markRange.from) return markRange;
	}

	const word = expandNonWhitespaceAround(doc, from);
	if (word) return word;

	if ($from.parent.isTextblock) {
		const start = $from.start();
		const end = $from.end();
		if (end > start) return { from: start, to: end };
	}

	return null;
}

/** 从 pos 向两侧扩到连续非空白 */
function expandNonWhitespaceAround(doc: PmNode, pos: number): LinkRange | null {
	const size = doc.content.size;
	if (size < 1) return null;

	const clamped = Math.max(0, Math.min(pos, size));
	const $pos = doc.resolve(clamped);
	if (!$pos.parent.isTextblock) return null;

	const blockStart = $pos.start();
	const blockEnd = $pos.end();
	if (blockEnd <= blockStart) return null;

	const text = doc.textBetween(blockStart, blockEnd, '\n', '\0');
	if (!text.trim()) return null;

	let offset = Math.max(0, Math.min(clamped - blockStart, text.length));

	// 光标在字符右侧时，优先贴到左侧字符
	if (
		offset > 0 &&
		(offset >= text.length || /\s/.test(text[offset]!)) &&
		!/\s/.test(text[offset - 1]!)
	) {
		offset -= 1;
	}

	if (offset >= text.length || /\s/.test(text[offset]!)) return null;

	let left = offset;
	let right = offset + 1;
	while (left > 0 && !/\s/.test(text[left - 1]!)) left -= 1;
	while (right < text.length && !/\s/.test(text[right]!)) right += 1;

	return { from: blockStart + left, to: blockStart + right };
}

export function applyLinkToRange(
	editor: Editor,
	range: LinkRange,
	href: string,
) {
	// 只 setTextSelection + setLink，勿串联 extendMarkRange（无 mark 时会中断 chain）
	editor.chain().focus().setTextSelection(range).setLink({ href }).run();
}

export function removeLinkInRange(editor: Editor, range: LinkRange) {
	editor.chain().focus().setTextSelection(range).unsetLink().run();
}
