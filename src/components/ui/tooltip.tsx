import { Tooltip as TooltipPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** Tooltip 外圈阴影：主题色 theme 10% 透明度（与 bg-theme/10 语义一致） */
const TOOLTIP_SHADOW_CLASS =
	'shadow-[0_3px_12px_color-mix(in_oklch,var(--color-theme)_10%,transparent)] drop-shadow-[0_3px_12px_color-mix(in_oklch,var(--color-theme)_10%,transparent)]';

function TooltipProvider({
	delayDuration = 0,
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delayDuration={delayDuration}
			{...props}
		/>
	);
}

function Tooltip({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
	...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

type TooltipContentProps = React.ComponentProps<
	typeof TooltipPrimitive.Content
> & {
	/** 是否显示主题色外阴影（内容区与箭头）；默认关闭 */
	shadow?: boolean;
	/** 挂载容器；MF @scope 下应传到插件根，避免 Portal 到 body 丢样式 */
	container?: HTMLElement | null;
};

function TooltipContent({
	className,
	sideOffset = 0,
	shadow = false,
	container,
	children,
	...props
}: TooltipContentProps) {
	return (
		<TooltipPrimitive.Portal container={container ?? undefined}>
			<TooltipPrimitive.Content
				data-slot="tooltip-content"
				sideOffset={sideOffset}
				className={cn(
					'select-none text-textcolor z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs text-balance',
					'bg-theme-background',
					shadow && TOOLTIP_SHADOW_CLASS,
					'animate-in fade-in-0 zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
					// 关闭时立即隐藏、不做位移动画，避免触发器塌陷时闪到视口 (0,0)
					'data-[state=closed]:hidden data-[state=closed]:animate-none',
					className,
				)}
				{...props}
			>
				{children}
				<TooltipPrimitive.Arrow
					className={cn(
						'z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px]',
						'bg-theme-background fill-theme-background',
						shadow && TOOLTIP_SHADOW_CLASS,
					)}
				/>
			</TooltipPrimitive.Content>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
