import { Button } from '@ui/button';
import { Input } from '@ui/input';
import { X } from 'lucide-react';
import { memo, type Ref, useEffect, useState } from 'react';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';

export type SearchInputProps = {
	/** 已提交的搜索词。回车或清空后才交给父级。 */
	committedQuery: string;
	onCommit: (query: string) => void;
	placeholder: string;
	className?: string;
	autoFocus?: boolean;
	inputRef?: Ref<HTMLInputElement>;
	onEscape?: () => void;
};

function SearchInput({
	committedQuery,
	onCommit,
	placeholder,
	className,
	autoFocus,
	inputRef,
	onEscape,
}: SearchInputProps) {
	const { t } = useI18n();
	const [draft, setDraft] = useState(committedQuery);
	const hasDraft = draft !== '';

	useEffect(() => {
		setDraft(committedQuery);
	}, [committedQuery]);

	const clear = () => {
		setDraft('');
		if (committedQuery.trim() !== '') onCommit('');
	};

	return (
		<div className="relative min-w-0 flex-1">
			<Input
				ref={inputRef}
				type="text"
				autoFocus={autoFocus}
				value={draft}
				onChange={(event) => {
					const next = event.target.value;
					setDraft(next);
					if (!next.trim() && committedQuery.trim() !== '') onCommit('');
				}}
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						event.preventDefault();
						onEscape?.();
						return;
					}
					if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
					event.preventDefault();
					onCommit(event.currentTarget.value);
				}}
				placeholder={placeholder}
				aria-label={placeholder}
				className={cn(
					'h-9 shadow-none focus-visible:border-theme/15 focus-visible:ring-0 focus-visible:shadow-none',
					className,
					hasDraft && 'pr-8',
				)}
			/>
			{hasDraft ? (
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={t('common.clear')}
					className="absolute top-1/2 right-1 size-6 -translate-y-1/2 p-0 text-textcolor/55 hover:text-textcolor"
					onClick={clear}
				>
					<X className="size-3.5" aria-hidden />
				</Button>
			) : null}
		</div>
	);
}

export default memo(SearchInput);
