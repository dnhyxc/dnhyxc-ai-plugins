import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import * as React from 'react';

import { cn } from '@/lib/utils';

type ScrollAreaScrollbars = 'vertical' | 'horizontal' | 'both';

interface ScrollAreaProps
	extends React.ComponentProps<typeof ScrollAreaPrimitive.Root> {
	viewportClassName?: string;
	scrollbarClassName?: string;
	dataTauriDragRegion?: boolean;
	onScroll?: React.UIEventHandler<HTMLDivElement>;
	onWheel?: React.WheelEventHandler<HTMLDivElement>;
	onWheelCapture?: React.WheelEventHandler<HTMLDivElement>;
	onPointerDownCapture?: React.PointerEventHandler<HTMLDivElement>;
	/** Radix 须挂载对应 Scrollbar 才开启该方向滚动；Markdown 预览等需 both 以免撑破 flex 父级 */
	scrollbars?: ScrollAreaScrollbars;
}

const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
	(
		{
			className,
			children,
			viewportClassName,
			scrollbarClassName,
			dataTauriDragRegion,
			onScroll,
			onWheel,
			onWheelCapture,
			onPointerDownCapture,
			scrollbars = 'vertical',
			...props
		},
		ref,
	) => {
		const showVertical = scrollbars === 'vertical' || scrollbars === 'both';
		const showHorizontal = scrollbars === 'horizontal' || scrollbars === 'both';

		return (
			<ScrollAreaPrimitive.Root
				data-slot="scroll-area"
				className={cn(
					'relative min-w-0 overflow-hidden border-0 border-transparent bg-transparent',
					className,
				)}
				{...props}
			>
				<ScrollAreaPrimitive.Viewport
					ref={ref}
					data-tauri-drag-region={dataTauriDragRegion}
					data-slot="scroll-area-viewport"
					className={cn(
						'focus-visible:ring-ring/50 size-full max-w-full min-w-0 rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1',
						// Radix 在 Viewport 内用内联 display:table 包裹子节点；子树无法按视口高度撑开，flex 垂直居中等布局会失效。用 flex + min-h-full 覆盖（需 ! 压过内联 table）
						'[&>div]:flex! [&>div]:min-h-full! [&>div]:min-w-full! [&>div]:flex-col!',
						viewportClassName,
					)}
					onScroll={onScroll}
					onWheel={onWheel}
					onWheelCapture={onWheelCapture}
					onPointerDownCapture={onPointerDownCapture}
				>
					{children}
				</ScrollAreaPrimitive.Viewport>
				{showVertical ? <ScrollBar className={scrollbarClassName} /> : null}
				{showHorizontal ? (
					<ScrollBar orientation="horizontal" className={scrollbarClassName} />
				) : null}
				<ScrollAreaPrimitive.Corner />
			</ScrollAreaPrimitive.Root>
		);
	},
);

ScrollArea.displayName = 'ScrollArea';

function ScrollBar({
	className,
	orientation = 'vertical',
	...props
}: {
	className?: string;
	orientation?: 'vertical' | 'horizontal';
} & React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
	return (
		<ScrollAreaPrimitive.ScrollAreaScrollbar
			data-slot="scroll-area-scrollbar"
			orientation={orientation}
			className={cn(
				'flex touch-none transition-colors select-none',
				orientation === 'vertical' &&
					'pr-px h-full w-2 border-l border-l-transparent',
				orientation === 'horizontal' &&
					'h-1.5 flex-col border-t border-t-transparent',
				className,
			)}
			{...props}
		>
			<ScrollAreaPrimitive.ScrollAreaThumb
				data-slot="scroll-area-thumb"
				className="bg-theme-border relative flex-1 rounded-full"
			/>
		</ScrollAreaPrimitive.ScrollAreaScrollbar>
	);
}

export { ScrollArea, ScrollBar };
