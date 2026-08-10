/**
 * 视频上传区 —— Neon Cinema 设计风格
 *
 * 视觉：深夜影院氛围，胶片条装饰、霓虹辉光、扫描线、颗粒噪点。
 * 布局：顶部标题栏 + 左右分屏（左：上传舞台 / 右：功能列表）+ 底部状态栏。
 *
 * 结构：外层为普通 div 布局，DragDropFileUpload 仅包裹舞台区域（红框内），
 *       确保只有点击/拖拽舞台才触发上传。
 */

import {
	Film,
	FlipHorizontal,
	GripVertical,
	Keyboard,
	Maximize2,
	Monitor,
	PictureInPicture,
	Play,
	RotateCcw,
	Scissors,
	SkipForward,
	Sparkles,
	Upload,
	Volume2,
	Zap,
} from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import DragDropFileUpload, {
	type DragDropAcceptResult,
	type DragDropFileSource,
	type DragDropFileUploadHandle,
	type DragDropFileUploadProps,
} from '@/components/design/DragDropFileUpload';
import { LIMIT } from '@/components/design/VideoPlayer';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';

export type VideoUploadHandle = DragDropFileUploadHandle;

export type VideoUploadProps = Omit<
	DragDropFileUploadProps,
	'accept' | 'multiple' | 'maxCount' | 'onFiles'
> & {
	existingCount?: number;
	maxCount?: number;
	onFiles: (result: DragDropAcceptResult, source: DragDropFileSource) => void;
	children?: ReactNode;
};

const FEATURES = [
	{ num: '01', icon: Play, key: 'videoPlayer.featurePlay' },
	{ num: '02', icon: Zap, key: 'videoPlayer.featureSpeed' },
	{ num: '03', icon: PictureInPicture, key: 'videoPlayer.featurePip' },
	{ num: '04', icon: Maximize2, key: 'videoPlayer.featureFullscreen' },
	{ num: '05', icon: RotateCcw, key: 'videoPlayer.featureLoop' },
	{ num: '06', icon: Monitor, key: 'videoPlayer.featureList' },
	{ num: '07', icon: Volume2, key: 'videoPlayer.featureVolume' },
	{ num: '08', icon: GripVertical, key: 'videoPlayer.featureSeek' },
	{ num: '09', icon: SkipForward, key: 'videoPlayer.featurePrevNext' },
	{ num: '10', icon: Keyboard, key: 'videoPlayer.featureShortcut' },
	{ num: '11', icon: FlipHorizontal, key: 'videoPlayer.featureMirror' },
	{ num: '12', icon: Scissors, key: 'videoPlayer.featureFramePreview' },
] as const;

const FORMATS = ['MP4', 'WebM', 'MOV', 'MKV', 'FLV'];

