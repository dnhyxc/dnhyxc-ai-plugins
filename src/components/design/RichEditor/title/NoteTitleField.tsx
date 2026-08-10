import { NotebookPen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';
import { richEditorLocaleOf } from '../locale';

type Props = {
	value: string;
	onChange: (value: string) => void;
	/** Enter / Tab：交给正文 */
	onContinue?: () => void;
	className?: string;
};

/**
 * 笔记标题外观（徽章 + 输入 + 字数）。
 * TipTap Title NodeView 与长文窗外标题共用，避免两套 UI。
 */
export function NoteTitleField({
	value,
	onChange,
	onContinue,
	className,
}: Props) {
	const { locale, t } = useI18n();
	const editorLocale = richEditorLocaleOf(locale);
	const composing = useRef(false);
	const [local, setLocal] = useState(value);

	useEffect(() => {
		if (composing.current) return;
		setLocal(value);
	}, [value]);

	const commit = (next: string) => {
		setLocal(next);
		if (!composing.current) onChange(next);
	};

	return (
		<div
			className={cn(
				'rich-editor-note-title flex flex-col gap-2 mb-2',
				className,
			)}
		>
			{/* shell/badge 关键几何靠 styles.css；勿用 -inset（四边钉死，utility 未齐时会拉满盖住输入框） */}
			<div className="rich-editor-note-title-shell relative flex flex-col gap-2 border border-theme/5 bg-theme/5 p-3 pr-0 pt-9 rounded-md">
				<div className="rich-editor-note-title-badge absolute -top-0.5 -left-0.5 flex h-6 items-center gap-2 border border-theme/5 bg-theme/20 pl-3 pr-3 text-theme/80 rounded-tl-md rounded-br-md">
					<NotebookPen className="size-4 shrink-0" />
					<span className="text-sm font-medium whitespace-nowrap">
						{t('learningNotes.titleBadge')}
					</span>
				</div>
				<Input
					className="h-12 size-full px-0 py-0 text-xl md:text-xl rounded-none border-0 bg-transparent text-textcolor shadow-none placeholder:text-lg placeholder:text-textcolor/35 focus-visible:border-0 focus-visible:ring-0"
					value={local}
					placeholder={editorLocale.placeholderHeadingHint}
					maxLength={50}
					showCount
					tabIndex={-1}
					onMouseDown={(e) => e.stopPropagation()}
					onCompositionStart={() => {
						composing.current = true;
					}}
					onCompositionEnd={(e) => {
						composing.current = false;
						commit(e.currentTarget.value);
					}}
					onChange={(e) => commit(e.target.value)}
					onKeyDown={(e) => {
						if (e.nativeEvent.isComposing) return;
						if (e.key === 'Enter' || e.key === 'Tab') {
							e.preventDefault();
							onContinue?.();
						}
					}}
				/>
			</div>
		</div>
	);
}
