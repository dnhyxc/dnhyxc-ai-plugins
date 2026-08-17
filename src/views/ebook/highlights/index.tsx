import Loading from '@design/Loading';
import { Button, ScrollArea } from '@ui/index';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostLocale, useI18n } from '@/hooks';
import type { Locale } from '@/i18n';
import { cn } from '@/lib/utils';
import '@/styles.css';

const PAGE_SIZE = 50;

type Highlight = {
	id: string;
	userId: number;
	cfiRange: string;
	quote: string;
	style: 'highlight' | 'underline' | 'wavy' | string;
	color: string;
	createdAt?: string;
	updatedAt?: string;
};

type EbookModules = {
	getBookId: () => string | null;
	getBookTitle: () => string | null;
	navigateToCfi: (cfi: string) => void | Promise<void>;
	closeIdeasList?: () => void;
};

type HostBridgeProps = {
	api: {
		theme: 'light' | 'dark';
		locale?: Locale;
		event: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		http?: {
			get: <T = unknown>(url: string) => Promise<T>;
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

type HighlightPage = {
	list: Highlight[];
	total: number;
	pageNo: number;
	pageSize: number;
};

function unwrapPage(res: unknown): HighlightPage {
	const body =
		res && typeof res === 'object' && 'data' in res
			? (res as { data: unknown }).data
			: res;
	if (
		body &&
		typeof body === 'object' &&
		Array.isArray((body as HighlightPage).list)
	) {
		const page = body as HighlightPage;
		return {
			list: page.list,
			total: Number(page.total) || 0,
			pageNo: Number(page.pageNo) || 1,
			pageSize: Number(page.pageSize) || PAGE_SIZE,
		};
	}
	return { list: [], total: 0, pageNo: 1, pageSize: PAGE_SIZE };
}

function formatTime(iso: string | undefined, locale: Locale): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleString(locale);
}

function styleLabel(style: string, t: (key: string) => string): string {
	if (style === 'underline') return t('highlightsList.style.underline');
	if (style === 'wavy') return t('highlightsList.style.wavy');
	return t('highlightsList.style.highlight');
}

/** 全书划线：分页滚动加载当前用户在本书的全部划线 */
function EbookHighlightsApp({ api }: HostBridgeProps) {
	const { t, locale } = useI18n();
	useHostLocale(api);

	const ebook = api.modules?.ebook as EbookModules | undefined;
	const bookId = ebook?.getBookId() ?? null;
	const bookTitle = ebook?.getBookTitle() ?? null;
	const [items, setItems] = useState<Highlight[]>([]);
	const [pageNo, setPageNo] = useState(0);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const inflightRef = useRef(false);

	const hasMore = items.length < total;

	const fetchPage = useCallback(
		async (nextPage: number, append: boolean) => {
			if (!bookId || !api.http || inflightRef.current) return;
			inflightRef.current = true;
			if (append) setLoadingMore(true);
			else {
				setLoading(true);
				setError(null);
			}
			try {
				const res = await api.http.get(
					`/ebook/highlights/${bookId}?pageNo=${nextPage}&pageSize=${PAGE_SIZE}`,
				);
				const page = unwrapPage(res);
				setTotal(page.total);
				setPageNo(page.pageNo);
				setItems((prev) => {
					if (!append) return page.list;
					const seen = new Set(prev.map((h) => h.id));
					const extra = page.list.filter((h) => !seen.has(h.id));
					return [...prev, ...extra];
				});
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				if (!append) {
					setError(message);
					setItems([]);
					setTotal(0);
					setPageNo(0);
				} else {
					api.ui?.showToast({ message, type: 'error' });
				}
			} finally {
				inflightRef.current = false;
				setLoading(false);
				setLoadingMore(false);
			}
		},
		[api.http, api.ui, bookId],
	);

	useEffect(() => {
		if (!bookId || !api.http) {
			setItems([]);
			setTotal(0);
			setPageNo(0);
			setError(bookId ? null : t('highlightsList.unboundBook'));
			return;
		}
		void fetchPage(1, false);
	}, [api.http, bookId, fetchPage, t]);

	useEffect(() => {
		const root = viewportRef.current;
		const target = sentinelRef.current;
		if (!root || !target || !hasMore || loading || loadingMore) return;

		const io = new IntersectionObserver(
			(entries) => {
				if (!entries[0]?.isIntersecting) return;
				void fetchPage(pageNo + 1, true);
			},
			{ root, rootMargin: '120px 0px', threshold: 0 },
		);
		io.observe(target);
		return () => io.disconnect();
	}, [fetchPage, hasMore, loading, loadingMore, pageNo]);

	const onOpen = (row: Highlight) => {
		const cfi = row.cfiRange?.trim();
		if (cfi) void ebook?.navigateToCfi(cfi);
		ebook?.closeIdeasList?.();
	};

	return (
		<div className="text-textcolor flex h-full min-h-0 flex-col text-sm">
			{bookTitle && !loading ? (
				<div className="text-textcolor/55 border-theme/10 mb-1 shrink-0 border-b px-3.5 pb-2.5 text-xs">
					{bookTitle}
					{total > 0 ? (
						<span className="text-textcolor/40 ml-2">
							{t('common.loadedCount', {
								loaded: items.length,
								total,
							})}
						</span>
					) : null}
				</div>
			) : null}

			{loading ? (
				<Loading className="h-full" />
			) : (
				<ScrollArea
					ref={viewportRef}
					className="box-border flex min-h-0 flex-1 flex-col px-1.5"
				>
					{error ? (
						<p className="text-textcolor px-2 py-2">{error}</p>
					) : items.length === 0 ? (
						<p className="text-textcolor/55 px-2 py-4 text-center">
							{t('highlightsList.empty')}
						</p>
					) : (
						<div className="flex min-h-0 w-full flex-1 flex-col gap-1">
							{items.map((row) => (
								<div key={row.id}>
									<Button
										type="button"
										variant="ghost"
										onClick={() => onOpen(row)}
										className={cn(
											'h-auto w-full flex-col items-stretch gap-0 rounded-md px-2 py-2 text-left font-normal whitespace-normal',
											'hover:bg-theme/10',
										)}
									>
										<p className="mb-1.5 flex items-start gap-1 text-justify text-sm text-textcolor line-clamp-3">
											{row.quote?.trim() || t('highlightsList.noQuote')}
										</p>
										<p className="text-textcolor/50 text-left text-xs">
											{[
												styleLabel(row.style, t),
												formatTime(row.createdAt, locale),
											]
												.filter(Boolean)
												.join(' · ')}
										</p>
									</Button>
								</div>
							))}
							<div ref={sentinelRef} className="h-1 w-full" aria-hidden />
							{loadingMore ? (
								<p className="text-textcolor/45 pb-3 text-center text-xs">
									{t('common.loadingMore')}
								</p>
							) : null}
							{!hasMore && items.length > 0 ? (
								<p className="text-textcolor/35 pb-3 text-center text-xs">
									{t('common.noMore')}
								</p>
							) : null}
						</div>
					)}
				</ScrollArea>
			)}
		</div>
	);
}

EbookHighlightsApp.activate = async (api: HostBridgeProps['api']) => {
	console.log('[ebook-highlights] activate', api);
};

EbookHighlightsApp.deactivate = () => {
	console.log('[ebook-highlights] deactivate');
};

export default EbookHighlightsApp;
