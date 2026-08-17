import { Component } from 'lucide-react';
import { type ReactNode, useMemo, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';
import '../RichEditor/styles.css';
import { preparePreviewBody } from './previewHtml';
import './styles.css';
import {
	type HostDownloadBlob,
	useNoteImagePreview,
} from './useNoteImagePreview';

export type NotePreviewProps = {
	/** 顶栏标题（替代编辑器 toolbar） */
	title: string;
	/** TipTap HTML 或 JSON 内容 */
	html?: string;
	/** 顶栏标题旁/下方的次要信息（时间、标签等） */
	meta?: ReactNode;
	/** 顶栏右侧操作（返回编辑、列表开关等） */
	headerExtra?: ReactNode;
	/** 自定义正文；传入时忽略 html */
	children?: ReactNode;
	footer?: ReactNode;
	className?: string;
	bodyClassName?: string;
	emptyText?: string;
	loading?: boolean;
	/**
	 * 点击图片预览时的下载实现。
	 * 嵌入 Host 用 api.ui.downloadBlob；独立预览用 mockHost 同源实现。
	 */
	downloadBlob?: HostDownloadBlob;
};

export {
	decoratePreviewHtml,
	preparePreviewBody,
	preserveEmptyParagraphs,
	splitPreviewBlocks,
	stripNoteTitleHtml,
} from './previewHtml';

export type { HostDownloadBlob } from './useNoteImagePreview';
export { useNoteImagePreview } from './useNoteImagePreview';

/**
 * 笔记只读预览：与编辑态同一套 ScrollArea + RichEditor 正文样式（静态 HTML，不挂 TipTap）。
 */
export function NotePreview({
	title,
	html,
	meta,
	headerExtra,
	children,
	footer,
	className,
	bodyClassName,
	emptyText,
	loading,
	downloadBlob,
}: NotePreviewProps) {
	const { t } = useI18n();
	const empty = emptyText ?? t('common.emptyContent');
	const bodyHtml = useMemo(
		() => (html ? preparePreviewBody(html) : ''),
		[html],
	);
	const bodyRef = useRef<HTMLDivElement>(null);
	const { noteImagePreviewModal } = useNoteImagePreview({
		rootRef: bodyRef,
		html: children == null ? html : undefined,
		downloadBlob,
		t,
		enabled: children == null,
		rebindWhen: bodyHtml,
	});

	return (
		<div
			className={cn(
				// contain layout/paint：大预览 DOM 不拖累左侧列表；勿加 style——
				// WebKit/Tauri 下 contain:style 会导致子树样式进页不生效，鼠标移入才闪一下补上（如图 margin）
				'note-preview flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-r-md contain-[layout_paint]',
				className,
			)}
		>
			<header className="note-preview-header h-10 border-theme/10 flex shrink-0 items-center gap-3 border-b pl-3 pr-1.5 py-2.5">
				<div className="min-w-0 flex-1">
					<h1 className="text-textcolor truncate text-base font-semibold leading-snug">
						{title.trim() || t('common.untitledNote')}
					</h1>
					{meta ? (
						<div className="text-textcolor/45 mt-0.5 truncate text-xs">
							{meta}
						</div>
					) : null}
				</div>
				{headerExtra ? (
					<div className="flex shrink-0 items-center gap-0.5">
						{headerExtra}
					</div>
				) : null}
			</header>

			{children != null ? (
				children
			) : bodyHtml ? (
				<ScrollArea
					className={cn(
						'rich-editor-body note-preview-static text-textcolor min-h-0 flex-1',
						bodyClassName,
					)}
				>
					<div
						ref={bodyRef}
						className="tiptap note-preview-tiptap ProseMirror"
						// tipTap 导出 HTML；预览只读
						dangerouslySetInnerHTML={{ __html: bodyHtml }}
					/>
				</ScrollArea>
			) : loading ? null : (
				<div className="flex items-center justify-center flex-col gap-5 h-full box-border min-w-0 max-w-full w-full p-3 rounded-md">
					<Component className="w-16 h-16 text-textcolor/70 animate-bounce" />
					<div className="text-sm text-textcolor/80">{empty}</div>
				</div>
			)}

			{footer ? <div className="shrink-0">{footer}</div> : null}
			{noteImagePreviewModal}
		</div>
	);
}

export default NotePreview;
