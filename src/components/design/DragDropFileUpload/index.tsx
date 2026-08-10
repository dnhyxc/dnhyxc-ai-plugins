/**
 * 高性能拖拽 / 点击文件选择区（基于 `@/components/ui/input` 的 `type="file"`）。
 *
 * 性能策略：
 * - 拖拽悬停态不写 React state，仅改容器 DOM 的 `data-drag-active`，避免 dragover 重渲染。
 * - dragenter/dragleave 深度计数，减少子节点间移动时的闪烁。
 * - 文件列表单次线性扫描；校验逻辑 O(n)。
 */

import {
	type ChangeEvent,
	type ComponentPropsWithRef,
	type DragEvent,
	forwardRef,
	type InputHTMLAttributes,
	type KeyboardEvent,
	type MutableRefObject,
	type ReactNode,
	type Ref,
	useCallback,
	useImperativeHandle,
	useMemo,
	useRef,
} from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** 文件来源 */
export type DragDropFileSource = 'drop' | 'input';

/** 单文件校验失败原因 */
export type DragDropRejectReason =
	| { code: 'accept'; message?: string }
	| { code: 'maxFileBytes'; maxBytes: number; message?: string }
	| { code: 'maxCount'; max: number; message?: string }
	| { code: 'custom'; message: string };

export interface DragDropRejectedFile {
	file: File;
	reason: DragDropRejectReason;
}

export interface DragDropAcceptResult {
	accepted: File[];
	rejected: DragDropRejectedFile[];
}

export type DragDropFileValidator = (file: File) => DragDropRejectReason | null;

export interface UseDragDropFileUploadOptions {
	disabled?: boolean;
	/** 原生 accept，如 `.json`（系统对话框可能仍可切到「所有文件」，需配合 extensionOnly / pickFiles） */
	accept?: string;
	/**
	 * 为 true 时仅按扩展名规则校验（忽略 MIME），避免误选非目标类型仍通过。
	 * accept 中应包含 `.ext` 规则，如 `.json`。
	 */
	acceptExtensionOnly?: boolean;
	/**
	 * 自定义打开文件选择（如 Tauri 原生仅 .json 对话框）；返回 null 表示取消。
	 * 设置后点击区域/编程式 open 不再触发隐藏 input。
	 */
	pickFiles?: () => Promise<File[] | null>;
	multiple?: boolean;
	/** 表单字段名 */
	name?: string;
	capture?: InputHTMLAttributes<HTMLInputElement>['capture'];
	/** 是否允许选择文件夹（webkitdirectory） */
	directory?: boolean;
	/** 单次最多接受文件数（默认不限制） */
	maxCount?: number;
	/** 单文件最大字节（默认不限制） */
	maxFileBytes?: number;
	/** 自定义校验，返回 null 表示通过 */
	validateFile?: DragDropFileValidator;
	/**
	 * 选中文件后回调（已通过过滤与校验）。
	 * 建议用 useCallback 包裹，避免无谓重建。
	 */
	onFiles: (result: DragDropAcceptResult, source: DragDropFileSource) => void;
	onReject?: (
		rejected: DragDropRejectedFile[],
		source: DragDropFileSource,
	) => void;
	/** 为 true 时点击容器不打开文件选择（仍可拖拽与编程式 open） */
	noClickToOpen?: boolean;
}

const DRAG_ATTR = 'data-drag-active';

function setZoneDragActive(zone: HTMLDivElement | null, active: boolean) {
	if (!zone) return;
	if (active) zone.setAttribute(DRAG_ATTR, '');
	else zone.removeAttribute(DRAG_ATTR);
}

/** 轻量 accept 校验（mime / 扩展名 / 通配） */
export function matchAcceptRule(
	file: File,
	accept: string | undefined,
): boolean {
	if (!accept?.trim()) return true;
	const rules = accept
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	for (const rule of rules) {
		const r = rule.toLowerCase();
		if (r === '*/*') return true;
		if (r.endsWith('/*')) {
			const prefix = r.slice(0, -1);
			if (file.type?.toLowerCase().startsWith(prefix)) return true;
		} else if (r.startsWith('.')) {
			if (file.name.toLowerCase().endsWith(r)) return true;
		} else if (file.type?.toLowerCase() === r) {
			return true;
		}
	}
	return false;
}

