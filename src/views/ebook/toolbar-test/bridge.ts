import type { Locale } from '@/i18n';

/** 测试用 ebook Host API 子集 */
export type EbookTestModules = {
	getBookId: () => string | null;
	getBookTitle: () => string | null;
	navigateToCfi: (cfi: string) => void | Promise<void>;
	openThought: (thought: unknown) => void;
	closeIdeasList?: () => void;
};

export type EbookTestBridgeProps = {
	api: {
		theme: 'light' | 'dark';
		locale?: Locale;
		event: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		ui?: {
			showToast: (options: {
				message: string;
				type?: 'success' | 'error' | 'info';
			}) => void;
		};
		modules?: Readonly<Record<string, unknown>>;
	};
	plugin: { id: string; version: string; routePath: string };
	independent?: boolean;
};

export function readEbookModules(
	api: EbookTestBridgeProps['api'],
): EbookTestModules | undefined {
	return api.modules?.ebook as EbookTestModules | undefined;
}
