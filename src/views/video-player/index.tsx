/**
 * 视频播放器插件入口（MF expose ./VideoPlayer）
 * 组合：VideoUpload（选文件）+ VideoPlayer（纯播放），列表状态在此维护。
 *
 * 空态 / 播放态共用同一套 vp-wrap 高度链（与改前一致），避免 Fragment 双 wrap 把内容区高度压没。
 * 点选：优先 Host `api.ui.pickLocalFiles`（Tauri 原生对话框 / Web blob）；拖拽仍走 File。
 */
import { useCallback, useRef, useState } from 'react';
import type {
	DragDropAcceptResult,
	DragDropRejectedFile,
} from '@/components/design/DragDropFileUpload';
import {
	appendPickedVideos,
	appendVideoFiles,
	LIMIT,
	revokeVideoUrls,
	type VideoItem,
	VideoPlayer,
} from '@/components/design/VideoPlayer';
import { TooltipProvider } from '@/components/ui';
import { useHostLocale, useI18n } from '@/hooks';
import type { Locale } from '@/i18n';
import { cn } from '@/lib/utils';
import VideoUpload, {
	VIDEO_ACCEPT,
	type VideoUploadHandle,
} from './components/VideoUpload';
/** MF 嵌入 Host 时必须由 expose 入口带上 Tailwind，否则仅 Host 扫到的 utility 生效 */
import '@/styles.css';

type HostPickedLocalFile = {
	path: string;
	name: string;
	src: string;
};

type HostBridgeProps = {
	api: {
		theme: 'light' | 'dark';
		locale?: Locale;
		event?: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		ui?: {
			showToast: (options: {
				message: string;
				type?: 'success' | 'error' | 'info';
			}) => void;
			setAppFullscreen?: (full: boolean) => Promise<void>;
			pickLocalFiles?: (options?: {
				accept?: string;
				multiple?: boolean;
				title?: string;
			}) => Promise<HostPickedLocalFile[] | null>;
		};
	};
	plugin: { id: string; version: string; routePath: string };
	independent?: boolean;
};

function rejectToastMessage(
	rejected: DragDropRejectedFile[],
	t: (key: string, params?: Record<string, unknown>) => string,
): string {
	const acceptHits = rejected.filter((r) => r.reason.code === 'accept');
	const maxHits = rejected.filter((r) => r.reason.code === 'maxCount');
	if (acceptHits.length && !maxHits.length) {
		return acceptHits.length === 1
			? t('videoPlayer.rejectAccept', { name: acceptHits[0].file.name })
			: t('videoPlayer.rejectAcceptMany', { count: acceptHits.length });
	}
	if (maxHits.length && !acceptHits.length) {
		const max =
			maxHits[0].reason.code === 'maxCount' ? maxHits[0].reason.max : 0;
		return t('videoPlayer.rejectMaxCount', { max });
	}
	return t('videoPlayer.rejectMixed', { count: rejected.length });
}

const VideoPlayerApp = ({ api }: HostBridgeProps) => {
	useHostLocale(api);
	const { t } = useI18n();
	const [videos, setVideos] = useState<VideoItem[]>([]);
	const uploadRef = useRef<VideoUploadHandle>(null);

	const onFiles = useCallback(
		(result: DragDropAcceptResult) => {
			if (result.rejected.length) {
				api.ui?.showToast({
					message: rejectToastMessage(result.rejected, t),
					type: 'error',
				});
			}
			if (!result.accepted.length) return;
			setVideos((prev) => appendVideoFiles(result.accepted, prev));
		},
		[api.ui, t],
	);

	/** Host 选文件：直接入库；返回 null 避免 DragDrop 再走 File 通道 */
	const pickFiles = useCallback(async (): Promise<File[] | null> => {
		const pick = api.ui?.pickLocalFiles;
		if (!pick) return null;
		const remain = Math.max(0, LIMIT - videos.length);
		if (remain <= 0) return null;
		const picked = await pick({
			accept: VIDEO_ACCEPT,
			multiple: true,
			title: t('videoPlayer.selectVideo'),
		});
		if (!picked?.length) return null;
		setVideos((prev) => appendPickedVideos(picked.slice(0, remain), prev));
		return null;
	}, [api.ui, t, videos.length]);

	const onClear = useCallback(() => {
		setVideos((prev) => {
			revokeVideoUrls(prev);
			return [];
		});
	}, []);

	const hasVideos = videos.length > 0;

	return (
		<TooltipProvider delayDuration={200}>
			<div className="relative box-border h-full min-h-0 w-full select-none rounded-[5px] [-webkit-user-select:none]">
				<div className="relative box-border h-full rounded-md p-0 text-center">
					{/* 上传区始终挂载：空态展示，有片后藏起仍可供「继续选择」open() */}
					<div
						className={cn(
							hasVideos
								? 'sr-only'
								: 'relative flex h-full w-full justify-center overflow-hidden rounded-md text-center contain-[layout_paint]',
						)}
						aria-hidden={hasVideos}
					>
						<VideoUpload
							ref={uploadRef}
							existingCount={videos.length}
							onFiles={onFiles}
							pickFiles={api.ui?.pickLocalFiles ? pickFiles : undefined}
						/>
					</div>

					{hasVideos ? (
						<VideoPlayer
							embedded
							videos={videos}
							hostUi={api.ui}
							onAdd={() => uploadRef.current?.open()}
							onClear={onClear}
						/>
					) : null}
				</div>
			</div>
		</TooltipProvider>
	);
};

VideoPlayerApp.activate = async (api: HostBridgeProps['api']) => {
	console.log('[video-player] activate', api);
};

VideoPlayerApp.deactivate = (api: HostBridgeProps['api']) => {
	console.log('[video-player] deactivate', api);
};

export default VideoPlayerApp;
