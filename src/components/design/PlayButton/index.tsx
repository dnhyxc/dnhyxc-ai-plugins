import { Button } from '@ui/button';
import { Square, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type PlayButtonProps = {
	playing: boolean;
	label: string;
	onClick: () => void;
	className?: string;
	iconClassName?: string;
	/** boxed：词卡旁带边框；plain：行内紧凑 */
	look?: 'boxed' | 'plain';
};

const LOOK = {
	boxed: {
		on: 'h-7 w-7 rounded-md border border-teal-500/40 bg-teal-500/15 p-0 text-teal-600 dark:text-teal-400',
		off: 'border-theme/10 text-textcolor/60 hover:border-theme/20 hover:bg-theme/10 h-7 w-7 rounded-md border p-0 hover:text-teal-600 dark:hover:text-teal-400',
	},
	plain: {
		on: 'size-6 rounded-md p-0 shadow-none text-teal-500 focus-visible:border-transparent focus-visible:ring-0',
		off: 'size-6 rounded-md p-0 shadow-none text-textcolor/55 hover:text-teal-400 focus-visible:border-transparent focus-visible:ring-0',
	},
} as const;

export default function PlayButton({
	playing,
	label,
	onClick,
	className,
	iconClassName,
	look = 'boxed',
}: PlayButtonProps) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			aria-label={label}
			onClick={onClick}
			className={cn(
				'shrink-0',
				playing ? LOOK[look].on : LOOK[look].off,
				className,
			)}
		>
			{playing ? (
				<Square
					className={cn('size-3.5 fill-current', iconClassName)}
					aria-hidden
				/>
			) : (
				<Volume2 className={cn('size-3.5', iconClassName)} aria-hidden />
			)}
		</Button>
	);
}
