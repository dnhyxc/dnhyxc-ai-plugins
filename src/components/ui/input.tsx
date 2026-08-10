import type * as React from 'react';

import { cn } from '@/lib/utils';

type InputProps = React.ComponentProps<'input'> & {
	/** 为 true 且设置了 maxLength 时，在输入框右侧显示「当前字数/上限」 */
	showCount?: boolean;
};

function getInputValueLength(value: InputProps['value']): number {
	if (value == null) return 0;
	return String(value).length;
}

function Input({
	className,
	type,
	showCount,
	maxLength,
	value,
	...props
}: InputProps) {
	const shouldShowCount =
		Boolean(showCount) && maxLength != null && maxLength > 0;
	const charCount = getInputValueLength(value);

	const input = (
		<input
			type={type}
			data-slot="input"
			value={value}
			maxLength={maxLength}
			className={cn(
				'caret-textcolor file:text-textcolor placeholder:text-textcolor/60 dark:bg-input/30 border border-theme h-9 w-full min-w-0 rounded-md bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
				'focus-visible:border-theme/50 focus-visible:ring-theme/30 focus-visible:ring-[3px]',
				'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive',
				shouldShowCount && 'pr-14',
				className,
			)}
			autoCapitalize="off"
			autoCorrect="off"
			spellCheck="false"
			{...props}
		/>
	);

	if (!shouldShowCount) {
		return input;
	}

	return (
		<div className="relative w-full">
			{input}
			<span
				className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs tabular-nums text-textcolor/45"
				aria-hidden
			>
				{charCount}/{maxLength}
			</span>
		</div>
	);
}

export { Input };
