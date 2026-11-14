import type { EbookTestBridgeProps } from './bridge';

/** Host 经 eventBus 推 locale；订阅须在 deactivate 卸掉 */
let offLocale: (() => void) | undefined;

export async function activate(api: EbookTestBridgeProps['api']) {
	console.log('activate ebookTestBookInfo');

	const onLocale = (data?: unknown) => {
		console.info('[ebookTestBookInfo] locale', data);
	};

	api.event.on('locale', onLocale);

	offLocale = () => api.event.off('locale', onLocale);

	// const bookId = (api.modules?.point as { getContext?: () => { bookId?: string } | null } | undefined)?.getContext?.()?.bookId;
	// api.ui?.showToast({
	// 	type: 'info',
	// 	message: bookId
	// 		? `ebookTestBookInfo activated · ${bookId}`
	// 		: 'ebookTestBookInfo activated',
	// });
}

export async function deactivate() {
	console.log('deactivate ebookTestBookInfo');
	offLocale?.();
	offLocale = undefined;
}
