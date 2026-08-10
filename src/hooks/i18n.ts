import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
	DEFAULT_LOCALE,
	DICTS,
	getLocaleSnapshot,
	isLocale,
	type Locale,
	type SetLocaleOptions,
	SUPPORTED_LOCALES,
	setLocaleGlobal,
	subscribeLocale,
	translateSync,
} from '@/i18n';

const LOCALE_INIT_KEY = '__remote_plugins_locale_init_done__';

function interpolate(
	template: string,
	params?: Record<string, unknown>,
): string {
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (full, k) => {
		const v = params[k];
		return v == null ? full : String(v);
	});
}

export function useI18n() {
	const locale = useSyncExternalStore(
		subscribeLocale,
		getLocaleSnapshot,
		() => DEFAULT_LOCALE,
	);

	useEffect(() => {
		const g = globalThis as typeof globalThis & {
			[LOCALE_INIT_KEY]?: boolean;
		};
		if (g[LOCALE_INIT_KEY]) return;
		g[LOCALE_INIT_KEY] = true;

		// 独立预览：读 URL / bootstrap；插件模式随后会被 applyHostLocale 覆盖
		const params = new URLSearchParams(window.location.search);
		const fromUrl = params.get('lang') || params.get('locale');
		if (isLocale(fromUrl)) {
			setLocaleGlobal(fromUrl, { syncUrl: false });
		}
	}, []);

	const dict = useMemo(() => DICTS[locale] ?? DICTS[DEFAULT_LOCALE], [locale]);
	const fallbackDict = DICTS[DEFAULT_LOCALE];

	const t = useMemo(() => {
		return (key: string, params?: Record<string, unknown>) => {
			const raw = dict[key] ?? fallbackDict[key];
			if (!raw) return key;
			return interpolate(raw, params);
		};
	}, [dict, fallbackDict]);

	const setLocale = (next: Locale, opts?: SetLocaleOptions) => {
		setLocaleGlobal(next, opts);
	};

	const toggleLocale = () => {
		setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN');
	};

	return {
		locale,
		setLocale,
		toggleLocale,
		t,
		supportedLocales: SUPPORTED_LOCALES,
		translateSync,
	};
}
