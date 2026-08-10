export { default, default as VideoPlayer } from './player';
export type { PlayType, ScreenType, VideoItem, VideoUrlList } from './tools';
export {
	appendVideoFiles,
	enterFullscreen,
	exitFullscreen,
	formatTime,
	getFullscreenElement,
	LIMIT,
	PLAY_OPTIONS,
	revokeVideoUrls,
	SCREEN_TYPE,
	setDocumentAppFullscreen,
} from './tools';
export type {
	VideoPlayerHostUi,
	VideoPlayerProps,
} from './types';