/** 仅按 accept 中的扩展名规则校验（用于 JSON / MD 等严格导入） */
export function matchAcceptExtensionOnly(
	file: File,
	accept: string | undefined,
): boolean {
	if (!accept?.trim()) return true;
	const exts = accept
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.startsWith('.'));
	if (exts.length === 0) return matchAcceptRule(file, accept);
	const lower = file.name.toLowerCase();
	return exts.some((ext) => lower.endsWith(ext.toLowerCase()));
}

function matchAcceptForOptions(
	file: File,
	accept: string | undefined,
	extensionOnly?: boolean,
): boolean {
	return extensionOnly
		? matchAcceptExtensionOnly(file, accept)
		: matchAcceptRule(file, accept);
}

function getFileAt(list: FileList | readonly File[], i: number): File | null {
	if (typeof FileList !== 'undefined' && list instanceof FileList) {
		return list.item(i);
	}
	return list[i] ?? null;
}

function parseFileList(
	list: FileList | readonly File[],
	options: {
		accept?: string;
		acceptExtensionOnly?: boolean;
		maxCount?: number;
		maxFileBytes?: number;
		validateFile?: DragDropFileValidator;
	},
): DragDropAcceptResult {
	const accepted: File[] = [];
	const rejected: DragDropRejectedFile[] = [];
	const maxCount = options.maxCount;
	const maxBytes = options.maxFileBytes;
	const len = list.length;
	let acceptedCount = 0;
	for (let i = 0; i < len; i++) {
		const file = getFileAt(list, i);
		if (!file) continue;
		if (maxCount !== undefined && acceptedCount >= maxCount) {
			rejected.push({
				file,
				reason: {
					code: 'maxCount',
					max: maxCount,
					message: `超过最多文件数 ${maxCount}`,
				},
			});
			continue;
		}
		if (
			!matchAcceptForOptions(file, options.accept, options.acceptExtensionOnly)
		) {
			rejected.push({
				file,
				reason: { code: 'accept', message: `类型不符合 accept：${file.name}` },
			});
			continue;
		}
		if (maxBytes !== undefined && file.size > maxBytes) {
			rejected.push({
				file,
				reason: {
					code: 'maxFileBytes',
					maxBytes: maxBytes,
					message: `文件过大：${file.name}`,
				},
			});
			continue;
		}
		const custom = options.validateFile?.(file) ?? null;
		if (custom) {
			rejected.push({ file, reason: custom });
			continue;
		}
		accepted.push(file);
		acceptedCount += 1;
	}
	return { accepted, rejected };
}

export type DragDropZoneHandlers = {
	onDragEnter: (e: DragEvent<HTMLDivElement>) => void;
	onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
	onDragOver: (e: DragEvent<HTMLDivElement>) => void;
	onDrop: (e: DragEvent<HTMLDivElement>) => void;
	onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
	onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
	role: 'button';
	tabIndex: number;
	'aria-disabled'?: boolean;
	'aria-label'?: string;
};

export interface UseDragDropFileUploadReturn {
	zoneRef: React.RefObject<HTMLDivElement | null>;
	inputRef: React.RefObject<HTMLInputElement | null>;
	zoneHandlers: DragDropZoneHandlers;
	inputClassName: string;
	inputRest: Pick<
		InputHTMLAttributes<HTMLInputElement>,
		| 'type'
		| 'accept'
		| 'multiple'
		| 'disabled'
		| 'onChange'
		| 'name'
		| 'capture'
	> & { webkitdirectory?: boolean | '' };
	openFilePicker: () => void;
	resetInput: () => void;
}

/**
 * Headless：拖拽/键盘/点击逻辑与 DOM 拖拽态，便于自定义 UI 且保持高性能。
 */
