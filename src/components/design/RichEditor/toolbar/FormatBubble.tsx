import type { Editor } from '@tiptap/react';
import { Bold, Highlighter, Italic, Link2, Underline } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RichEditorLocale } from '../locale';

type Props = {
	editor: Editor;
	locale: RichEditorLocale;
	onOpenLink: () => void;
};

function Btn({
	title,
	onClick,
	children,
}: {
	title: string;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			className="rich-editor-btn lucide-stroke-draw-hover [&_svg]:overflow-visible"
			title={title}
			aria-label={title}
			onMouseDown={(e) => e.preventDefault()}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

/** 选区气泡菜单：常用行内格式 */
export function FormatBubble({ editor, locale: t, onOpenLink }: Props) {
	return (
		<div className="rich-editor-bubble" role="toolbar" aria-label="快捷格式">
			<Btn
				title={t.bold}
				onClick={() => editor.chain().focus().toggleBold().run()}
			>
				<Bold size={14} />
			</Btn>
			<Btn
				title={t.italic}
				onClick={() => editor.chain().focus().toggleItalic().run()}
			>
				<Italic size={14} />
			</Btn>
			<Btn
				title={t.underline}
				onClick={() => editor.chain().focus().toggleUnderline().run()}
			>
				<Underline size={14} />
			</Btn>
			<Btn
				title={t.highlight}
				onClick={() => editor.chain().focus().toggleHighlight().run()}
			>
				<Highlighter size={14} />
			</Btn>
			<Btn title={t.link} onClick={onOpenLink}>
				<Link2 size={14} />
			</Btn>
		</div>
	);
}
