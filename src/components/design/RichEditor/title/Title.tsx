import { type NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { NoteTitleField } from './NoteTitleField';
import { focusAfterTitle } from './TitleNode';

/**
 * TipTap 标题 NodeView：外观走 NoteTitleField，写入 attrs.value。
 */
export default function TitleView({
	node,
	updateAttributes,
	editor,
}: NodeViewProps) {
	return (
		<NodeViewWrapper as="div" contentEditable={false}>
			<NoteTitleField
				value={String(node.attrs.value ?? '')}
				onChange={(next) => updateAttributes({ value: next })}
				onContinue={() => focusAfterTitle(editor)}
			/>
		</NodeViewWrapper>
	);
}
