import { useEffect } from 'react';
import { applyHostLocale, isLocale, type Locale } from '@/i18n';

type HostLocaleApi = {
	locale?: Locale;
	event?: {
		on: (event: string, handler: (data?: unknown) => void) => void;
		off: (event: string, handler: (data?: unknown) => void) => void;
	};
};

/**
 * 插件模式：跟随 Host 的 locale（bridge 快照 + event('locale')）。
 * 独立预览不传 locale 时无操作。
 */
export function useHostLocale(api?: HostLocaleApi) {
	useEffect(() => {
		if (isLocale(api?.locale)) {
			applyHostLocale(api.locale);
		}
	}, [api?.locale]);

	useEffect(() => {
		const event = api?.event;
		if (!event) return;
		const onLocale = (data?: unknown) => {
			if (isLocale(data)) applyHostLocale(data);
		};
		event.on('locale', onLocale);
		return () => event.off('locale', onLocale);
	}, [api?.event]);
}
