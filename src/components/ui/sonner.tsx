import {
	CircleCheckIcon,
	InfoIcon,
	Loader2Icon,
	OctagonXIcon,
	TriangleAlertIcon,
	X,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import type { CSSProperties } from 'react';
import {
	type ExternalToast,
	Toaster as Sonner,
	type ToasterProps,
	toast,
} from 'sonner';
import { cn } from '@/lib/utils';

type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading' | 'start';

/** 与 sonner 一致：四角 + 上下居中，用于 `<Toaster position />` 与单条 toast 的 `position` */
export type ToastPosition = NonNullable<ToasterProps['position']>;

/** 未传 `duration` 时自动关闭延迟（毫秒）；`toast.*` 直连也受 `<Toaster duration />` 影响 */
export const DEFAULT_TOAST_DURATION_MS = 2000;

/** 未传 `position` 时使用；可选：`top-left` | `top-right` | `bottom-left` | `bottom-right` | `top-center` | `bottom-center` */
export const DEFAULT_TOAST_POSITION: ToastPosition = 'top-right';

/** 与 `<Toaster offset />` 同类型；单条通过根节点 margin 近似，非 sonner 原生 per-toast 边距 */
export type ToastOffset = NonNullable<ToasterProps['offset']>;

/** 将 offset 转为单条 toast 外层 li 的 style（勿覆盖 sonner 内部使用的 --index 等变量） */
function offsetToToastStyle(offset: ToastOffset): CSSProperties {
	if (typeof offset === 'number') {
		return { margin: `${offset}px` };
	}
	if (typeof offset === 'string') {
		return { margin: offset };
	}
	const style: CSSProperties = {};
	if (offset.top != null) {
		style.marginTop =
			typeof offset.top === 'number' ? `${offset.top}px` : offset.top;
	}
	if (offset.right != null) {
		style.marginRight =
			typeof offset.right === 'number' ? `${offset.right}px` : offset.right;
	}
	if (offset.bottom != null) {
		style.marginBottom =
			typeof offset.bottom === 'number' ? `${offset.bottom}px` : offset.bottom;
	}
	if (offset.left != null) {
		style.marginLeft =
			typeof offset.left === 'number' ? `${offset.left}px` : offset.left;
	}
	return style;
}

/**
 * 封装 `toast.custom` 的轻量 Toast。
 *
 * - `position`：sonner 支持单条，会进入对应角的列表。
 * - `offset`：通过根节点 margin 近似整器 `offset`，堆叠时可能与全局 Toaster 边距叠加。
 * - `expand`：sonner 2.x 仅 `<Toaster expand />` 生效，单条传参无效，保留仅为与 Toaster API 对齐。
 * - 右上角有关闭按钮；`toast.custom` 不会使用 sonner 内置关闭钮，故在内容区内自绘。
 */
const Toast = ({
	title,
	message,
	type,
	duration,
	position,
	expand: _expand,
	offset,
}: {
	type: ToastType;
	title: string;
	message?: string;
	duration?: number;
	position?: ToastPosition;
	expand?: boolean;
	offset?: ToastOffset;
}) => {
	const colors: Record<ToastType, string> = {
		success: 'text-green-500',
		error: 'text-rose-500',
		warning: 'text-amber-500',
		info: 'text-gray-500',
		loading: 'text-gray-500',
		start: 'text-gray-500',
	};

	/** 关闭按钮与对应类型主色一致（Lucide X 使用 currentColor） */
	const closeButtonTone: Record<ToastType, string> = {
		success: 'text-green-500 hover:text-green-600',
		error: 'text-rose-500 hover:text-rose-600',
		warning: 'text-amber-500 hover:text-amber-600',
		info: 'text-gray-500 hover:text-gray-600',
		loading: 'text-gray-500 hover:text-gray-600',
		start: 'text-gray-500 hover:text-gray-600',
	};

	toast.custom(
		(toastId) => {
			return (
				<div className="group relative flex flex-col justify-center min-h-13 w-80 bg-theme-background/80 shadow-lg rounded-md py-2 pl-3 pr-9">
					<button
						type="button"
						className={cn(
							'absolute right-1 top-1 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto hover:bg-theme/15 focus-visible:opacity-100 focus-visible:pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
							closeButtonTone[type],
						)}
						aria-label="关闭"
						onClick={(e) => {
							e.stopPropagation();
							toast.dismiss(toastId);
						}}
					>
						<X className="size-4" strokeWidth={2} aria-hidden />
					</button>
					<div className="flex items-center">
						<div className="w-6 flex justify-center items-center">
							{type === 'success' && (
								<CircleCheckIcon color="var(--color-green-500)" />
							)}
							{type === 'info' && <InfoIcon color="var(--color-gray-500)" />}
							{type === 'warning' && (
								<TriangleAlertIcon color="var(--color-amber-500)" />
							)}
							{type === 'error' && (
								<OctagonXIcon color="var(--color-rose-500)" />
							)}
							{type === 'loading' && (
								<Loader2Icon color="var(--color-gray-500)" />
							)}
							{type === 'start' && (
								<Loader2Icon color="var(--color-gray-500)" />
							)}
						</div>
						<div
							className={`ml-2 text-md ${colors[type]} whitespace-pre-wrap wrap-break-word`}
						>
							{title}
						</div>
					</div>
					{message ? (
						<div
							className={`ml-8 ${colors[type]} text-sm mt-1 whitespace-pre-wrap wrap-break-word`}
						>
							{message}
						</div>
					) : null}
				</div>
			);
		},
		(() => {
			const resolvedDuration =
				duration ??
				(type === 'loading' || type === 'start'
					? Number.POSITIVE_INFINITY
					: DEFAULT_TOAST_DURATION_MS);
			const options: ExternalToast = { duration: resolvedDuration };
			if (position !== undefined) {
				options.position = position;
			}
			if (offset !== undefined) {
				options.style = {
					...options.style,
					...offsetToToastStyle(offset),
				};
			}
			return options;
		})(),
	);
};

/**
 * 全局 Toast 容器（sonner）。
 *
 * **位置 `position`**：`'top-left'` | `'top-right'` | `'bottom-left'` | `'bottom-right'` | `'top-center'` | `'bottom-center'`，默认见 {@link DEFAULT_TOAST_POSITION}。
 *
 * **展开 `expand`**：`true` 时堆叠区展开占更高区域；`false`（默认）为紧凑堆叠，入场动画方向随 `position` 由 sonner 处理。
 *
 * **滑动关闭 `swipeDirections`**：如 `['top','right','bottom','left']` 的子集，控制可滑走关闭的方向。
 *
 * **排版方向 `dir`**：`'ltr'` | `'rtl'` | `'auto'`。
 *
 * @example
 * ```tsx
 * <Toaster position="bottom-right" expand swipeDirections={['bottom', 'right']} />
 * ```
 */
const Toaster = (props: ToasterProps) => {
	const { theme = 'system' } = useTheme();

	const baseStyle = {
		'--normal-bg': 'var(--popover)',
		'--normal-text': 'var(--popover-foreground)',
		'--normal-border': 'var(--border)',
		'--border-radius': 'var(--radius)',
	} as React.CSSProperties;

	return (
		<Sonner
			{...props}
			theme={theme as ToasterProps['theme']}
			className={cn('toaster group', props.className)}
			duration={props.duration ?? DEFAULT_TOAST_DURATION_MS}
			offset={props.offset ?? 30}
			position={props.position ?? DEFAULT_TOAST_POSITION}
			expand={props.expand ?? false}
			icons={{
				success: (
					<CircleCheckIcon
						className="size-4 text-green-500"
						color="var(--color-green-500)"
					/>
				),
				info: <InfoIcon className="size-4" />,
				warning: (
					<TriangleAlertIcon
						className="size-4 text-amber-500"
						color="var(--color-amber-500)"
					/>
				),
				error: (
					<OctagonXIcon
						className="size-4 text-rose-500"
						color="var(--color-rose-500)"
					/>
				),
				loading: <Loader2Icon className="size-4 animate-spin" />,
			}}
			style={{ ...baseStyle, ...props.style }}
		/>
	);
};

export type { ToasterProps };
export { Toast, Toaster, toast };
