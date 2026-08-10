import { AlertDialog as AlertDialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { useCallback, useEffect } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';

interface ConfirmProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: ReactNode;
	/** 描述区域额外 className（例如 text-left） */
	descriptionClassName?: string;
	confirmText?: string;
	cancelText?: string;
	/** 确认按钮样式，覆盖保存等危险操作用 destructive */
	confirmVariant?: 'default' | 'destructive';
	/**
	 * 点击确认后是否立即关闭。异步 onConfirm 且需在失败时保持打开时设为 false，由调用方自行 onOpenChange(false)
	 */
	closeOnConfirm?: boolean;
	/**
	 * 为 true 且弹层打开时，回车触发与「确认」相同逻辑（会排除 input/textarea 等，避免与编辑器冲突）
	 */
	confirmOnEnter?: boolean;
	onConfirm: () => void;
	/** 可选第三钮（如「另存为」），样式为 outline，位于取消与确认之间 */
	secondaryActionText?: string;
	onSecondaryAction?: () => void | Promise<void>;
	/** 可选第四钮，位于 secondary 与主确认之间 */
	tertiaryActionText?: string;
	onTertiaryAction?: () => void | Promise<void>;
	tertiaryVariant?: 'outline' | 'destructive';
	onCancel?: () => void;
	className?: string;
}

const Confirm = ({
	open,
	onOpenChange,
	title,
	description,
	descriptionClassName,
	confirmText,
	cancelText,
	confirmVariant = 'default',
	closeOnConfirm = true,
	confirmOnEnter = false,
	onConfirm,
	secondaryActionText,
	onSecondaryAction,
	tertiaryActionText,
	onTertiaryAction,
	tertiaryVariant = 'outline',
	onCancel,
	className,
}: ConfirmProps) => {
	const { t } = useI18n();
	const confirmLabel = confirmText ?? t('common.confirm');
	const cancelLabel = cancelText ?? t('common.cancel');

	const handleConfirm = useCallback(() => {
		onConfirm();
		if (closeOnConfirm) {
			onOpenChange(false);
		}
	}, [onConfirm, closeOnConfirm, onOpenChange]);

	const handleCancel = () => {
		onCancel?.();
		onOpenChange(false);
	};

	/** 按需：弹层打开时回车等同点击确认（排除输入类元素，避免与编辑器抢键） */
	useEffect(() => {
		if (!open || !confirmOnEnter) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Enter' || e.repeat) return;
			const el = e.target as HTMLElement | null;
			if (
				el?.closest(
					'input, textarea, select, [contenteditable="true"], [role="textbox"]',
				)
			) {
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			handleConfirm();
		};
		window.addEventListener('keydown', onKeyDown, true);
		return () => window.removeEventListener('keydown', onKeyDown, true);
	}, [open, confirmOnEnter, handleConfirm]);

	return (
		<AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<AlertDialogPrimitive.Portal>
				<AlertDialogPrimitive.Overlay
					className={cn(
						'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-theme-background/80',
					)}
				/>
				<AlertDialogPrimitive.Content
					className={cn(
						'bg-theme-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full min-w-0 max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border border-theme/10 p-6 shadow-lg duration-200 sm:max-w-lg',
						className,
					)}
				>
					<AlertDialogPrimitive.Title className="min-w-0 wrap-break-word text-lg font-semibold">
						{title}
					</AlertDialogPrimitive.Title>
					{/* 使用 asChild + div：避免默认 <p> 内嵌 <div> 导致非法 DOM 与水合报错 */}
					<AlertDialogPrimitive.Description asChild>
						<div
							className={cn(
								'text-textcolor text-md min-w-0 wrap-anywhere',
								descriptionClassName,
							)}
						>
							{description}
						</div>
					</AlertDialogPrimitive.Description>
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end mt-4">
						<AlertDialogPrimitive.Cancel
							onClick={handleCancel}
							className={cn(buttonVariants({ variant: 'outline' }))}
						>
							{cancelLabel}
						</AlertDialogPrimitive.Cancel>
						{secondaryActionText && onSecondaryAction ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => void onSecondaryAction()}
							>
								{secondaryActionText}
							</Button>
						) : null}
						{tertiaryActionText && onTertiaryAction ? (
							<Button
								type="button"
								variant={tertiaryVariant}
								onClick={() => void onTertiaryAction()}
							>
								{tertiaryActionText}
							</Button>
						) : null}
						<AlertDialogPrimitive.Action
							onClick={handleConfirm}
							className={cn(buttonVariants({ variant: confirmVariant }))}
						>
							{confirmLabel}
						</AlertDialogPrimitive.Action>
					</div>
				</AlertDialogPrimitive.Content>
			</AlertDialogPrimitive.Portal>
		</AlertDialogPrimitive.Root>
	);
};

export default Confirm;
