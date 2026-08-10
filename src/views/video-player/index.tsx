/**
 * 视频播放器插件入口（MF expose ./VideoPlayer）
 * 组合：VideoUpload（选文件）+ VideoPlayer（纯播放），列表状态在此维护。
 *
 * 空态 / 播放态共用同一套 vp-wrap 高度链（与改前一致），避免 Fragment 双 wrap 把内容区高度压没。
 */
import { useCallback, useRef, useState } from "react";
import type { DragDropAcceptResult } from "@/components/design/DragDropFileUpload";
import {
	appendVideoFiles,
	revokeVideoUrls,
	type VideoItem,
	VideoPlayer,
} from "@/components/design/VideoPlayer";
import { TooltipProvider } from "@/components/ui";
import { useHostLocale } from "@/hooks";
import type { Locale } from "@/i18n";
import { cn } from "@/lib/utils";
import VideoUpload, { type VideoUploadHandle } from "./components/VideoUpload";
/** MF 嵌入 Host 时必须由 expose 入口带上 Tailwind，否则仅 Host 扫到的 utility 生效 */
import "@/styles.css";

type HostBridgeProps = {
	api: {
		theme: "light" | "dark";
		locale?: Locale;
		event?: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		ui?: {
			showToast: (options: {
				message: string;
				type?: "success" | "error" | "info";
			}) => void;
			setAppFullscreen?: (full: boolean) => Promise<void>;
		};
	};
	plugin: { id: string; version: string; routePath: string };
	independent?: boolean;
};

const VideoPlayerApp = ({ api }: HostBridgeProps) => {
	useHostLocale(api);
	const [videos, setVideos] = useState<VideoItem[]>([]);
	const uploadRef = useRef<VideoUploadHandle>(null);

	const onFiles = useCallback((result: DragDropAcceptResult) => {
		if (!result.accepted.length) return;
		setVideos((prev) => appendVideoFiles(result.accepted, prev));
	}, []);

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
								? "sr-only"
								: "relative flex h-full w-full justify-center overflow-hidden rounded-md text-center contain-[layout_paint]",
						)}
						aria-hidden={hasVideos}
					>
						<VideoUpload
							ref={uploadRef}
							existingCount={videos.length}
							onFiles={onFiles}
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

VideoPlayerApp.activate = async (api: HostBridgeProps["api"]) => {
	console.log("[video-player] activate", api);
};

VideoPlayerApp.deactivate = (api: HostBridgeProps["api"]) => {
	console.log("[video-player] deactivate", api);
};

export default VideoPlayerApp;