export function useDragDropFileUpload(
	options: UseDragDropFileUploadOptions,
): UseDragDropFileUploadReturn {
	const { disabled, accept, multiple, name, capture, directory } = options;

	const zoneRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const dragDepthRef = useRef(0);
	const optsRef = useRef(options);
	optsRef.current = options;

	const emit = useCallback(
		(list: FileList | readonly File[], source: DragDropFileSource) => {
			if (optsRef.current.disabled) return;
			const { accepted, rejected } = parseFileList(list, {
				accept: optsRef.current.accept,
				acceptExtensionOnly: optsRef.current.acceptExtensionOnly,
				maxCount: optsRef.current.maxCount,
				maxFileBytes: optsRef.current.maxFileBytes,
				validateFile: optsRef.current.validateFile,
			});
			if (rejected.length) optsRef.current.onReject?.(rejected, source);
			if (accepted.length)
				optsRef.current.onFiles({ accepted, rejected }, source);
		},
		[],
	);

	const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
		if (optsRef.current.disabled) return;
		e.preventDefault();
		e.stopPropagation();
		dragDepthRef.current += 1;
		if (dragDepthRef.current === 1) setZoneDragActive(zoneRef.current, true);
	}, []);

	const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
		if (optsRef.current.disabled) return;
		e.preventDefault();
		e.stopPropagation();
		dragDepthRef.current -= 1;
		if (dragDepthRef.current <= 0) {
			dragDepthRef.current = 0;
			setZoneDragActive(zoneRef.current, false);
		}
	}, []);

	const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
		if (optsRef.current.disabled) return;
		e.preventDefault();
		e.stopPropagation();
		try {
			e.dataTransfer.dropEffect = 'copy';
		} catch {
			// ignore
		}
	}, []);

	const onDrop = useCallback(
		(e: DragEvent<HTMLDivElement>) => {
			if (optsRef.current.disabled) return;
			e.preventDefault();
			e.stopPropagation();
			dragDepthRef.current = 0;
			setZoneDragActive(zoneRef.current, false);
			const files = e.dataTransfer?.files;
			if (files?.length) emit(files, 'drop');
		},
		[emit],
	);

	const onInputChange = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files;
			if (files?.length) emit(files, 'input');
			e.target.value = '';
		},
		[emit],
	);

	const openFilePicker = useCallback(() => {
		if (optsRef.current.disabled) return;
		const pick = optsRef.current.pickFiles;
		if (pick) {
			void pick().then((files) => {
				if (files?.length) emit(files, 'input');
			});
			return;
		}
		inputRef.current?.click();
	}, [emit]);

	const resetInput = useCallback(() => {
		if (inputRef.current) inputRef.current.value = '';
	}, []);

	const onZoneClick = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (optsRef.current.disabled || optsRef.current.noClickToOpen) return;
			const target = e.target as HTMLElement | null;
			const interactive = target?.closest('button,a,[role="button"]');
			// zone 自身带 role=button；点内部文案时 closest 会命中 zone，勿误当成「子交互控件」而 return
			if (interactive && interactive !== e.currentTarget) return;
			openFilePicker();
		},
		[openFilePicker],
	);

	const onZoneKeyDown = useCallback(
		(e: KeyboardEvent<HTMLDivElement>) => {
			if (optsRef.current.disabled || optsRef.current.noClickToOpen) return;
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				openFilePicker();
			}
		},
		[openFilePicker],
	);

	const zoneHandlers = useMemo<DragDropZoneHandlers>(
		() => ({
			onDragEnter,
			onDragLeave,
			onDragOver,
			onDrop,
			onClick: onZoneClick,
			onKeyDown: onZoneKeyDown,
			role: 'button',
			tabIndex: disabled ? -1 : 0,
			...(disabled ? { 'aria-disabled': true as const } : {}),
		}),
		[
			disabled,
			onDragEnter,
			onDragLeave,
			onDragOver,
			onDrop,
			onZoneClick,
			onZoneKeyDown,
		],
	);

	const inputClassName =
		'sr-only pointer-events-none absolute m-0 size-0 min-h-0 min-w-0 overflow-hidden border-0 p-0 opacity-0';

	const inputRest = useMemo(
		() => ({
			type: 'file' as const,
			accept,
			multiple,
			disabled,
			onChange: onInputChange,
			name,
			capture,
			...(directory ? { webkitdirectory: true as const } : {}),
		}),
		[accept, multiple, disabled, name, capture, directory, onInputChange],
	);

	return {
		zoneRef,
		inputRef,
		zoneHandlers,
		inputClassName,
		inputRest,
		openFilePicker,
		resetInput,
	};
}

