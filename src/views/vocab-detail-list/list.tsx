import Loading from '@design/Loading';
import { Button, ScrollArea } from '@ui/index';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostLocale, useI18n } from '@/hooks';
import {
	libraryIdFromContext,
	type PointModule,
} from '@/views/vocab-detail/point';

type ListItem = {
	lemma: string;
	glossZh: string;
	updatedAt: string;
};

type ListPage = {
	items: ListItem[];
	nextCursor: string | null;
	total: number;
};

type HostApi = {
	locale?: 'zh-CN' | 'en-US';
	http?: { get: (url: string) => Promise<unknown> };
	ui?: {
		showToast: (options: {
			message: string;
			type?: 'success' | 'error' | 'info';
		}) => void;
	};
	modules?: { point?: PointModule };
};

function unwrap(res: unknown): ListPage {
	const body =
		res && typeof res === 'object' && 'data' in res
			? (res as { data: unknown }).data
			: res;
	if (!body || typeof body !== 'object') {
		return { items: [], nextCursor: null, total: 0 };
	}
	const page = body as {
		items?: unknown;
		nextCursor?: unknown;
		total?: unknown;
	};
	const items = Array.isArray(page.items)
		? page.items.flatMap((row) => {
				if (!row || typeof row !== 'object') return [];
				const item = row as {
					lemma?: unknown;
					glossZh?: unknown;
					updatedAt?: unknown;
				};
				if (typeof item.lemma !== 'string' || !item.lemma) return [];
				return [
					{
						lemma: item.lemma,
						glossZh: typeof item.glossZh === 'string' ? item.glossZh : '',
						updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
					},
				];
			})
		: [];
	const total = Number(page.total);
	return {
		items,
		nextCursor: typeof page.nextCursor === 'string' ? page.nextCursor : null,
		total: Number.isFinite(total) ? total : items.length,
	};
}

