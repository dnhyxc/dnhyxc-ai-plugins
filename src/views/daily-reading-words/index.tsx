import '@/styles.css';
import Loading from '@design/Loading';
import PlayButton from '@design/PlayButton';
import SearchInput from '@design/SearchInput';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@ui/dropdown-menu';
import { Button, ScrollArea } from '@ui/index';
import { ChevronsUpDown } from 'lucide-react';
import { type UIEvent, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';
import {
	listSources,
	listWords,
	type ReadingSource,
	type ReadingWord,
	readingTitle,
} from './api';

type HostApi = {
	http?: {
		get: (url: string) => Promise<unknown>;
	};
	ui?: {
		showToast: (options: {
			message: string;
			type?: 'success' | 'error' | 'info';
		}) => void;
	};
	modules?: {
		point?: { command: (name: string, arg?: unknown) => unknown };
	};
};

function readingIdFromUrl(): string {
	return new URLSearchParams(window.location.search).get('readingId') ?? '';
}

type PinnedTitle = {
	id: string;
	titleEn: string;
	titleZh: string;
	missing?: boolean;
};

function pinnedFromUrl(): PinnedTitle {
	const params = new URLSearchParams(window.location.search);
	return {
		id: params.get('readingId') ?? '',
		titleEn: params.get('titleEn')?.trim() ?? '',
		titleZh: params.get('titleZh')?.trim() ?? '',
	};
}

function passageLabel(titleEn: string, titleZh: string): string {
	if (titleEn && titleZh) return `${titleEn} / ${titleZh}`;
	return titleEn || titleZh;
}

function labelOf(source: ReadingSource, duplicated: boolean): string {
	const title = source.titleEn || source.titleZh || source.readingId;
	if (!duplicated) return title;
	return `${title} · ${source.collectedAt.slice(0, 10)}`;
}

export default function DailyReadingWords({ api }: { api: HostApi }) {
	const { t } = useI18n();
	const http = api.http;
	const [sources, setSources] = useState<ReadingSource[]>([]);
	const [sourcesReady, setSourcesReady] = useState(false);
	const [pinned, setPinned] = useState(pinnedFromUrl);
	const [readingId, setReadingId] = useState(readingIdFromUrl);
	const [q, setQ] = useState('');
	const [items, setItems] = useState<ReadingWord[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [playingKey, setPlayingKey] = useState<string | null>(null);
	const ticketRef = useRef(0);
	const loadingRef = useRef(false);
	const playRun = useRef(0);
	const point = api.modules?.point;
	const pageRef = useRef({ readingId, q, nextCursor });
	pageRef.current = { readingId, q, nextCursor };

	useEffect(() => {
		return () => {
			playRun.current += 1;
			point?.command('stop', undefined);
		};
	}, [point]);

	const togglePlay = (key: string, text: string) => {
		const spoken = text.trim();
		if (!spoken || !point) return;
		if (playingKey === key) {
			playRun.current += 1;
			point.command('stop', undefined);
			setPlayingKey(null);
			return;
		}
		playRun.current += 1;
		const run = playRun.current;
		point.command('stop', undefined);
		setPlayingKey(key);
		void Promise.resolve(point.command('play', spoken)).finally(() => {
			if (playRun.current === run) setPlayingKey(null);
		});
	};

	const commitQuery = (value: string) => {
		const next = value.trim();
		setQ((current) => (current === next ? current : next));
	};

	useEffect(() => {
		if (!http) return;
		let cancelled = false;
		void listSources(http)
			.then((rows) => {
				if (!cancelled) setSources(rows);
			})
			.catch(() => {
				if (!cancelled) {
					api.ui?.showToast({
						message: t('dailyReadingWords.loadFailed'),
						type: 'error',
					});
				}
			})
			.finally(() => {
				if (!cancelled) setSourcesReady(true);
			});
		return () => {
			cancelled = true;
		};
	}, [api.ui, http, t]);

	useEffect(() => {
		if (!http || !sourcesReady || !readingId) return;
		if (sources.some((source) => source.readingId === readingId)) return;
		if (
			pinned.id === readingId &&
			(pinned.titleEn || pinned.titleZh || pinned.missing)
		) {
			return;
		}
		let cancelled = false;
		void readingTitle(http, readingId)
			.then((row) => {
				if (cancelled) return;
				setPinned({
					id: readingId,
					titleEn: row.titleEn,
					titleZh: row.titleZh,
					missing: !row.titleEn && !row.titleZh,
				});
				const params = new URLSearchParams(window.location.search);
				if (params.get('readingId') !== readingId) return;
				if (row.titleEn) params.set('titleEn', row.titleEn);
				else params.delete('titleEn');
				if (row.titleZh) params.set('titleZh', row.titleZh);
				else params.delete('titleZh');
				const query = params.toString();
				window.history.replaceState(
					null,
					'',
					`${window.location.pathname}${query ? `?${query}` : ''}`,
				);
			})
			.catch(() => {
				if (!cancelled) {
					setPinned({ id: readingId, titleEn: '', titleZh: '', missing: true });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [http, pinned, readingId, sources, sourcesReady]);

	useEffect(() => {
		if (!http) return;
		const ticket = ++ticketRef.current;
		setItems([]);
		setNextCursor(null);
		loadingRef.current = true;
		setLoading(true);
		void listWords(http, { readingId, q, cursor: '' })
			.then((page) => {
				if (ticket !== ticketRef.current) return;
				setItems(page.items);
				setNextCursor(page.nextCursor);
			})
			.catch(() => {
				if (ticket !== ticketRef.current) return;
				api.ui?.showToast({
					message: t('dailyReadingWords.loadFailed'),
					type: 'error',
				});
			})
			.finally(() => {
				if (ticket !== ticketRef.current) return;
				loadingRef.current = false;
				setLoading(false);
			});
	}, [api.ui, http, q, readingId, t]);

	const onScroll = (event: UIEvent<HTMLDivElement>) => {
		const el = event.currentTarget;
		const nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 320;
		const page = pageRef.current;
		// 没有下一页，或上一页还没回来，这次滚动不发请求
		if (!nearEnd || !page.nextCursor || loadingRef.current || !http) return;
		const ticket = ticketRef.current;
		loadingRef.current = true;
		setLoading(true);
		void listWords(http, {
			readingId: page.readingId,
			q: page.q,
			cursor: page.nextCursor,
		})
			.then((next) => {
				// 换了篇或改了搜索词后，这次追加作废，避免旧词拼进新结果
				if (ticket !== ticketRef.current) return;
				setItems((prev) => [...prev, ...next.items]);
				setNextCursor(next.nextCursor);
			})
			.finally(() => {
				if (ticket !== ticketRef.current) return;
				loadingRef.current = false;
				setLoading(false);
			});
	};

	const chooseReading = (id: string) => {
		const params = new URLSearchParams(window.location.search);
		if (id) params.set('readingId', id);
		else params.delete('readingId');
		// 换篇后地址栏里的标题属于上一篇，不能继续显示
		if (id !== pinned.id) {
			params.delete('titleEn');
			params.delete('titleZh');
		}
		const query = params.toString();
		window.history.replaceState(
			null,
			'',
			`${window.location.pathname}${query ? `?${query}` : ''}`,
		);
		setReadingId(id);
	};

	const openReading = (id: string) => {
		const opened = api.modules?.point?.command('openReading', id) === true;
		if (!opened) {
			api.ui?.showToast({
				message: t('dailyReadingWords.openFailed'),
				type: 'error',
			});
		}
	};

	const titleCount = new Map<string, number>();
	for (const source of sources) {
		titleCount.set(source.titleEn, (titleCount.get(source.titleEn) ?? 0) + 1);
	}
	const known = sources.some((source) => source.readingId === readingId);
	const readingLabel = (source: ReadingSource) => {
		const title = labelOf(source, (titleCount.get(source.titleEn) ?? 0) > 1);
		return source.titleZh ? `${title} / ${source.titleZh}` : title;
	};
	const selected = sources.find((source) => source.readingId === readingId);
	const pinnedLabel =
		!selected && pinned.id === readingId
			? passageLabel(pinned.titleEn, pinned.titleZh)
			: '';
	const filterLabel = selected
		? readingLabel(selected)
		: pinnedLabel ||
			(readingId && pinned.missing && pinned.id === readingId
				? t('dailyReadingWords.untitled')
				: readingId
					? ''
					: t('dailyReadingWords.all'));

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex shrink-0 gap-2 px-4 pt-4">
				<DropdownMenu modal={false}>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							className="border-theme/15 h-9 min-w-0 flex-1 justify-between rounded-md border bg-transparent px-2 font-normal shadow-none hover:bg-transparent"
							aria-label={`${t('dailyReadingWords.filterTitle')} ${filterLabel}`}
						>
							<span className="truncate">{filterLabel}</span>
							<ChevronsUpDown className="size-4 shrink-0 opacity-50" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="start"
						className="z-50 w-(--radix-dropdown-menu-trigger-width)"
					>
						<div className="flex flex-col gap-1.5">
							<DropdownMenuItem
								className={cn(!readingId && 'bg-theme/10 text-teal-500')}
								onSelect={() => chooseReading('')}
							>
								{t('dailyReadingWords.all')}
							</DropdownMenuItem>
							{readingId && !known && filterLabel ? (
								<DropdownMenuItem
									className="bg-theme/10 text-teal-500"
									onSelect={() => chooseReading(readingId)}
								>
									{filterLabel}
								</DropdownMenuItem>
							) : null}
							{sources.map((source) => (
								<DropdownMenuItem
									key={source.readingId}
									className={cn(
										source.readingId === readingId &&
											'bg-theme/10 text-teal-500',
									)}
									onSelect={() => chooseReading(source.readingId)}
								>
									{readingLabel(source)}
								</DropdownMenuItem>
							))}
						</div>
					</DropdownMenuContent>
				</DropdownMenu>
				<SearchInput
					committedQuery={q}
					onCommit={commitQuery}
					placeholder={t('dailyReadingWords.search')}
					className="border-theme/15 bg-transparent px-2 text-sm shadow-none"
				/>
			</div>
			{loading && items.length === 0 ? (
				<Loading className="min-h-0 flex-1" />
			) : (
				<div className="flex min-h-0 flex-1 flex-col py-4">
					<ScrollArea
						className="min-h-0 flex-1"
						scrollbarClassName="!right-px w-1.5 border-l-0 p-0"
						onScroll={onScroll}
					>
						<div className="flex flex-col gap-3 px-4">
							{!items.length ? (
								<p className="text-textcolor/60 py-8 text-center text-sm">
									{t('dailyReadingWords.empty')}
								</p>
							) : null}
							<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4">
								{items.map((item) => (
									<div
										key={item.id}
										className="bg-theme/5 border-theme/5 flex h-full min-w-0 flex-col gap-1 overflow-hidden rounded-md border p-2"
									>
										<div className="flex items-center gap-1.5">
											<div className="text-lg leading-7">{item.word}</div>
											<PlayButton
												look="plain"
												playing={playingKey === `word:${item.id}`}
												iconClassName="size-4"
												label={
													playingKey === `word:${item.id}`
														? t('dailyReadingWords.stop')
														: t('dailyReadingWords.playWord')
												}
												onClick={() => togglePlay(`word:${item.id}`, item.word)}
											/>
										</div>
										{item.zh ? (
											<p className="text-textcolor/80 mt-1 text-sm">
												{item.zh}
											</p>
										) : null}
										{item.sources.some((source) => source.sentence) ? (
											<div className="mt-1 flex flex-col gap-1">
												{item.sources.map((source) =>
													source.sentence ? (
														<p
															key={source.readingId}
															className="text-textcolor/70 text-sm leading-6"
														>
															{source.sentence}
															<PlayButton
																look="plain"
																className="ml-1.5 inline-flex align-middle -mt-0.5"
																iconClassName="size-4"
																playing={
																	playingKey ===
																	`sentence:${item.id}:${source.readingId}`
																}
																label={
																	playingKey ===
																	`sentence:${item.id}:${source.readingId}`
																		? t('dailyReadingWords.stop')
																		: t('dailyReadingWords.playSentence')
																}
																onClick={() =>
																	togglePlay(
																		`sentence:${item.id}:${source.readingId}`,
																		source.sentence,
																	)
																}
															/>
														</p>
													) : null,
												)}
											</div>
										) : null}
										<div className="mt-auto flex flex-col gap-1 pt-1">
											{item.sources.map((source) => (
												<button
													key={source.readingId}
													type="button"
													className="text-teal-500 text-left text-sm underline"
													onClick={() => openReading(source.readingId)}
												>
													{source.titleEn || source.readingId}
												</button>
											))}
										</div>
									</div>
								))}
							</div>
							{loading ? (
								<p className="text-textcolor/60 py-3 text-center text-sm">
									{t('common.loadingMore')}
								</p>
							) : null}
						</div>
					</ScrollArea>
				</div>
			)}
		</div>
	);
}
