import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui';
import { cn } from '@/lib/utils';

/** 悬停打开的 Popover（基于 @/components/ui/popover，保留底栏 hover UX） */
const HoverPopover = ({
	trigger,
	children,
	align = 'center',
	width,
	contentClassName,
	contentPadding,
	container,
	onOpenChange,
	onContentPointer,
}: {
	trigger: ReactNode;
	children: ReactNode | ((api: { close: () => void }) => ReactNode);
	align?: 'center' | 'start' | 'end';
	width?: number | string;
	contentClassName?: string;
	contentPadding?: number | string;
	container?: HTMLElement | null;
	onOpenChange?: (open: boolean) => void;
	onContentPointer?: () => void;
}) => {
	const [open, setOpen] = useState(false);
	const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearLeaveTimer = useCallback(() => {
		if (leaveTimerRef.current) {
			clearTimeout(leaveTimerRef.current);
			leaveTimerRef.current = null;
		}
	}, []);

	const setOpenSafe = useCallback(
		(next: boolean) => {
			setOpen((prev) => {
				if (next === prev) return prev;
				onOpenChange?.(next);
				return next;
			});
		},
		[onOpenChange],
	);

	useEffect(() => () => clearLeaveTimer(), [clearLeaveTimer]);

	const onEnter = () => {
		clearLeaveTimer();
		setOpenSafe(true);
	};

	const onLeave = () => {
		clearLeaveTimer();
		leaveTimerRef.current = setTimeout(() => setOpenSafe(false), 120);
	};

	const close = useCallback(() => setOpenSafe(false), [setOpenSafe]);

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				// 悬停打开；允许 Radix 外部点击/Esc 关闭
				if (!next) setOpenSafe(false);
			}}
		>
			<PopoverTrigger asChild>
				<div
					className="inline-flex"
					onMouseEnter={onEnter}
					onMouseLeave={onLeave}
				>
					{trigger}
				</div>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align={align}
				sideOffset={8}
				container={container}
				className={cn(
					'border-theme/10 text-textcolor shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-[2px]',
					contentClassName,
				)}
				style={{
					width: typeof width === 'number' ? `${width}px` : width,
					padding: contentPadding,
				}}
				onOpenAutoFocus={(e) => e.preventDefault()}
				onCloseAutoFocus={(e) => e.preventDefault()}
				onClick={(e) => e.stopPropagation()}
				onMouseEnter={() => {
					onEnter();
					onContentPointer?.();
				}}
				onMouseMove={onContentPointer}
				onMouseLeave={onLeave}
			>
				{typeof children === 'function' ? children({ close }) : children}
			</PopoverContent>
		</Popover>
	);
};

export default HoverPopover;
