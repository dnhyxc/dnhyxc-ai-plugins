import Confirm from '@design/Confirm';
import { Button, ScrollArea } from '@ui/index';
import { CheckCircle, Copy } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostLocale, useI18n } from '@/hooks';
import {
	type ImportTarget,
	importTargetFromPayload,
	type PointModule,
} from '@/views/vocab-detail/point';
import { IMPORT_PROMPT } from './prompt';

function targetKey(target: ImportTarget | null): string {
	if (!target) return '';
	return target.scope === 'dailyReading' ? 'dailyReading' : target.libraryId;
}

type HostApi = {
	locale?: 'zh-CN' | 'en-US';
	http?: {
		get: (url: string) => Promise<unknown>;
		post: (url: string, body?: unknown) => Promise<unknown>;
		delete: (url: string) => Promise<unknown>;
	};
	ui?: {
		showToast: (options: {
			message: string;
			type?: 'success' | 'error' | 'info';
		}) => void;
	};
	modules?: { point?: PointModule };
};

type ImportResult = {
	imported: number;
	overwritten: number;
	skippedNotInLibrary: number;
	skippedInvalid: number;
	skippedNotInLibrarySample: string[];
	skippedInvalidSample: string[];
	overwrittenSample: string[];
};

type ImportedWord = {
	lemma: string;
	glossZh: string;
	updatedAt: string;
};

function unwrap(res: unknown): Record<string, unknown> {
	const body =
		res && typeof res === 'object' && 'data' in res
			? (res as { data: unknown }).data
			: res;
	return body && typeof body === 'object'
		? (body as Record<string, unknown>)
		: {};
}