export type DragDropFileUploadRenderContext = {
	openFilePicker: () => void;
	disabled: boolean;
};

export interface DragDropFileUploadProps extends UseDragDropFileUploadOptions {
	className?: string;
	zoneClassName?: string;
	children?: ReactNode | ((ctx: DragDropFileUploadRenderContext) => ReactNode);
	inputProps?: Omit<
		ComponentPropsWithRef<'input'>,
		| 'type'
		| 'onChange'
		| 'disabled'
		| 'accept'
		| 'multiple'
		| 'name'
		| 'capture'
	>;
	/** 可聚焦区域的无障碍标签 */
	ariaLabel?: string;
}

export type DragDropFileUploadHandle = {
	open: () => void;
	reset: () => void;
	getInputElement: () => HTMLInputElement | null;
	getZoneElement: () => HTMLDivElement | null;
};

const defaultChildren = (ctx: DragDropFileUploadRenderContext) => (
	<div className="text-textcolor/70 flex flex-col items-center justify-center gap-1 py-8 text-sm">
		<span>拖拽文件到此处，或按 Enter / Space 选择</span>
		{ctx.disabled ? <span className="text-textcolor/40">已禁用</span> : null}
	</div>
);

function assignRef<T>(r: Ref<T> | undefined, node: T | null) {
	if (!r) return;
	if (typeof r === 'function') r(node);
	else (r as MutableRefObject<T | null>).current = node;
}

export const DragDropFileUpload = forwardRef<
	DragDropFileUploadHandle,
	DragDropFileUploadProps
>(function DragDropFileUpload(
	{
		className,
		zoneClassName,
		children,
		inputProps: extraInputProps,
		ariaLabel,
		...hookOptions
	},
	ref,
) {
	const hook = useDragDropFileUpload(hookOptions);

	const zoneHandlers = useMemo(() => {
		const h = { ...hook.zoneHandlers };
		if (ariaLabel) h['aria-label'] = ariaLabel;
		return h;
	}, [hook.zoneHandlers, ariaLabel]);

	useImperativeHandle(
		ref,
		() => ({
			open: hook.openFilePicker,
			reset: hook.resetInput,
			getInputElement: () => hook.inputRef.current,
			getZoneElement: () => hook.zoneRef.current,
		}),
		[hook.openFilePicker, hook.resetInput, hook.inputRef, hook.zoneRef],
	);

	const ctx = useMemo<DragDropFileUploadRenderContext>(
		() => ({
			openFilePicker: hook.openFilePicker,
			disabled: Boolean(hookOptions.disabled),
		}),
		[hook.openFilePicker, hookOptions.disabled],
	);

	const body =
		typeof children === 'function'
			? children(ctx)
			: (children ?? defaultChildren(ctx));

	const {
		ref: extraRef,
		className: extraInputClassName,
		...extraRest
	} = extraInputProps ?? {};

	return (
		<div className={cn('relative min-h-0 min-w-0', className)}>
			<div
				ref={hook.zoneRef}
				{...zoneHandlers}
				className={cn(
					'border-theme/40 focus-visible:ring-theme/30 relative cursor-pointer rounded-md border border-dashed outline-none transition-colors focus-visible:ring-[3px]',
					'data-drag-active:border-theme data-drag-active:bg-theme/10',
					hookOptions.disabled &&
						'pointer-events-none cursor-not-allowed opacity-50',
					zoneClassName,
				)}
			>
				{body}
			</div>
			<Input
				{...hook.inputRest}
				{...extraRest}
				ref={(node) => {
					assignRef(hook.inputRef, node);
					assignRef(extraRef, node);
				}}
				className={cn(hook.inputClassName, extraInputClassName)}
			/>
		</div>
	);
});

export default DragDropFileUpload;
