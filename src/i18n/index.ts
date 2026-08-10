import enUS from './locales/en-US';
import zhCN from './locales/zh-CN';
import {
	DEFAULT_LOCALE,
	isLocale,
	type Locale,
	SUPPORTED_LOCALES,
} from './types';

export type { Locale };
export { DEFAULT_LOCALE, isLocale, SUPPORTED_LOCALES };

export const DICTS: Record<Locale, Record<string, string>> = {
	'zh-CN': zhCN,
	'en-US': enUS,
};

/** 与 Host 隔离，避免 MF 同页抢写 dnhyxc_locale_bootstrap */
export const LOCALE_BOOTSTRAP_STORAGE_KEY = 'remote_plugins_locale_bootstrap';
const LOCALE_RUNTIME_KEY = '__remote_plugins_locale_runtime__';

type LocaleRuntime = {
	locale: Locale;
	listeners: Set<() => void>;
};

function getLocaleRuntime(): LocaleRuntime {
	const g = globalThis as typeof globalThis & {
		[LOCALE_RUNTIME_KEY]?: LocaleRuntime;
	};
	if (!g[LOCALE_RUNTIME_KEY]) {
		g[LOCALE_RUNTIME_KEY] = {
			locale: readLocaleBootstrapSync() ?? DEFAULT_LOCALE,
			listeners: new Set(),
		};
	}
	return g[LOCALE_RUNTIME_KEY];
}

function readLocaleBootstrapSync(): Locale | null {
	if (typeof window === 'undefined') return null;
	try {
		const params = new URLSearchParams(window.location.search);
		const fromUrl = params.get('lang') || params.get('locale');
		if (isLocale(fromUrl)) return fromUrl;
		const b = localStorage.getItem(LOCALE_BOOTSTRAP_STORAGE_KEY);
		return isLocale(b) ? b : null;
	} catch {
		return null;
	}
}

function persistLocaleBootstrap(locale: Locale) {
	try {
		localStorage.setItem(LOCALE_BOOTSTRAP_STORAGE_KEY, locale);
	} catch {
		/* ignore */
	}
}

function applyLangToDocument(locale: Locale) {
	try {
		document.documentElement.lang = locale;
	} catch {
		/* ignore */
	}
}

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

export function getActiveLocale(): Locale {
	const runtime = getLocaleRuntime();
	if (SUPPORTED_LOCALES.includes(runtime.locale)) return runtime.locale;
	return DEFAULT_LOCALE;
}

export function translateSync(
	key: string,
	params?: Record<string, unknown>,
): string {
	const locale = getActiveLocale();
	const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
	const raw = dict[key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
	return interpolate(raw, params);
}

export function subscribeLocale(listener: () => void) {
	const { listeners } = getLocaleRuntime();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function getLocaleSnapshot(): Locale {
	return getLocaleRuntime().locale;
}

export type SetLocaleOptions = {
	/** 独立预览写 URL；插件跟随 Host 时关掉 */
	syncUrl?: boolean;
	/** 独立预览持久化；插件跟随 Host 时关掉 */
	persist?: boolean;
};

export function setLocaleGlobal(next: Locale, opts?: SetLocaleOptions): void {
	if (!SUPPORTED_LOCALES.includes(next)) return;
	const runtime = getLocaleRuntime();
	if (next === runtime.locale) return;
	runtime.locale = next;
	applyLangToDocument(next);
	if (opts?.persist !== false) persistLocaleBootstrap(next);

	if (opts?.syncUrl !== false && typeof window !== 'undefined') {
		try {
			const u = new URL(window.location.href);
			u.searchParams.set('lang', next);
			window.history.replaceState(null, '', u.toString());
		} catch {
			/* ignore */
		}
	}

	for (const l of runtime.listeners) l();
}

export function applyHostLocale(locale: Locale): void {
	// 插件模式：只跟 Host，不写自己的 bootstrap / URL
	setLocaleGlobal(locale, { syncUrl: false, persist: false });
}