export const VideoUpload = forwardRef<VideoUploadHandle, VideoUploadProps>(
	function VideoUpload(
		{
			existingCount = 0,
			maxCount = LIMIT,
			className,
			zoneClassName,
			ariaLabel,
			children,
			...rest
		},
		ref,
	) {
		const { t } = useI18n();
		const remain = Math.max(0, maxCount - existingCount);

		return (
			<div
				className={cn(
					'relative flex h-full w-full min-h-0 flex-col p-4.5 pt-3 text-textcolor',
					className,
				)}
			>
				{/* 顶部标题栏 */}
				<header className="relative z-10 flex items-center justify-between pb-3">
					<div className="flex items-center gap-2.5">
						<Film size={20} className="text-teal-500" />
						<span className="text-sm font-semibold tracking-[0.2em] text-textcolor">
							{t('videoPlayer.selectVideo')}
						</span>
					</div>
					<div className="flex items-center gap-3 font-mono text-[11px]">
						<div className="text-textcolor/80 tabular-nums">
							{t('videoPlayer.countRemaining', { count: remain })}
						</div>
					</div>
				</header>

				{/* 主体：左右分屏 */}
				<main className="relative z-10 flex min-h-0 flex-1 gap-4">
					{/* 左侧：上传舞台 —— DragDropFileUpload 仅包裹此区域 */}
					<DragDropFileUpload
						ref={ref}
						className="flex min-h-0 flex-1"
						zoneClassName={cn(
							'relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border border-theme/5 bg-theme/3',
							'hover:border-teal-500 data-drag-active:!border-teal-500',
							zoneClassName,
						)}
						accept="video/*"
						multiple
						maxCount={remain}
						ariaLabel={ariaLabel ?? t('videoPlayer.selectVideo')}
						{...rest}
						disabled={remain <= 0 || Boolean(rest.disabled)}
					>
						{children ?? (
							<div className="data-drag-active:bg-teal-500/5 cursor-pointer group relative flex min-h-0 flex-1 flex-col items-center gap-5 p-6">
								{/* 中心区：图标 + 标题 + 格式标签 */}
								<div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5">
									<div className="relative z-10 flex h-12 w-12 items-center justify-center rounded-xl bg-teal-500/10 text-teal-500 border border-teal-500/10">
										<Upload size={26} />
									</div>
									{/* 标题文本 */}
									<div className="relative z-10 flex flex-col items-center gap-5 text-center">
										<div className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/10 bg-teal-500/10 px-3 py-1 text-[11px] font-medium tracking-wide text-teal-400">
											<Sparkles size={11} />
											{t('videoPlayer.selectVideo')}
										</div>
										<div className="text-xl font-bold tracking-tight text-textcolor/50">
											{t('videoPlayer.dragOrClick')}
										</div>
									</div>

									{/* 格式标签 + 提示文字 */}
									<div className="relative z-10 flex flex-col items-center gap-5">
										<p className="text-center text-xs leading-relaxed text-textcolor/35">
											{t('videoPlayer.tipDesc')}
										</p>
										<div className="flex flex-wrap items-center justify-center gap-2">
											<span className="rounded border border-theme/5 bg-theme/5 text-xs px-2 pt-[3px] pb-1 tracking-wider text-textcolor/30">
												{t('videoPlayer.supportedFormats')}
											</span>
											{FORMATS.map((fmt) => (
												<span
													key={fmt}
													className="rounded border border-teal-500/10 bg-teal-500/10 px-2 pt-[3px] pb-1 font-mono text-xs tracking-wider text-teal-500"
												>
													{fmt}
												</span>
											))}
										</div>
									</div>
								</div>
							</div>
						)}
					</DragDropFileUpload>

					{/* 右侧：功能面板 — 卡片模式 */}
					<aside
						className={cn(
							'relative flex w-60 flex-col overflow-hidden rounded-md border border-dashed border-theme/5 bg-theme/3',
						)}
					>
						<div className="relative z-10 flex min-h-0 flex-1 flex-col">
							{/* 标题 */}
							<div className="mx-3 mt-2.5 pb-2.5 flex shrink-0 items-center gap-2 border-b border-theme/5">
								<Zap size={16} className="-mt-0.5 text-teal-500" />
								<span className="text-sm font-medium tracking-[0.15em] text-textcolor/60">
									{t('videoPlayer.featuresTitle').toUpperCase()}
								</span>
							</div>

							{/* 功能列表：flex-1 铺满容器，每项等分 */}
							<div className="mx-1 flex flex-1 flex-col justify-between px-2 py-2">
								{FEATURES.map((f) => (
									<div
										key={f.key}
										className="flex flex-1 min-h-0 items-center gap-3 rounded-lg transition-colors"
									>
										<span className="font-mono text-sm text-textcolor/35 tabular-nums">
											{f.num}
										</span>
										<span className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-md bg-theme/5 text-teal-500 transition-colors">
											<f.icon size={14.5} />
										</span>
										<span className="text-sm text-textcolor/70 transition-colors">
											{t(f.key)}
										</span>
									</div>
								))}
							</div>
						</div>
					</aside>
				</main>
			</div>
		);
	},
);

export default VideoUpload;
