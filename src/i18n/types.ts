export type Locale = 'zh-CN' | 'en-US';

export const DEFAULT_LOCALE: Locale = 'zh-CN';

export const SUPPORTED_LOCALES: Locale[] = ['zh-CN', 'en-US'];

export function isLocale(v: unknown): v is Locale {
	return v === 'zh-CN' || v === 'en-US';
}