export default function VocabDetailList({ api }: { api: HostApi }) {
	const { t, locale } = useI18n();
	useHostLocale(api);
	const [items, setItems] = useState<ListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const cursorRef = useRef<string | null | undefined>(undefined);
	const loadingRef = useRef(false);
	const holdRef = useRef(false);
	const viewportRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);
	const loadedRef = useRef(0);
	const libraryRef = useRef('');
	const genRef = useRef(0);
	const [reading, setReading] = useState(false);

	const loadPage = useCallback(async () => {
		const libraryId = libraryRef.current;
		const reading = libraryId === 'dailyReading';
		if (
			!libraryId ||
			loadingRef.current ||
			holdRef.current ||
			cursorRef.current === null
		) {
			return;
		}
		if (!api.http) {
			setLoading(false);
			setFailed(true);
			return;
		}
		loadingRef.current = true;
		setLoading(true);
		const gen = genRef.current;
		const cursor = cursorRef.current;
		const url = reading
			? `/english-learning/vocab-detail/list?scope=dailyReading${
					cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
				}`
			: `/english-learning/vocab-detail/list?libraryId=${encodeURIComponent(libraryId)}${
					cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
				}`;
		try {
			const page = unwrap(await api.http.get(url));
			if (gen !== genRef.current) return;
			cursorRef.current = page.nextCursor;
			loadedRef.current += page.items.length;
			setItems((prev) => [...prev, ...page.items]);
			api.modules?.point?.publishSignal('stats', {
				total: page.total,
				loaded: loadedRef.current,
			});
			setFailed(false);
		} catch {
			if (gen !== genRef.current) return;
			holdRef.current = true;
			setFailed(true);
		} finally {
			if (gen === genRef.current) {
				loadingRef.current = false;
				setLoading(false);
			}
		}
	}, [api.http, api.modules]);

	useEffect(() => {
		const point = api.modules?.point;
		const apply = () => {
			const payload = point?.getPayload('drawer');
			const next =
				payload?.scope === 'dailyReading'
					? 'dailyReading'
					: libraryIdFromContext(point?.getContext());
			if (next === libraryRef.current && cursorRef.current !== undefined)
				return;
			libraryRef.current = next;
			setReading(next === 'dailyReading');
			cursorRef.current = undefined;
			holdRef.current = false;
			loadingRef.current = false;
			loadedRef.current = 0;
			genRef.current += 1;
			setItems([]);
			setFailed(false);
			point?.publishSignal('stats', { total: 0, loaded: 0 });
			if (!next) return setLoading(false);
			void loadPage();
		};
		apply();
		return point?.subscribe(apply);
	}, [api.modules, loadPage]);

	useEffect(() => {
		const root = viewportRef.current;
		const target = sentinelRef.current;
		if (!root || !target || failed || cursorRef.current === null) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries[0]?.isIntersecting) return;
				void loadPage();
			},
			{ root, rootMargin: '120px 0px', threshold: 0 },
		);
		io.observe(target);
		return () => io.disconnect();
	}, [failed, items.length, loadPage, loading]);

	const retry = () => {
		holdRef.current = false;
		setFailed(false);
		void loadPage();
	};

	const onPick = (lemma: string) => {
		const opened = api.modules?.point?.command('openCard', lemma) === true;
		if (!opened) {
			api.ui?.showToast({
				message: t('vocabDetailList.needDetail'),
				type: 'info',
			});
		}
	};

	const showEmpty =
		!loading && !failed && items.length === 0 && cursorRef.current === null;

	return (
		<div className="text-textcolor flex h-full min-h-0 flex-col py-3.5 pl-3.5 text-sm">
			{failed && items.length === 0 ? (
				<div className="flex flex-1 flex-col items-center justify-center gap-3 pr-3.5">
					<p className="text-textcolor/70">{t('vocabDetailList.failed')}</p>
					<Button type="button" variant="outline" size="sm" onClick={retry}>
						{t('vocabDetailList.retry')}
					</Button>
				</div>
			) : loading && items.length === 0 ? (
				<Loading className="h-full" />
			) : (
				<ScrollArea
					ref={viewportRef}
					className="box-border flex min-h-0 flex-1 flex-col"
					scrollbarClassName="right-0 w-1.5 border-l-0 p-0"
				>
					<div className="pr-3.5">
						{showEmpty ? (
							<p className="text-textcolor/55 px-2 py-4 text-center">
								{t(
									reading
										? 'vocabDetailList.emptyReading'
										: 'vocabDetailList.empty',
								)}
							</p>
						) : (
							<>
								<div className="grid w-full grid-cols-2 gap-2">
									{items.map((row) => {
										const time = new Date(row.updatedAt);
										const stamp = Number.isNaN(time.getTime())
											? ''
											: time.toLocaleString(locale);
										return (
											<Button
												key={row.lemma}
												type="button"
												variant="ghost"
												onClick={() => onPick(row.lemma)}
												className="bg-theme/5 border-theme/5 hover:bg-theme/10 h-auto w-full min-w-0 flex-col items-stretch gap-0.5 rounded-md border px-2 py-1.5 text-left font-normal whitespace-normal"
											>
												<span className="truncate font-medium">
													{row.lemma}
												</span>
												{row.glossZh ? (
													<span className="text-textcolor/60 line-clamp-1 text-xs">
														{row.glossZh}
													</span>
												) : null}
												{stamp ? (
													<span className="text-textcolor/40 text-xs tabular-nums">
														{stamp}
													</span>
												) : null}
											</Button>
										);
									})}
								</div>
								<div ref={sentinelRef} className="h-px" aria-hidden />
								{failed ? (
									<div className="flex justify-center py-2">
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={retry}
										>
											{t('vocabDetailList.retry')}
										</Button>
									</div>
								) : null}
								{loading ? (
									<p className="text-textcolor/45 text-center text-xs mt-2">
										{t('common.loadingMore')}
									</p>
								) : null}
							</>
						)}
					</div>
				</ScrollArea>
			)}
		</div>
	);
}
