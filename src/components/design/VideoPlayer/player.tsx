/**
 * 通用视频播放器（仅播放）：列表与上传由外部传入 / 组合。
 *
 * 功能：xgplayer、自定义控制条、进度条、上下集、设置、选集、音量、倍速、PiP、全屏、快捷键。
 */

import { HoverPopover, RatePanel, Segmented, Tip, Volume } from '@design/index';
import { ScrollArea } from '@ui/scroll-area';
import {
	FolderPlus,
	ListRestart,
	ListVideo,
	Maximize,
	Minimize,
	Pause,
	PictureInPicture2,
	Play,
	Settings,
	SkipBack,
	SkipForward,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Player from 'xgplayer';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';
import {
	enterFullscreen,
	exitFullscreen,
	formatTime,
	getFullscreenElement,
	PLAY_OPTIONS,
	type PlayType,
	SCREEN_TYPE,
	type ScreenType,
	setDocumentAppFullscreen,
	type VideoItem,
} from './tools';
import type { VideoPlayerProps } from './types';
import 'xgplayer/dist/index.min.css';

// 底栏操作图标统一尺寸
const CTRL_ICON = 18;
// 倍速列表
const PLAYBACK_RATES = [3, 2.5, 2, 1.5, 1, 0.75, 0.5];
// 控制条隐藏时间
const CHROME_HIDE_MS = 3000;

export default function VideoPlayer({
	videos,
	index: indexProp,
	defaultIndex = 0,
	onIndexChange,
	className,
	embedded = false,
	hostUi,
	onAdd,
	onClear,
}: VideoPlayerProps) {
	const { t, locale } = useI18n();
	/** Host 注入优先；独立运行无注入时用 document 全屏（与 mockHost 同源） */
	const setAppFullscreen = hostUi?.setAppFullscreen ?? setDocumentAppFullscreen;
	/** document 全屏路径（独立预览 / mockHost）；真 Host 影院态为 false */
	const usingDocumentFs =
		!hostUi?.setAppFullscreen ||
		hostUi.setAppFullscreen === setDocumentAppFullscreen;

	const controlled = indexProp !== undefined;
	const [innerIndex, setInnerIndex] = useState(defaultIndex);
	const playIndex = controlled ? indexProp : innerIndex;

	const setPlayIndex = useCallback(
		(next: number) => {
			if (!controlled) setInnerIndex(next);
			onIndexChange?.(next);
		},
		[controlled, onIndexChange],
	);

	const [volume, setVolume] = useState(0.6);
	const [playType, setPlayType] = useState<PlayType>('auto');
	const [screenType, setScreenType] = useState<ScreenType>('auto');
	const [playbackRate, setPlaybackRate] = useState(1);
	const [playStatus, setPlayStatus] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);
	/** 系统画中画中：用自绘 i18n 层盖住浏览器英文占位 */
	const [isPip, setIsPip] = useState(false);
	/** 标题/控制条是否可见（移动显示，静止隐藏；全屏与非全屏同一套） */
	const [uiChromeVisible, setUiChromeVisible] = useState(true);
	const [existDuration, setExistDuration] = useState(false);
	const [hoverTime, setHoverTime] = useState('');
	const [previewOn, setPreviewOn] = useState(false);
	const [playTimeInfo, setPlayTimeInfo] = useState<{
		currentTime: number;
		duration: number;
	}>({ currentTime: 0, duration: 0 });

	const playerRef = useRef<Player | null>(null);
	const animationRef = useRef<number | null>(null);
	const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const screenTypeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isFullscreenRef = useRef(false);
	/** Chromium：cursor:none 会合成 mousemove，短时忽略以免立刻又弹出 */
	const ignoreMouseRef = useRef(false);
	/** 底栏任一 POP 打开时 >0，期间不自动隐藏操作条 */
	const popoverOpenRef = useRef(0);
	/** 指针在底栏上时不自动隐藏操作条与光标 */
	const controlsHoverRef = useRef(false);

	const controlsRef = useRef<HTMLDivElement>(null);
	const durationRef = useRef<HTMLDivElement>(null);
	const currentTimeRef = useRef<HTMLDivElement>(null);
	const miniTimelineRef = useRef<HTMLDivElement>(null);
	const timeTipRef = useRef<HTMLDivElement>(null);
	const timePointRef = useRef<HTMLDivElement>(null);
	const volumeTipRef = useRef<HTMLDivElement>(null);
	/** 离屏解码；画到 canvas，避免 video 层叠破坏进度条 */
	const previewVideoRef = useRef<HTMLVideoElement>(null);
	const previewCanvasRef = useRef<HTMLCanvasElement>(null);
	const previewBoxRef = useRef<HTMLDivElement>(null);

	const previewSeekingRef = useRef(false);
	const previewPendingTimeRef = useRef<number | null>(null);
	const oldVolumeRef = useRef(0.6);
	/** 播放列表/方式：xgplayer ended 闭包易过期，一律读 ref */
	const playTypeRef = useRef(playType);
	const playIndexRef = useRef(playIndex);
	const videosRef = useRef(videos);
	const playbackRateRef = useRef(playbackRate);
	const lastTimeLabelRef = useRef('');
	/** 拖进度条中：禁止 rAF 覆盖滑块 */
	const scrubbingRef = useRef(false);
	const scrubTimeRef = useRef(0);
	/** 松手后停在拖拽像素，等 currentTime 追上再跟播（防关键帧/重算导致右抖） */
	const scrubHoldUntilRef = useRef<number | null>(null);
	/** clientX - (barLeft + fillWidth)，保证拖中与松手几何一致 */
	const scrubGrabOffsetRef = useRef(0);
	const onTimePointUpRef = useRef<() => void>(() => {});

	/** 切集过渡中：忽略 ended 触发的 pause，避免闪出重播/暂停 UI */
	const switchingRef = useRef(false);
	/** 退出画中画续播中：忽略浏览器 pause，避免按钮闪暂停 */
	const pipResumeRef = useRef(false);
	/** 画中画会话内是否应视为播放中（进窗时初始化，窗内 play/pause 更新） */
	const pipWasPlayingRef = useRef(false);
	const isPipRef = useRef(false);
	/** 延迟清除「PiP 内播放」；退出时取消，避免把浏览器退出 pause 当成用户暂停 */
	const pipPauseClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	playTypeRef.current = playType;
	playIndexRef.current = playIndex;
	videosRef.current = videos;
	playbackRateRef.current = playbackRate;

	const safeIndex =
		videos.length === 0
			? 0
			: Math.min(Math.max(0, playIndex), videos.length - 1);
	const currentUrl = videos[safeIndex]?.url ?? '';
	const currentUrlRef = useRef(currentUrl);
	currentUrlRef.current = currentUrl;

	/** 仅给 xgplayer 用，勿再挂 React 子节点（会与播放器抢 DOM） */
	const playerContainerRef = useRef<HTMLDivElement>(null);
	/** 画面 + 自定义控制条外壳，全屏目标 */
	const videoShellRef = useRef<HTMLDivElement>(null);

	const timeInfo = `${formatTime(playTimeInfo.currentTime)} / ${formatTime(playTimeInfo.duration)}`;
	const currentVideoName = videos[safeIndex]?.name ?? '';
	const chromeOn = uiChromeVisible;

	isFullscreenRef.current = isFullscreen;

	const clearVolumeTimer = useCallback(() => {
		if (volumeTimerRef.current) {
			clearTimeout(volumeTimerRef.current);
			volumeTimerRef.current = null;
		}
		volumeTimerRef.current = setTimeout(() => {
			if (volumeTipRef.current) volumeTipRef.current.style.opacity = '0';
		}, 2000);
	}, []);

	const setTimeBarWidth = useCallback(() => {
		if (scrubbingRef.current) return;
		const player = playerRef.current;
		if (!player?.duration || !Number.isFinite(player.duration)) return;
		const hold = scrubHoldUntilRef.current;
		// 未追上拖拽目标前不改宽度，避免松手瞬间按 currentTime 重算导致右抖
		if (hold != null && player.currentTime < hold - 0.02) return;
		if (hold != null) scrubHoldUntilRef.current = null;
		const percentage = (player.currentTime / player.duration) * 100;
		const barW = durationRef.current?.getBoundingClientRect().width ?? 0;
		if (durationRef.current && currentTimeRef.current && barW > 0) {
			currentTimeRef.current.style.width = `${(barW * percentage) / 100}px`;
		}
		if (controlsRef.current && miniTimelineRef.current) {
			miniTimelineRef.current.style.width = `${(controlsRef.current.offsetWidth * percentage) / 100}px`;
		}
		const label = `${formatTime(player.currentTime)} / ${formatTime(player.duration)}`;
		if (lastTimeLabelRef.current === label) return;
		lastTimeLabelRef.current = label;
		setPlayTimeInfo({
			currentTime: player.currentTime,
			duration: player.duration,
		});
	}, []);

	const trackProgress = useCallback(() => {
		if (animationRef.current != null) {
			cancelAnimationFrame(animationRef.current);
		}
		const tick = () => {
			setTimeBarWidth();
			animationRef.current = requestAnimationFrame(tick);
		};
		animationRef.current = requestAnimationFrame(tick);
	}, [setTimeBarWidth]);

	const setScreenTypeFn = useCallback(() => {
		if (screenTypeTimerRef.current) {
			clearTimeout(screenTypeTimerRef.current);
			screenTypeTimerRef.current = null;
		}
		screenTypeTimerRef.current = setTimeout(() => {
			const player = playerRef.current;
			if (player?.root) {
				const video = player.root.querySelector('video');
				if (video) {
					video.style.transform =
						screenType === 'mirror' ? 'scaleX(-1)' : 'scaleX(1)';
				}
			}
		});
	}, [screenType]);

	const clearPipPauseTimer = useCallback(() => {
		if (pipPauseClearTimerRef.current) {
			clearTimeout(pipPauseClearTimerRef.current);
			pipPauseClearTimerRef.current = null;
		}
	}, []);

	const onInPicture = useCallback(() => {
		isPipRef.current = true;
		setIsPip(true);
	}, []);

	/** 退出画中画：与窗内最终播放态同步 */
	const onOutPicture = useCallback(() => {
		clearPipPauseTimer();
		isPipRef.current = false;
		setIsPip(false);
		const player = playerRef.current;
		if (!player || player.ended) return;
		if (!pipWasPlayingRef.current) {
			player.pause();
			setPlayStatus(false);
			return;
		}
		pipResumeRef.current = true;
		setPlayStatus(true);
		trackProgress();
		void player.play().finally(() => {
			pipResumeRef.current = false;
		});
	}, [clearPipPauseTimer, trackProgress]);

	/** 画中画内原生 play（含 PiP 窗口控件）；xgplayer 事件可能收不到 */
	const onPipVideoPlay = useCallback(() => {
		if (
			!isPipRef.current &&
			document.pictureInPictureElement !== playerRef.current?.media
		) {
			return;
		}
		clearPipPauseTimer();
		pipWasPlayingRef.current = true;
		setPlayStatus(true);
		trackProgress();
	}, [clearPipPauseTimer, trackProgress]);

	/** 画中画内原生 pause；退出引发的 pause 由 onOutPicture 取消定时器 */
	const onPipVideoPause = useCallback(() => {
		if (pipResumeRef.current) return;
		if (
			!isPipRef.current &&
			document.pictureInPictureElement !== playerRef.current?.media
		) {
			return;
		}
		clearPipPauseTimer();
		pipPauseClearTimerRef.current = setTimeout(() => {
			pipPauseClearTimerRef.current = null;
			if (
				isPipRef.current ||
				document.pictureInPictureElement === playerRef.current?.media
			) {
				pipWasPlayingRef.current = false;
				setPlayStatus(false);
				if (animationRef.current) cancelAnimationFrame(animationRef.current);
			}
		}, 120);
	}, [clearPipPauseTimer]);

	const onWebkitPipModeChanged = useCallback(() => {
		const video = playerRef.current?.media as
			| (HTMLVideoElement & { webkitPresentationMode?: string })
			| null
			| undefined;
		if (!video) return;
		if (video.webkitPresentationMode === 'picture-in-picture') {
			onInPicture();
		} else {
			onOutPicture();
		}
	}, [onInPicture, onOutPicture]);

	const setupPipListeners = useCallback(() => {
		const video = playerRef.current?.media as
			| (HTMLVideoElement & {
					webkitSetPresentationMode?: (mode: string) => void;
			  })
			| null
			| undefined;
		if (!video) return;
		video.addEventListener('enterpictureinpicture', onInPicture);
		video.addEventListener('leavepictureinpicture', onOutPicture);
		video.addEventListener('play', onPipVideoPlay);
		video.addEventListener('pause', onPipVideoPause);
		if (typeof video.webkitSetPresentationMode === 'function') {
			video.addEventListener(
				'webkitpresentationmodechanged',
				onWebkitPipModeChanged,
			);
		}
	}, [
		onInPicture,
		onOutPicture,
		onPipVideoPlay,
		onPipVideoPause,
		onWebkitPipModeChanged,
	]);

	const removePipListeners = useCallback(() => {
		const video = playerRef.current?.media as
			| (HTMLVideoElement & {
					webkitSetPresentationMode?: (mode: string) => void;
			  })
			| null
			| undefined;
		if (!video) return;
		video.removeEventListener('enterpictureinpicture', onInPicture);
		video.removeEventListener('leavepictureinpicture', onOutPicture);
		video.removeEventListener('play', onPipVideoPlay);
		video.removeEventListener('pause', onPipVideoPause);
		if (typeof video.webkitSetPresentationMode === 'function') {
			video.removeEventListener(
				'webkitpresentationmodechanged',
				onWebkitPipModeChanged,
			);
		}
	}, [
		onInPicture,
		onOutPicture,
		onPipVideoPlay,
		onPipVideoPause,
		onWebkitPipModeChanged,
	]);

	// 切换播放源
	const switchUrl = useCallback(
		(url: string, autoplay?: boolean, currentTime?: number) => {
			const player = playerRef.current;
			if (!player) return;
			trackProgress();
			setScreenTypeFn();
			if (currentTime) {
				player.currentTime = currentTime;
				setPlayTimeInfo({
					currentTime: player.currentTime,
					duration: player.duration,
				});
			}
			player.playNext({
				url,
				lang: locale === 'zh-CN' ? 'zh-cn' : 'en',
				autoplay,
				loop: false,
				pip: true,
				volume,
				playbackRate: PLAYBACK_RATES,
			} as ConstructorParameters<typeof Player>[0]);
			player.playbackRate = playbackRateRef.current;
		},
		[volume, locale, trackProgress, setScreenTypeFn],
	);

	// 自动播放下一集（读 ref，避免 ended 监听器拿到过期 playType/index）
	// 返回是否已切到下一集
	const autoPlayNext = useCallback((): boolean => {
		const type = playTypeRef.current;
		const list = videosRef.current;
		if (type === 'stop' || list.length === 0) return false;

		const found = list.findIndex((i) => i.url === currentUrlRef.current);
		const index = found >= 0 ? found : playIndexRef.current;

		if (type === 'auto') {
			if (index >= list.length - 1) return false;
			switchingRef.current = true;
			setPlayIndex(index + 1);
			return true;
		}
		if (type === 'loop') {
			const nextIndex = index < list.length - 1 ? index + 1 : 0;
			// 仅一条时 url/index 不变，setPlayIndex 不会触发切集，需原地重播
			if (nextIndex === index) {
				const player = playerRef.current;
				if (!player) return false;
				player.currentTime = 0;
				void player.play();
				return true;
			}
			switchingRef.current = true;
			setPlayIndex(nextIndex);
			return true;
		}
		return false;
	}, [setPlayIndex]);

	const autoPlayNextRef = useRef(autoPlayNext);
	autoPlayNextRef.current = autoPlayNext;

	// 初始化播放器
	const initPlayer = useCallback(
		(url: string, autoplay?: boolean, currentTime?: number) => {
			if (playerRef.current) {
				removePipListeners();
				playerRef.current.destroy();
				playerRef.current = null;
			}
			const container = playerContainerRef.current;
			if (!container) return;
			const player = new Player({
				el: container,
				url,
				lang: locale === 'zh-CN' ? 'zh-cn' : 'en',
				lastPlayTime: 0,
				lastPlayTimeHideDelay: 5,
				closeVideoClick: false,
				videoInit: true,
				// fluid + CSS 清掉 padding-top 会把画面高度压成 0；改铺满外壳
				fluid: false,
				width: '100%',
				height: '100%',
				autoplay,
				loop: false,
				pip: true,
				volume,
				controls: false,
				cssFullscreen: false,
				playbackRate: PLAYBACK_RATES,
				// 自定义切集 / 中心播控，不要原生「重播」与「开始/暂停」层
				ignores: ['replay', 'start'],
			} as ConstructorParameters<typeof Player>[0]);
			playerRef.current = player;

			setTimeBarWidth();
			setScreenTypeFn();

			if (currentTime) {
				player.currentTime = currentTime;
				setPlayTimeInfo({
					currentTime: player.currentTime,
					duration: player.duration,
				});
			}

			const bindPip = () => {
				removePipListeners();
				setupPipListeners();
			};
			bindPip();
			player.once('ready', () => {
				bindPip();
				// 未播放也会有 duration：同步可读进度条与总时长
				setTimeBarWidth();
			});
			player.on('loadeddata', setTimeBarWidth);
			player.on('durationchange', setTimeBarWidth);
			player.on('seeked', setTimeBarWidth);

			player.on('play', () => {
				switchingRef.current = false;
				player.playbackRate = playbackRateRef.current;
				trackProgress();
				setPlayStatus(true);
			});
			player.on('replay', () => {
				switchingRef.current = false;
				player.playbackRate = playbackRateRef.current;
				setPlayStatus(true);
				trackProgress();
			});
			player.on('pause', () => {
				// ended 会先 pause；切集 / 退出 PiP 续播时保持「播放中」视觉
				if (switchingRef.current || pipResumeRef.current || player.ended)
					return;
				setPlayStatus(false);
				if (animationRef.current) cancelAnimationFrame(animationRef.current);
				// 暂停后仍刷新一次，进度条与时间与当前帧一致
				setTimeBarWidth();
			});
			player.on('ended', () => {
				if (animationRef.current) cancelAnimationFrame(animationRef.current);
				const switched = autoPlayNextRef.current();
				if (!switched) {
					switchingRef.current = false;
					setPlayStatus(false);
				}
			});
			player.on('destroy', () => {
				setIsPip(false);
				setPlayStatus(false);
				if (animationRef.current) cancelAnimationFrame(animationRef.current);
			});
			player.on('error', () => {
				switchingRef.current = false;
				setPlayStatus(false);
				if (animationRef.current) cancelAnimationFrame(animationRef.current);
			});
		},
		[
			volume,
			locale,
			trackProgress,
			setTimeBarWidth,
			setScreenTypeFn,
			setupPipListeners,
			removePipListeners,
		],
	);

	// 播放控制（play() 异步，状态交给 play/pause 事件；勿用即时 paused 反推）
	const onPlay = useCallback((e?: React.MouseEvent) => {
		e?.stopPropagation();
		void playerRef.current?.play();
	}, []);

	const onPause = useCallback((e?: React.MouseEvent) => {
		e?.stopPropagation();
		playerRef.current?.pause();
	}, []);

	const onShellClick = useCallback(() => {
		const player = playerRef.current;
		if (!player) return;
		if (player.paused) void player.play();
		else player.pause();
	}, []);

	const onPrev = useCallback(() => {
		if (safeIndex === 0 && playType !== 'loop') return;
		if (videos.length === 0) return;
		const curIndex = videos.findIndex((i) => i.url === currentUrl);
		let index: number;
		if (curIndex > 0) index = curIndex - 1;
		else if (playType === 'loop') index = videos.length - 1;
		else index = 0;
		setPlayIndex(index);
	}, [safeIndex, playType, videos, currentUrl, setPlayIndex]);

	const onNext = useCallback(() => {
		if (safeIndex === videos.length - 1 && playType !== 'loop') return;
		if (videos.length === 0) return;
		const curIndex = videos.findIndex((i) => i.url === currentUrl);
		let index: number;
		if (curIndex < videos.length - 1) index = curIndex + 1;
		else if (playType === 'loop') index = 0;
		else index = videos.length - 1;
		setPlayIndex(index);
	}, [safeIndex, playType, videos, currentUrl, setPlayIndex]);

	const onFull = useCallback(
		async (e?: React.MouseEvent) => {
			e?.stopPropagation();
			const shell = videoShellRef.current;

			if (isFullscreenRef.current) {
				shell?.classList.remove('vp-css-fullscreen');
				try {
					await setAppFullscreen(false);
				} catch {
					/* ignore */
				}
				await exitFullscreen();
				setIsFullscreen(false);
				setUiChromeVisible(true);
				return;
			}

			setIsFullscreen(true);
			setUiChromeVisible(true);
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
			hideTimerRef.current = setTimeout(() => {
				if (popoverOpenRef.current > 0 || controlsHoverRef.current) return;
				setUiChromeVisible(false);
				ignoreMouseRef.current = true;
				window.setTimeout(() => {
					ignoreMouseRef.current = false;
				}, 250);
			}, CHROME_HIDE_MS);

			try {
				await setAppFullscreen(true);
				// document 全屏失败时降级元素/CSS（真 Host 影院勿降级，避免 Tauri 误进元素全屏）
				if (usingDocumentFs && !getFullscreenElement() && shell) {
					const mode = await enterFullscreen(shell);
					if (mode === 'css') shell.classList.add('vp-css-fullscreen');
				}
			} catch (err) {
				console.warn('[video-player] enter fullscreen failed', err);
			}
		},
		[setAppFullscreen, usingDocumentFs],
	);

	const onPictureToPicture = useCallback(async (e?: React.MouseEvent) => {
		e?.stopPropagation();
		const player = playerRef.current;
		if (!player) return;
		const video = player.media as HTMLVideoElement & {
			webkitPresentationMode?: string;
			webkitSetPresentationMode?: (mode: string) => void;
			webkitSupportsPresentationMode?: (mode: string) => boolean;
		};
		if (!video) return;

		type PipPlugin = {
			isPip?: boolean;
			isPIPAvailable?: () => boolean;
			requestPIP?: () => unknown;
			exitPIP?: () => unknown;
		};
		const pip = (player as { plugins?: { pip?: PipPlugin } }).plugins?.pip;

		const inPip =
			!!pip?.isPip ||
			document.pictureInPictureElement === video ||
			video.webkitPresentationMode === 'picture-in-picture';

		try {
			if (inPip) {
				if (pip?.exitPIP) {
					pip.exitPIP();
				} else if (document.pictureInPictureElement) {
					await document.exitPictureInPicture();
				} else if (video.webkitSetPresentationMode) {
					video.webkitSetPresentationMode('inline');
				}
				// 播放态由 leavepictureinpicture → onOutPicture 按 pipWasPlayingRef 恢复
				return;
			}

			pipWasPlayingRef.current = !video.paused;

			/**
			 * 必须在用户手势调用栈内直接 requestPiP。
			 * 禁止先 await play() 再 requestPiP（手势会丢，未播放时必失败）。
			 * 暂停态可直接进画中画，进窗后仍保持 paused。
			 */
			if (pip?.isPIPAvailable?.() && pip.requestPIP) {
				pip.requestPIP();
				return;
			}
			if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
				await video.requestPictureInPicture();
				return;
			}
			if (
				video.webkitSupportsPresentationMode?.('picture-in-picture') &&
				video.webkitSetPresentationMode
			) {
				video.webkitSetPresentationMode('picture-in-picture');
			}
		} catch (err) {
			console.warn('[video-player] pip failed', err);
		}
	}, []);

	const onChangePlaybackRate = useCallback((value: number) => {
		playbackRateRef.current = value;
		setPlaybackRate(value);
		const player = playerRef.current;
		if (player) player.playbackRate = value;
	}, []);

	const onVolumeChange = useCallback(() => {
		const player = playerRef.current;
		if (!player) return;
		if (player.volume !== 0) {
			oldVolumeRef.current = volume;
			setVolume(0);
		} else {
			setVolume(oldVolumeRef.current);
		}
	}, [volume]);

	const volumeSliderRef = useRef<HTMLDivElement>(null);

	/** 按指针 Y 直接映射音量，保证滑块中心贴住鼠标 */
	const setVolumeFromPointer = useCallback((clientY: number) => {
		const el = volumeSliderRef.current;
		if (!el) return;
		const { top, height } = el.getBoundingClientRect();
		if (height <= 0) return;
		const next = 1 - (clientY - top) / height;
		setVolume(Math.min(1, Math.max(0, next)));
	}, []);

	const onVolumePointerDown = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
			e.currentTarget.setPointerCapture(e.pointerId);
			setVolumeFromPointer(e.clientY);
		},
		[setVolumeFromPointer],
	);

	const onVolumePointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
			setVolumeFromPointer(e.clientY);
		},
		[setVolumeFromPointer],
	);

	const onCheckUrl = useCallback(
		(_item: VideoItem, index: number) => {
			setPlayIndex(index);
		},
		[setPlayIndex],
	);

	const onReset = useCallback(() => {
		setPlayStatus(false);
		lastTimeLabelRef.current = '';
		setPlayTimeInfo({ currentTime: 0, duration: 0 });
		setPreviewOn(false);
		setHoverTime('');
		if (currentTimeRef.current) currentTimeRef.current.style.width = '0px';
		if (miniTimelineRef.current) miniTimelineRef.current.style.width = '0px';
		if (animationRef.current) cancelAnimationFrame(animationRef.current);
		playerRef.current?.destroy();
		playerRef.current = null;
		onClear?.();
	}, [onClear]);

	/** 显示控制条+光标；静止后隐藏（已显示时 bump 不额外 setState；POP/悬停底栏时不隐藏） */
	const bumpChrome = useCallback(() => {
		if (ignoreMouseRef.current) return;
		setUiChromeVisible((v) => (v ? v : true));
		if (hideTimerRef.current) {
			clearTimeout(hideTimerRef.current);
			hideTimerRef.current = null;
		}
		if (popoverOpenRef.current > 0 || controlsHoverRef.current) return;
		hideTimerRef.current = setTimeout(() => {
			if (popoverOpenRef.current > 0 || controlsHoverRef.current) return;
			setUiChromeVisible(false);
			ignoreMouseRef.current = true;
			window.setTimeout(() => {
				ignoreMouseRef.current = false;
			}, 250);
		}, CHROME_HIDE_MS);
	}, []);

	const onControlsPopoverOpenChange = useCallback(
		(open: boolean) => {
			console.log('onControlsPopoverOpenChange', open);
			popoverOpenRef.current += open ? 1 : -1;
			if (popoverOpenRef.current < 0) popoverOpenRef.current = 0;
			if (open) {
				ignoreMouseRef.current = false;
				setUiChromeVisible(true);
				if (hideTimerRef.current) {
					clearTimeout(hideTimerRef.current);
					hideTimerRef.current = null;
				}
			} else {
				bumpChrome();
			}
		},
		[bumpChrome],
	);

	const onControlsBarEnter = useCallback(() => {
		controlsHoverRef.current = true;
		ignoreMouseRef.current = false;
		setUiChromeVisible(true);
		if (hideTimerRef.current) {
			clearTimeout(hideTimerRef.current);
			hideTimerRef.current = null;
		}
	}, []);

	const onControlsBarLeave = useCallback(() => {
		controlsHoverRef.current = false;
		if (popoverOpenRef.current > 0) return;
		bumpChrome();
	}, [bumpChrome]);

	const onPlayerMouseMove = useCallback(() => {
		bumpChrome();
	}, [bumpChrome]);

	const onPlayerMouseEnter = useCallback(() => {
		bumpChrome();
	}, [bumpChrome]);

	const onPlayerMouseLeave = useCallback(() => {
		if (popoverOpenRef.current > 0 || controlsHoverRef.current) return;
		if (hideTimerRef.current) {
			clearTimeout(hideTimerRef.current);
			hideTimerRef.current = null;
		}
		ignoreMouseRef.current = false;
		setUiChromeVisible(false);
	}, []);

	const getCurrentTime = useCallback((e: MouseEvent | React.MouseEvent) => {
		const initData = { time: 0, offsetX: 0, width: 0, duration: 0, ratio: 0 };
		const rect = durationRef.current?.getBoundingClientRect();
		if (rect) {
			const offsetX = e.clientX - rect.left;
			const width = rect.width;
			const duration = playerRef.current?.duration;
			if (width && duration) {
				const ratio = offsetX / width;
				const _time = ratio * duration;
				const time = _time > duration ? duration : _time < 0 ? 0 : _time;
				return { time, offsetX, width, duration, ratio };
			}
		}
		return initData;
	}, []);

	const seekPreview = useCallback((time: number) => {
		const v = previewVideoRef.current;
		if (!v || !Number.isFinite(time)) return;
		if (previewSeekingRef.current) {
			previewPendingTimeRef.current = time;
			return;
		}
		if (Math.abs(v.currentTime - time) < 0.04) return;
		previewSeekingRef.current = true;
		try {
			v.currentTime = time;
		} catch {
			previewSeekingRef.current = false;
		}
	}, []);

	const paintPreview = useCallback(() => {
		const v = previewVideoRef.current;
		const c = previewCanvasRef.current;
		const box = previewBoxRef.current;
		if (!v || !c || v.readyState < 2) return;
		const vw = v.videoWidth;
		const vh = v.videoHeight;
		if (!vw || !vh) return;
		// 卡片固定横向 160×90
		const cw = 160;
		const ch = 90;
		if (c.width !== cw || c.height !== ch) {
			c.width = cw;
			c.height = ch;
		}
		if (box) box.style.width = `${cw}px`;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		// 横向：cover 占满卡片；竖向：contain 不拉伸
		const scale =
			vw >= vh ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
		const dw = vw * scale;
		const dh = vh * scale;
		ctx.fillStyle = '#000';
		ctx.fillRect(0, 0, cw, ch);
		ctx.drawImage(v, 0, 0, vw, vh, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
	}, []);

	const onPreviewSeeked = useCallback(() => {
		previewSeekingRef.current = false;
		paintPreview();
		const pending = previewPendingTimeRef.current;
		if (pending == null) return;
		previewPendingTimeRef.current = null;
		seekPreview(pending);
	}, [paintPreview, seekPreview]);

	const onProgressHover = useCallback(
		(e: React.MouseEvent) => {
			const player = playerRef.current;
			if (!player || !existDuration) return;
			const { time, offsetX, width } = getCurrentTime(e);
			setHoverTime(formatTime(time));
			setPreviewOn(true);
			seekPreview(time);
			const tip = timeTipRef.current;
			if (!tip || !width) return;
			/* 箭头始终对准鼠标刻度（与改前一致，不做左右夹紧） */
			tip.style.left = `${offsetX}px`;
			/* 预览单独避让溢出，不带动箭头 */
			const box = previewBoxRef.current;
			if (box) {
				const half = 80;
				const shift =
					Math.max(0, half - offsetX) + Math.min(0, width - half - offsetX);
				box.style.transform = `translateX(calc(-50% + ${shift}px))`;
			}
		},
		[existDuration, getCurrentTime, seekPreview],
	);

	const onProgressLeave = useCallback(() => {
		setPreviewOn(false);
		setHoverTime('');
		previewPendingTimeRef.current = null;
	}, []);

	const onDurationClick = useCallback(
		(e: React.MouseEvent) => {
			const player = playerRef.current;
			if (!player || !existDuration) return;
			const { time } = getCurrentTime(e);
			player.seek(time);
			setTimeBarWidth();
		},
		[existDuration, getCurrentTime, setTimeBarWidth],
	);

	const onTimePointMove = useCallback(
		(e: MouseEvent) => {
			const player = playerRef.current;
			const bar = durationRef.current;
			if (!player || !existDuration || !bar) return;
			const dur = player.duration;
			if (!Number.isFinite(dur) || dur <= 0) return;
			const rect = bar.getBoundingClientRect();
			const barW = rect.width;
			if (barW <= 0) return;

			let width = e.clientX - rect.left - scrubGrabOffsetRef.current;
			if (width <= 0) {
				width = 0;
			} else if (width >= barW) {
				if (playType === 'stop') {
					width = barW;
				} else {
					width = 0;
					scrubTimeRef.current = 0;
					if (currentTimeRef.current)
						currentTimeRef.current.style.width = '0px';
					onTimePointUpRef.current();
					return;
				}
			}

			const time = (width / barW) * dur;
			scrubTimeRef.current = time;
			if (currentTimeRef.current)
				currentTimeRef.current.style.width = `${width}px`;
			if (controlsRef.current && miniTimelineRef.current) {
				miniTimelineRef.current.style.width = `${(controlsRef.current.offsetWidth * width) / barW}px`;
			}
			const label = `${formatTime(time)} / ${formatTime(dur)}`;
			if (lastTimeLabelRef.current !== label) {
				lastTimeLabelRef.current = label;
				setPlayTimeInfo({ currentTime: time, duration: dur });
			}
		},
		[existDuration, playType],
	);

	const onTimePointUp = useCallback(() => {
		document.removeEventListener('mousemove', onTimePointMove, true);
		document.removeEventListener('mouseup', onTimePointUp, true);
		const player = playerRef.current;
		if (!player) {
			scrubbingRef.current = false;
			scrubHoldUntilRef.current = null;
			return;
		}
		const time = scrubTimeRef.current;
		const finish = () => {
			if (!scrubbingRef.current) return;
			// 保持拖拽结束像素，禁止立刻 setTimeBarWidth（会右抖）
			scrubHoldUntilRef.current = time;
			scrubbingRef.current = false;
			void player.play();
		};
		if (Math.abs(player.currentTime - time) < 0.05) {
			finish();
			return;
		}
		player.once('seeked', finish);
		player.currentTime = time;
		window.setTimeout(finish, 300);
	}, [onTimePointMove]);
	onTimePointUpRef.current = onTimePointUp;

	const onTimePointDragStart = useCallback(
		(e: React.MouseEvent) => {
			if (!existDuration) return;
			e.preventDefault();
			e.stopPropagation();
			const player = playerRef.current;
			const bar = durationRef.current;
			if (!player || !bar) return;
			const rect = bar.getBoundingClientRect();
			const fillW = currentTimeRef.current?.offsetWidth ?? 0;
			scrubGrabOffsetRef.current = e.clientX - (rect.left + fillW);
			scrubHoldUntilRef.current = null;
			scrubbingRef.current = true;
			scrubTimeRef.current = player.duration
				? (fillW / Math.max(rect.width, 1)) * player.duration
				: player.currentTime;
			if (animationRef.current != null) {
				cancelAnimationFrame(animationRef.current);
				animationRef.current = null;
			}
			player.pause();
			document.addEventListener('mousemove', onTimePointMove, true);
			document.addEventListener('mouseup', onTimePointUp, true);
		},
		[existDuration, onTimePointMove, onTimePointUp],
	);

	// 键盘事件
	const onKeyDown = useCallback(
		(e: KeyboardEvent) => {
			switch (e.key) {
				case 'Escape':
					if (isFullscreenRef.current) {
						e.preventDefault();
						void onFull();
					}
					break;
				case 'ArrowLeft':
				case 'ArrowRight': {
					const player = playerRef.current;
					if (player?.paused) player.play();
					break;
				}
				case 'ArrowUp':
					setVolume((v) => Math.min(v + 0.05, 1));
					if (volumeTipRef.current) {
						volumeTipRef.current.style.opacity = '1';
						clearVolumeTimer();
					}
					break;
				case 'ArrowDown':
					setVolume((v) => Math.max(v - 0.05, 0));
					if (volumeTipRef.current) {
						volumeTipRef.current.style.opacity = '1';
						clearVolumeTimer();
					}
					break;
				default:
					break;
			}
		},
		[clearVolumeTimer, onFull],
	);

	const onFullscreenChange = useCallback(() => {
		const shell = videoShellRef.current;
		const native = !!getFullscreenElement();
		const cssFs = !!shell?.classList.contains('vp-css-fullscreen');

		if (!native && !cssFs && isFullscreenRef.current) {
			// 独立预览 / mockHost：Esc 退出 document 全屏时同步 UI
			// 真 Host（尤其 Tauri）靠 host:app-fullscreen，勿在此误清
			if (usingDocumentFs) {
				setIsFullscreen(false);
				setUiChromeVisible(true);
			}
			return;
		}
		if (cssFs && !native) setIsFullscreen(true);
	}, [usingDocumentFs]);

	const onVisibilityChange = useCallback(() => {
		if (
			document.visibilityState === 'visible' &&
			playerRef.current?.currentTime
		) {
			setTimeBarWidth();
		}
	}, [setTimeBarWidth]);

	useEffect(() => {
		const onHostFs = (e: Event) => {
			const next = !!(e as CustomEvent<{ full?: boolean }>).detail?.full;
			if (!next && isFullscreenRef.current) {
				videoShellRef.current?.classList.remove('vp-css-fullscreen');
				setIsFullscreen(false);
				setUiChromeVisible(true);
			}
		};
		window.addEventListener('host:app-fullscreen', onHostFs);
		return () => window.removeEventListener('host:app-fullscreen', onHostFs);
	}, []);

	// 副作用
	useEffect(() => {
		const player = playerRef.current;
		if (player) player.volume = volume;
	}, [volume]);

	useEffect(() => {
		setScreenTypeFn();
	}, [screenType, setScreenTypeFn]);

	useEffect(() => {
		setExistDuration(
			Number.isFinite(playTimeInfo.duration) && playTimeInfo.duration > 0,
		);
	}, [playTimeInfo.duration]);

	useEffect(() => {
		if (videos.length === 0) return;
		if (!currentUrl) return;
		if (playerContainerRef.current && !playerRef.current) {
			initPlayer(currentUrl, false, 0);
		}
	}, [videos.length, currentUrl, initPlayer]);

	/** 外部换源时切播 */
	const prevUrlRef = useRef(currentUrl);
	useEffect(() => {
		if (!currentUrl || !playerRef.current) {
			prevUrlRef.current = currentUrl;
			return;
		}
		if (prevUrlRef.current !== currentUrl) {
			prevUrlRef.current = currentUrl;
			switchUrl(currentUrl, true);
			previewSeekingRef.current = false;
			previewPendingTimeRef.current = null;
		}
	}, [currentUrl, switchUrl]);

	useEffect(() => {
		document.addEventListener('visibilitychange', onVisibilityChange);
		document.addEventListener('fullscreenchange', onFullscreenChange);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('visibilitychange', onVisibilityChange);
			document.removeEventListener('fullscreenchange', onFullscreenChange);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [onVisibilityChange, onFullscreenChange, onKeyDown]);

	useEffect(() => {
		return () => {
			playerRef.current?.destroy();
			playerRef.current = null;
			if (animationRef.current) cancelAnimationFrame(animationRef.current);
			if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
			if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current);
			if (screenTypeTimerRef.current) clearTimeout(screenTypeTimerRef.current);
			removePipListeners();
			videoShellRef.current?.classList.remove('vp-css-fullscreen');
			void setAppFullscreen(false);
			void exitFullscreen();
		};
	}, [removePipListeners, setAppFullscreen]);

	/** theater / chrome 由 isFullscreen、chromeOn 直接挂在 shell 上 */

	// ponytail: 长视频刻度上限，避免每秒渲染成百上千节点卡死主线程
	const rulerCount =
		existDuration && Number.isFinite(playTimeInfo.duration)
			? Math.min(Math.floor(playTimeInfo.duration / 5), 120)
			: 0;

	if (videos.length === 0) {
		return null;
	}

	const theater = isFullscreen;
	const chromeHidden = !chromeOn;
	/** 全屏黑底上主题色偏暗，chrome 强制白字 */
	const chromeFg = theater ? 'text-white' : 'text-textcolor';
	const chromeFgMuted = theater ? 'text-white/50' : 'text-textcolor/50';

	const shell = (
		<div
			ref={videoShellRef}
			className={cn(
				/* 勿 contain：paint/layout 都可能影响同壳内 video 的 backdrop 采样 */
				'relative flex h-full w-full justify-center overflow-hidden rounded-md text-center bg-theme-background',
				'[:fullscreen]:fixed [:fullscreen]:inset-0 [:fullscreen]:z-9999 [:fullscreen]:h-screen [:fullscreen]:w-screen [:fullscreen]:rounded-none [:fullscreen]:bg-black',
				'[&:-webkit-full-screen]:fixed [&:-webkit-full-screen]:inset-0 [&:-webkit-full-screen]:z-9999 [&:-webkit-full-screen]:h-screen [&:-webkit-full-screen]:w-screen [&:-webkit-full-screen]:rounded-none [&:-webkit-full-screen]:bg-black',
				'[&.vp-css-fullscreen]:fixed [&.vp-css-fullscreen]:inset-0 [&.vp-css-fullscreen]:z-9999 [&.vp-css-fullscreen]:h-screen [&.vp-css-fullscreen]:w-screen [&.vp-css-fullscreen]:rounded-none [&.vp-css-fullscreen]:bg-black',
				/* 藏 xgplayer 原生 UI（挂在 shell，避免 #vp-player 被改 class 后失效） */
				'[&_.xgplayer-controls]:hidden! [&_.xgplayer-replay]:hidden! [&_.xgplayer-start]:hidden! [&_xg-start]:hidden!',
				'[&_.xg-spot-info]:hidden! [&_.xgplayer-progress-point]:hidden!',
				/* xgplayer 默认 background:#000，会盖掉主题底；非影院态强制跟 theme */
				!theater &&
					'[&_.xgplayer]:bg-theme-background! [&_video]:bg-theme-background!',
				theater && 'bg-black [&_.xgplayer]:bg-black! [&_video]:bg-black!',
				theater && 'rounded-none',
				chromeHidden && 'cursor-none',
				embedded && className,
			)}
			onMouseMove={onPlayerMouseMove}
			onMouseEnter={onPlayerMouseEnter}
			onMouseLeave={onPlayerMouseLeave}
			onClick={onShellClick}
		>
			{/* xgplayer 独占此节点 */}
			<div
				ref={playerContainerRef}
				id="vp-player"
				className={cn(
					'box-border flex h-full! w-full items-center justify-center overflow-hidden rounded-b-md bg-theme-background',
					'[&_.xgplayer]:h-full! [&_.xgplayer]:w-full!',
					'[&_.xgplayer-video]:h-full! [&_.xgplayer-video]:w-full!',
					'[&_video]:box-border [&_video]:h-full [&_video]:w-full [&_video]:rounded-md [&_video]:object-contain',
					theater && 'rounded-none bg-black',
				)}
			/>

			{/* 离屏 seek 解码，勿放进进度条 DOM（video 合成层会糊住轨道） */}
			<video
				ref={previewVideoRef}
				src={currentUrl || undefined}
				muted
				playsInline
				preload="auto"
				tabIndex={-1}
				aria-hidden
				className="pointer-events-none absolute top-0 left-0 -z-10 h-px w-px opacity-0"
				onSeeked={onPreviewSeeked}
				onLoadedData={() => {
					previewSeekingRef.current = false;
				}}
			/>

			{isPip ? (
				<div className="pointer-events-none absolute inset-0 z-5 flex flex-col items-center justify-center gap-3 bg-theme-background text-textcolor">
					<PictureInPicture2 size={56} strokeWidth={1.25} />
					<p className="px-4 text-center text-sm">
						{t('videoPlayer.pipPlaying')}
					</p>
				</div>
			) : null}

			{currentVideoName ? (
				<div
					className={cn(
						'pointer-events-none absolute top-0 left-0 z-2 box-border w-full overflow-hidden p-[9px_10px_0] text-left text-base text-ellipsis whitespace-nowrap',
						chromeFg,
						chromeHidden && 'pointer-events-none opacity-0!',
					)}
				>
					{currentVideoName}
				</div>
			) : null}

			{!playStatus ? (
				<div
					className="absolute right-25 bottom-30 z-2 cursor-pointer text-teal-500 transition-opacity duration-300 ease-in-out"
					onClick={(e) => {
						e.stopPropagation();
						onPlay();
					}}
				>
					<Play size={80} fill="currentColor" />
				</div>
			) : null}

			<div
				ref={controlsRef}
				className={cn(
					'absolute bottom-0 left-0 z-3 box-border flex w-full flex-col overflow-visible rounded-b-[5px] bg-transparent pt-2.5 pr-2.5 pb-0 pl-2.5 has-[[data-vp=progress]:hover]:*:data-[vp=bar-bg]:top-[-20px]',
					/* 勿用父级 opacity 显隐：会建立 backdrop root，子级 backdrop-filter 采不到背后 video */
					chromeOn ? 'visible' : 'invisible',
					chromeHidden && 'pointer-events-none invisible!',
					theater && 'rounded-none',
				)}
				onClick={(e) => e.stopPropagation()}
				onMouseEnter={onControlsBarEnter}
				onMouseLeave={onControlsBarLeave}
			>
				<div
					data-vp="bar-bg"
					className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-0 rounded-[inherit] bg-theme/5 backdrop-blur-sm transition-[top] duration-300 ease-in-out"
					aria-hidden
				/>
				<div
					data-vp="progress"
					className="group/progress relative z-1 box-border h-2 min-h-2 w-full shrink-0 rounded-md"
				>
					{/* 交互热区恒为展开高度；可视轨道仍 8px→28px，避免边缘 hover 跳动 */}
					<div
						ref={durationRef}
						className="absolute right-0 bottom-0 left-0 z-1 h-7 cursor-pointer"
						onMouseEnter={onProgressHover}
						onMouseMove={onProgressHover}
						onMouseLeave={onProgressLeave}
						onClick={onDurationClick}
					>
						<div
							className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 rounded-sm bg-teal-500/15 border border-teal-500/5 transition-[height,border-radius] duration-300 ease-in-out group-hover/progress:h-7 group-hover/progress:rounded-none"
							aria-hidden
						/>
						{existDuration ? (
							<div
								ref={timeTipRef}
								className={cn(
									'pointer-events-none absolute bottom-9 z-20 -translate-x-1/2',
									previewOn ? 'visible' : 'invisible',
								)}
							>
								{/* 预览在上，左右单独夹紧；pop 仍跟鼠标贴两端 */}
								<div
									ref={previewBoxRef}
									className="absolute bottom-full left-1/2 mb-1 overflow-hidden rounded-md border border-teal-500/10 bg-teal-500/10 shadow-md"
									style={{ width: 160, transform: 'translateX(-50%)' }}
								>
									<canvas
										ref={previewCanvasRef}
										width={160}
										height={90}
										className="block h-[90px] w-[160px] bg-theme-background"
									/>
								</div>
								<div className='relative rounded-[3px] bg-teal-500 px-1.5 py-0.5 text-xs whitespace-nowrap text-white select-none after:absolute after:top-full after:left-1/2 after:h-0 after:w-0 after:-translate-x-1/2 after:border-x-7 after:border-t-7 after:border-x-transparent after:border-t-teal-500 after:content-[""]'>
									{hoverTime || '00:00'}
								</div>
							</div>
						) : null}
						<div
							ref={currentTimeRef}
							className="pointer-events-none absolute bottom-0 left-0 h-1.5 w-0 rounded-[3px] bg-teal-500 transition-[height,border-radius] duration-300 ease-in-out group-hover/progress:h-7 group-hover/progress:rounded-none"
						>
							{existDuration ? (
								<div
									ref={timePointRef}
									className="absolute top-1/2 right-[-5px] z-999 box-border h-[calc(100%+6px)] w-2.5 -translate-y-1/2 cursor-grab rounded-[2px] border border-theme/10 bg-teal-500 opacity-0 shadow-[0_0_2px_rgba(0,0,0,0.3)] transition-opacity duration-200 ease-in-out pointer-events-auto active:cursor-grabbing group-hover/progress:opacity-100"
									onMouseDown={onTimePointDragStart}
								/>
							) : null}
						</div>
						{rulerCount > 0 && existDuration ? (
							<div className="pointer-events-none absolute bottom-0 left-0 flex h-2.5 w-full items-end justify-between border-b border-teal-500 opacity-0 transition-opacity duration-300 ease-in-out group-hover/progress:opacity-100">
								{Array.from({ length: rulerCount }).map((_, i) => (
									<div
										key={i}
										className={cn(
											'h-[5px] w-px rounded-[5px] bg-teal-500',
											(i + 1) % 5 === 0 && 'h-2',
										)}
									/>
								))}
							</div>
						) : null}
					</div>
				</div>

				<div className="relative z-1 my-[15px] flex items-end justify-between">
					<div className={cn('flex items-center', chromeFg)}>
						<div
							className={cn(
								'flex cursor-pointer items-center hover:text-teal-500',
								chromeFg,
								safeIndex === 0 &&
									playType !== 'loop' &&
									cn('pointer-events-none cursor-not-allowed', chromeFgMuted),
							)}
							onClick={onPrev}
						>
							<SkipBack size={CTRL_ICON} />
						</div>
						<div
							className={cn(
								'mx-3 flex cursor-pointer items-center hover:text-teal-500',
								chromeFg,
							)}
						>
							{!playStatus ? (
								<Play size={CTRL_ICON} onClick={onPlay} />
							) : (
								<Pause size={CTRL_ICON} onClick={onPause} />
							)}
						</div>
						<div
							className={cn(
								'mr-5 flex cursor-pointer items-center hover:text-teal-500',
								chromeFg,
								safeIndex === videos.length - 1 &&
									playType !== 'loop' &&
									cn('pointer-events-none cursor-not-allowed', chromeFgMuted),
							)}
							onClick={onNext}
						>
							<SkipForward size={CTRL_ICON} />
						</div>
						<div className="m-0 flex items-center text-sm leading-none">
							{existDuration ? timeInfo : timeInfo.split('/')[0]}
						</div>
					</div>

					<div className="flex items-center gap-[15px]">
						{onAdd ? (
							<Tip label={t('videoPlayer.continueSelect')}>
								<div
									className={cn(
										'flex cursor-pointer items-center justify-center hover:text-teal-500',
										chromeFg,
									)}
									onClick={onAdd}
								>
									<FolderPlus size={CTRL_ICON} />
								</div>
							</Tip>
						) : null}
						{onClear ? (
							<Tip label={t('videoPlayer.reset')}>
								<div
									className={cn(
										'flex cursor-pointer items-center justify-center hover:text-teal-500',
										chromeFg,
									)}
									onClick={onReset}
								>
									<ListRestart size={CTRL_ICON} />
								</div>
							</Tip>
						) : null}

						{videos.length > 1 ? (
							<HoverPopover
								align="center"
								width={320}
								contentPadding={0}
								contentClassName="overflow-hidden p-0!"
								onOpenChange={onControlsPopoverOpenChange}
								onContentPointer={bumpChrome}
								trigger={
									<div
										className={cn(
											'flex cursor-pointer items-center justify-center hover:text-teal-500',
											chromeFg,
										)}
										onClick={(e) => {
											e.stopPropagation();
										}}
									>
										<ListVideo size={CTRL_ICON} />
									</div>
								}
							>
								{({ close }) => (
									<div className="flex max-w-full min-w-0 flex-col overflow-hidden">
										<div className="h-10 shrink-0 border-b border-theme/15 px-4 py-2.5 text-sm leading-[1.2] font-semibold">
											{t('videoPlayer.episodes')}
										</div>
										<ScrollArea
											type="always"
											className="h-75 max-h-75 w-full max-w-full min-w-0"
											style={{ height: 300 }}
											viewportClassName="[&>div]:block! [&>div]:h-auto! [&>div]:min-h-0! [&>div]:min-w-0! [&>div]:max-w-full! [&>div]:w-full!"
											onWheel={(e) => e.stopPropagation()}
										>
											<div className="box-border max-w-full min-w-0 overflow-x-hidden p-2">
												{videos.map((item, index) => (
													<div
														key={item.url}
														className={cn(
															'cursor-pointer truncate rounded-md p-2 text-sm text-textcolor/80 hover:bg-theme/15',
															safeIndex === index && 'text-teal-500',
														)}
														onClick={() => {
															onCheckUrl(item, index);
															close();
														}}
													>
														{item.name}
													</div>
												))}
											</div>
										</ScrollArea>
									</div>
								)}
							</HoverPopover>
						) : null}

						<HoverPopover
							align="center"
							width={320}
							contentPadding={0}
							contentClassName="overflow-visible backdrop-blur-[2px]"
							onOpenChange={onControlsPopoverOpenChange}
							onContentPointer={bumpChrome}
							trigger={
								<div
									className={cn(
										'flex min-w-7.5 cursor-pointer items-center justify-center text-center text-[15px] leading-4.5 hover:text-teal-500',
										chromeFg,
									)}
									onClick={(e) => {
										e.stopPropagation();
									}}
								>
									{playbackRate.toFixed(1)}x
								</div>
							}
						>
							<RatePanel
								rate={playbackRate}
								onRateChange={onChangePlaybackRate}
								label={t('videoPlayer.speed')}
							/>
						</HoverPopover>

						<HoverPopover
							align="center"
							width={40}
							contentPadding={10}
							onOpenChange={onControlsPopoverOpenChange}
							onContentPointer={bumpChrome}
							trigger={
								<div
									className={cn(
										'flex cursor-pointer items-center justify-center hover:text-teal-500',
										chromeFg,
									)}
									onClick={(e) => {
										e.stopPropagation();
										onVolumeChange();
									}}
								>
									<Volume volume={volume} />
								</div>
							}
						>
							<div className="flex w-full flex-col items-center gap-2">
								<div
									className="text-center text-sm text-textcolor"
									onClick={onVolumeChange}
									title={t('videoPlayer.muted')}
								>
									{(volume * 100).toFixed(0)}
								</div>
								<div
									ref={volumeSliderRef}
									className="relative h-24 w-5 shrink-0 cursor-pointer touch-none outline-none"
									role="slider"
									tabIndex={0}
									aria-orientation="vertical"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={Math.round(volume * 100)}
									aria-valuetext={`${(volume * 100).toFixed(0)}%`}
									onPointerDown={onVolumePointerDown}
									onPointerMove={onVolumePointerMove}
									onKeyDown={(e) => {
										if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
											e.preventDefault();
											setVolume((v) => Math.min(1, v + 0.05));
										} else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
											e.preventDefault();
											setVolume((v) => Math.max(0, v - 0.05));
										}
									}}
								>
									<div className="pointer-events-none absolute top-0 bottom-0 left-1/2 w-1 -translate-x-1/2 rounded-sm bg-teal-300/30">
										<div
											className="absolute right-0 bottom-0 left-0 rounded-sm bg-teal-500"
											style={{ height: `${volume * 100}%` }}
										/>
										<div
											className="pointer-events-none absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-teal-500 shadow-sm"
											style={{ bottom: `${volume * 100}%` }}
										/>
									</div>
								</div>
							</div>
						</HoverPopover>

						<HoverPopover
							align="center"
							width={280}
							onOpenChange={onControlsPopoverOpenChange}
							onContentPointer={bumpChrome}
							trigger={
								<div
									className={cn(
										'flex cursor-pointer items-center justify-center hover:text-teal-500',
										chromeFg,
									)}
									onClick={(e) => {
										e.stopPropagation();
									}}
								>
									<Settings size={CTRL_ICON} />
								</div>
							}
						>
							<div className="rounded-md">
								<div className="mb-4 flex w-full flex-col items-start">
									<div className="mb-1.5 text-sm text-textcolor/80">
										{t('videoPlayer.playMode')}
									</div>
									<Segmented
										value={playType}
										options={PLAY_OPTIONS.map((o) => ({
											value: o.value,
											label: t(o.labelKey),
										}))}
										onChange={(v) => setPlayType(v)}
									/>
								</div>
								<div className="mb-1.5 flex w-full flex-col items-start">
									<div className="mb-1.5 text-sm text-textcolor/80">
										{t('videoPlayer.screenMirror')}
									</div>
									<Segmented
										value={screenType}
										options={SCREEN_TYPE.map((o) => ({
											value: o.value,
											label: t(o.labelKey),
										}))}
										onChange={(v) => setScreenType(v)}
									/>
								</div>
							</div>
						</HoverPopover>

						<Tip label={t('videoPlayer.pip')}>
							<div
								className={cn(
									'flex cursor-pointer items-center justify-center hover:text-teal-500',
									chromeFg,
								)}
								onClick={onPictureToPicture}
							>
								<PictureInPicture2 size={CTRL_ICON} />
							</div>
						</Tip>
						<Tip
							label={
								isFullscreen
									? t('videoPlayer.exitFullscreen')
									: t('videoPlayer.fullscreen')
							}
						>
							<div
								className={cn(
									'-mt-0.5 flex cursor-pointer items-center justify-center hover:text-teal-500',
									chromeFg,
								)}
								onClick={onFull}
							>
								{isFullscreen ? (
									<Minimize size={CTRL_ICON} />
								) : (
									<Maximize size={CTRL_ICON} />
								)}
							</div>
						</Tip>
					</div>
				</div>
			</div>

			<div
				ref={miniTimelineRef}
				className={cn(
					'absolute bottom-0 left-0 z-2 h-0.5 rounded-[5px] bg-teal-500 transition-opacity duration-300 ease-in-out',
					chromeHidden ? 'opacity-100' : 'opacity-0!',
				)}
			/>

			<div
				ref={volumeTipRef}
				className="absolute bottom-35 left-26 z-2 flex items-center gap-2 rounded-md bg-teal-500 px-2.5 py-1.5 text-xl font-bold text-white opacity-0 transition-opacity duration-300"
			>
				<Volume volume={volume} />
				<span>
					{volume > 0
						? `${(volume * 100).toFixed(0)}%`
						: t('videoPlayer.muted')}
				</span>
			</div>
		</div>
	);

	return embedded ? (
		shell
	) : (
		<div
			className={cn(
				'relative box-border h-full w-full select-none rounded-md [-webkit-user-select:none]',
				className,
			)}
		>
			<div className="relative box-border h-full rounded-md p-0 text-center">
				{shell}
			</div>
		</div>
	);
}