function asCount(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asSample(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string');
}

function readResult(res: unknown): ImportResult {
	const body = unwrap(res);
	return {
		imported: asCount(body.imported),
		overwritten: asCount(body.overwritten),
		skippedNotInLibrary: asCount(body.skippedNotInLibrary),
		skippedInvalid: asCount(body.skippedInvalid),
		skippedNotInLibrarySample: asSample(body.skippedNotInLibrarySample),
		skippedInvalidSample: asSample(body.skippedInvalidSample),
		overwrittenSample: asSample(body.overwrittenSample),
	};
}

function unwrapImported(res: unknown): {
	items: ImportedWord[];
	nextCursor: string | null;
	total: number;
} {
	const body = unwrap(res);
	const items = Array.isArray(body.items)
		? body.items.flatMap((row) => {
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
	if (
		!('nextCursor' in body) ||
		(body.nextCursor != null && typeof body.nextCursor !== 'string')
	) {
		throw new Error('');
	}
	const total = Number(body.total);
	const nextCursor =
		typeof body.nextCursor === 'string' && body.nextCursor
			? body.nextCursor
			: null;
	return {
		items,
		nextCursor,
		total: Number.isFinite(total) ? total : items.length,
	};
}

function errorText(cause: unknown, fallback: string): string {
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	if (cause && typeof cause === 'object' && 'message' in cause) {
		const message = (cause as { message?: unknown }).message;
		if (typeof message === 'string' && message.trim()) return message;
	}
	return fallback;
}

export default function VocabImportPanel({ api }: { api: HostApi }) {
	const { t, locale } = useI18n();
	useHostLocale(api);
	const point = api.modules?.point;
	const httpRef = useRef(api.http);
	httpRef.current = api.http;
	const [target, setTarget] = useState<ImportTarget | null>(() =>
		importTargetFromPayload(point?.getPayload('import-drawer') ?? null),
	);
	const [omitted, setOmitted] = useState(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [result, setResult] = useState<ImportResult | null>(null);
	const [confirmClear, setConfirmClear] = useState(false);
	const [copied, setCopied] = useState(false);
	const [items, setItems] = useState<ImportedWord[]>([]);
	const [total, setTotal] = useState(0);
	const [listLoading, setListLoading] = useState(false);
	const [listError, setListError] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const genRef = useRef(0);
	const cursorRef = useRef<string | null | undefined>(undefined);
	const loadingRef = useRef(false);
	const holdRef = useRef(false);
	const libraryRef = useRef('');
	const copiedTimer = useRef<number | null>(null);
	const listViewportRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!point) return;
		return point.subscribe(() =>
			setTarget(importTargetFromPayload(point.getPayload('import-drawer'))),
		);
	}, [point]);

	useEffect(
		() => () => {
			if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
		},
		[],
	);

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
		const http = httpRef.current;
		const gen = genRef.current;
		const cursor = cursorRef.current;
		if (!http?.get) {
			holdRef.current = true;
			setListError(t('vocabImport.listFailed'));
			setListLoading(false);
			return;
		}
		loadingRef.current = true;
		setListLoading(true);
		const url = reading
			? `/english-learning/vocab-detail/import?scope=dailyReading${
					cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
				}`
			: `/english-learning/vocab-detail/import?libraryId=${encodeURIComponent(libraryId)}${
					cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
				}`;
		try {
			const page = unwrapImported(await http.get(url));
			if (gen !== genRef.current) return;
			cursorRef.current = page.nextCursor;
			setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
			setTotal(page.total);
			setListError(null);
		} catch (cause) {
			if (gen !== genRef.current) return;
			holdRef.current = true;
			setListError(errorText(cause, t('vocabImport.listFailed')));
		} finally {
			if (gen === genRef.current) {
				loadingRef.current = false;
				setListLoading(false);
			}
		}
	}, [t]);

	const reloadFirstPage = () => {
		genRef.current += 1;
		cursorRef.current = undefined;
		holdRef.current = false;
		loadingRef.current = false;
		setItems([]);
		setTotal(0);
		setListError(null);
		void loadPage();
	};

	const key = targetKey(target);

	useEffect(() => {
		libraryRef.current = key;
		genRef.current += 1;
		cursorRef.current = undefined;
		holdRef.current = false;
		loadingRef.current = false;
		setItems([]);
		setTotal(0);
		setListError(null);
		if (!libraryRef.current) {
			setListLoading(false);
			return;
		}
		void loadPage();
	}, [key, loadPage]);

	useEffect(() => {
		if (key !== 'dailyReading') {
			setOmitted(0);
			return;
		}
		const http = httpRef.current;
		if (!http?.get) return;
		let cancel = false;
		void http
			.get('/english-learning/vocab-detail/prompt?scope=dailyReading')
			.then((res) => {
				if (!cancel) setOmitted(asCount(unwrap(res).omitted));
			})
			.catch(() => {
				if (!cancel) setOmitted(0);
			});
		return () => {
			cancel = true;
		};
	}, [key]);

	useEffect(() => {
		const root = listViewportRef.current;
		const sentinel = sentinelRef.current;
		if (!root || !sentinel || listError || cursorRef.current === null) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries[0]?.isIntersecting) return;
				void loadPage();
			},
			{ root, rootMargin: '120px 0px', threshold: 0 },
		);
		io.observe(sentinel);
		return () => io.disconnect();
	}, [items.length, listError, listLoading, loadPage]);

	const copyPrompt = async () => {
		try {
			let text = IMPORT_PROMPT;
			if (target?.scope === 'dailyReading') {
				const http = httpRef.current;
				if (!http?.get) throw new Error('');
				const body = unwrap(
					await http.get(
						'/english-learning/vocab-detail/prompt?scope=dailyReading',
					),
				);
				const items = Array.isArray(body.items) ? body.items : [];
				const left = asCount(body.omitted);
				setOmitted(left);
				const title =
					typeof body.title === 'string' && body.title
						? body.title
						: t('vocabImport.readingTitle');
				const note =
					left > 0
						? t('vocabImport.omitted', {
								count: String(items.length),
								omitted: String(left),
							})
						: '';
				text = `${IMPORT_PROMPT}\n${note}\n${JSON.stringify({ title, items }, null, 2)}`;
			}
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setError(null);
			if (copiedTimer.current != null) window.clearTimeout(copiedTimer.current);
			copiedTimer.current = window.setTimeout(() => {
				copiedTimer.current = null;
				setCopied(false);
			}, 1000);
		} catch {
			setError(t('vocabImport.copyFailed'));
		}
	};

	const onFile = async (file: File | undefined) => {
		if (!file || !target) return;
		setError(null);
		setResult(null);
		let parsed: unknown;
		try {
			parsed = JSON.parse(await file.text());
		} catch {
			setError(t('vocabImport.badFile'));
			return;
		}
		const fileItems =
			parsed && typeof parsed === 'object' && 'items' in parsed
				? (parsed as { items?: unknown }).items
				: null;
		if (!Array.isArray(fileItems)) {
			setError(t('vocabImport.badFile'));
			return;
		}
		if (fileItems.length > 2000) {
			setError(t('vocabImport.tooMany'));
			return;
		}
		const http = httpRef.current;
		if (!http) return;
		setBusy(true);
		try {
			const res = await http.post(
				'/english-learning/vocab-detail/import',
				target.scope === 'dailyReading'
					? { scope: 'dailyReading', items: fileItems }
					: { libraryId: target.libraryId, items: fileItems },
			);
			setResult(readResult(res));
			reloadFirstPage();
		} catch (cause) {
			setError(errorText(cause, t('vocabImport.failed')));
		} finally {
			setBusy(false);
		}
	};

	const clearManual = async () => {
		if (!target) return;
		const http = httpRef.current;
		if (!http) return;
		setBusy(true);
		setError(null);
		try {
			await http.delete(
				target.scope === 'dailyReading'
					? '/english-learning/vocab-detail/import?scope=dailyReading'
					: `/english-learning/vocab-detail/import?libraryId=${encodeURIComponent(target.libraryId)}`,
			);
			setResult(null);
			setConfirmClear(false);
			reloadFirstPage();
		} catch (cause) {
			setError(errorText(cause, t('vocabImport.failed')));
		} finally {
			setBusy(false);
		}
	};

	const chooseFile = async () => {
		const pick = point?.command;
		if (!pick) {
			fileRef.current?.click();
			return;
		}
		try {
			const file = await Promise.resolve(
				point.command('pickJsonFile', undefined) as Promise<File | null>,
			);
			if (file) await onFile(file);
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : '';
			setError(
				message === 'accept'
					? t('vocabImport.badFile')
					: t('vocabImport.failed'),
			);
		}
	};

	const onPick = (lemma: string) => {
		const opened = point?.command('openCard', lemma) === true;
		if (!opened) {
			api.ui?.showToast({
				message: t('vocabImport.needDetail'),
				type: 'info',
			});
		}
	};

	const showEmpty =
		Boolean(target) && !listLoading && !listError && items.length === 0;
	const detailGroups = (
		[
			[
				t('vocabImport.statReplaced'),
				result?.overwrittenSample ?? [],
				'bg-teal-500/5 border border-teal-500/6',
			],
			[
				t(
					target?.scope === 'dailyReading'
						? 'vocabImport.statNotInWords'
						: 'vocabImport.statMissing',
				),
				result?.skippedNotInLibrarySample ?? [],
				'bg-amber-500/5 border border-amber-500/6',
			],
			[
				t('vocabImport.statInvalid'),
				result?.skippedInvalidSample ?? [],
				'bg-rose-500/5 border border-rose-500/6',
			],
		] as const
	).filter(([, words]) => words.length > 0);

	return (
		<div className="text-textcolor flex h-full min-h-0 flex-col text-sm">
			<div className="shrink-0 space-y-1.5 px-3.5 pt-2.5">
				<p className="min-w-0 truncate font-medium">
					{target?.scope === 'dailyReading'
						? t('vocabImport.readingTitle')
						: target?.scope === 'library'
							? target.title || t('vocabImport.noLibrary')
							: t('vocabImport.noLibrary')}
				</p>
				<div className="mt-1 flex items-center justify-between gap-2">
					<span className="text-textcolor text-[13px]">
						{t('vocabImport.promptTitle')}
					</span>
					<button
						type="button"
						className="text-textcolor/70 hover:text-textcolor flex cursor-pointer items-center gap-1 text-[13px]"
						onClick={() => void copyPrompt()}
					>
						{copied ? <CheckCircle size={13} /> : <Copy size={13} />}
						{copied ? t('vocabImport.copied') : t('vocabImport.copyPrompt')}
					</button>
				</div>
			</div>
			<div className="bg-theme/5 border-theme/5 mx-3.5 mt-1.5 flex min-h-0 flex-2 flex-col overflow-hidden rounded-md border py-2">
				<ScrollArea
					className="min-h-0 flex-1"
					scrollbarClassName="right-0 w-1.5 border-l-0 p-0"
				>
					<p className="text-textcolor/70 px-2 text-[13px] leading-relaxed whitespace-pre-wrap">
						{IMPORT_PROMPT}
					</p>
				</ScrollArea>
			</div>
			<p className="text-textcolor/70 shrink-0 px-3.5 pt-1.5 pb-2 text-xs leading-relaxed text-justify">
				{t('vocabImport.hint')}
			</p>
			{target?.scope === 'dailyReading' && omitted > 0 ? (
				<p className="text-textcolor/70 shrink-0 px-3.5 pb-2 text-xs leading-relaxed">
					{t('vocabImport.omittedHint', { omitted: String(omitted) })}
				</p>
			) : null}
			<p className="flex min-w-0 shrink-0 items-baseline gap-2 px-3.5 pb-1.5 text-[13px]">
				<span className="text-textcolor shrink-0">
					{t('vocabImport.importedTitle')}
				</span>
				<span className="text-textcolor/50 truncate font-normal">
					{t('vocabImport.importedSummary', {
						total: String(total),
						loaded: String(items.length),
					})}
				</span>
			</p>
			<ScrollArea
				ref={listViewportRef}
				className="box-border flex min-h-0 flex-5 flex-col px-3.5"
			>
				{listLoading && items.length === 0 ? (
					<p className="text-textcolor/55 px-2 py-6 text-center text-xs">
						{t('common.loading')}
					</p>
				) : listError && items.length === 0 ? (
					<div className="flex flex-col items-center gap-3 px-2 py-6">
						<p className="text-textcolor/70 text-center">{listError}</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								holdRef.current = false;
								setListError(null);
								void loadPage();
							}}
						>
							{t('vocabImport.retry')}
						</Button>
					</div>
				) : showEmpty ? (
					<p className="text-textcolor/55 px-2 py-4 text-center">
						{t(
							target?.scope === 'dailyReading'
								? 'vocabImport.importedEmptyReading'
								: 'vocabImport.importedEmpty',
						)}
					</p>
				) : (
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
									<span className="truncate font-medium">{row.lemma}</span>
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
						{cursorRef.current !== null ? (
							<div
								ref={sentinelRef}
								className="col-span-2 h-1 w-full"
								aria-hidden
							/>
						) : null}
						{listError ? (
							<div className="col-span-2 flex justify-center py-2">
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										holdRef.current = false;
										setListError(null);
										void loadPage();
									}}
								>
									{t('vocabImport.retry')}
								</Button>
							</div>
						) : null}
						{listLoading ? (
							<p className="text-textcolor/45 col-span-2 mt-2 text-center text-xs">
								{t('common.loadingMore')}
							</p>
						) : null}
					</div>
				)}
			</ScrollArea>
			{error ? (
				<p className="shrink-0 px-3.5 pt-2.5 text-xs text-rose-500">{error}</p>
			) : null}
			{result ? (
				<p className="text-textcolor shrink-0 px-3.5 pt-2.5 text-[13px] leading-5">
					{t('vocabImport.statAdded')} {result.imported}
					<span className="text-textcolor/25 px-1.5">·</span>
					{t('vocabImport.statReplaced')} {result.overwritten}
					<span className="text-textcolor/25 px-1.5">·</span>
					{t(
						target?.scope === 'dailyReading'
							? 'vocabImport.statNotInWords'
							: 'vocabImport.statMissing',
					)}{' '}
					{result.skippedNotInLibrary}
					<span className="text-textcolor/25 px-1.5">·</span>
					{t('vocabImport.statInvalid')} {result.skippedInvalid}
				</p>
			) : null}
			{detailGroups.length > 0 ? (
				<ScrollArea
					className="mt-1 min-h-0 flex-3"
					scrollbarClassName="right-0 w-1.5 border-l-0 p-0"
				>
					<div className="space-y-2 px-3.5">
						{detailGroups.map(([label, words, tone]) => (
							<div key={label} className={`${tone} rounded-md px-2 py-2`}>
								<p className="text-textcolor text-[13px]">
									{label} {words.length}
								</p>
								<p className="text-textcolor/70 mt-1 text-xs leading-5">
									{words.join('、')}
								</p>
							</div>
						))}
					</div>
				</ScrollArea>
			) : null}
			<div className="bg-background flex shrink-0 items-center justify-end gap-2 px-3.5 pt-2.5 pb-3.5">
				<Button
					type="button"
					size="sm"
					disabled={!target || busy}
					className="flex-1"
					onClick={() => void chooseFile()}
				>
					{t('vocabImport.chooseFile')}
				</Button>
				<Button
					type="button"
					variant="default"
					size="sm"
					className="flex-1 bg-orange-400 hover:bg-orange-500"
					disabled={!target || busy || total === 0}
					onClick={() => setConfirmClear(true)}
				>
					{t('vocabImport.clear')}
				</Button>
			</div>
			<input
				ref={fileRef}
				type="file"
				accept="application/json,.json"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = '';
					void onFile(file);
				}}
			/>
			<Confirm
				open={confirmClear}
				onOpenChange={setConfirmClear}
				title={t('vocabImport.clearTitle')}
				description={t(
					target?.scope === 'dailyReading'
						? 'vocabImport.clearDescReading'
						: 'vocabImport.clearDesc',
				)}
				confirmVariant="destructive"
				onConfirm={() => void clearManual()}
			/>
		</div>
	);
}
