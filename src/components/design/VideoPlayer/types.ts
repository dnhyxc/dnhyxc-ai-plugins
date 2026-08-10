import type { VideoItem } from './tools';

export type VideoPlayerHostUi = {
	showToast?: (options: {
		message: string;
		type?: 'success' | 'error' | 'info';
	}) => void;
	setAppFullscreen?: (full: boolean) => Promise<void>;
};

export type VideoPlayerProps = {
	/** 播放列表（外部传入；播放器不负责上传） */
	videos: VideoItem[];
	/** 受控当前集下标 */
	index?: number;
	/** 非受控初始下标 */
	defaultIndex?: number;
	onIndexChange?: (index: number) => void;
	className?: string;
	/**
	 * 嵌入模式：只渲染画面壳，由外层提供 wrap > content 高度链。
	 * 插件页与上传区同容器组合时用。
	 */
	embedded?: boolean;
	hostUi?: VideoPlayerHostUi;
	/**
	 * 继续添加：传入则显示「继续选择」按钮。
	 * 上传 UI 由外部自己管，这里只触发回调。
	 */
	onAdd?: () => void;
	/** 清空：传入则显示「重置」；外部应清空 videos 并 revoke blob URL */
	onClear?: () => void;
};
