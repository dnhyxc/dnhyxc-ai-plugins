import Loading from '@design/Loading';
import { Button } from '@ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@ui/dropdown-menu';
import { ScrollArea } from '@ui/index';
import { Spinner } from '@ui/spinner';
import {
	Check,
	History,
	Import,
	PanelTopClose,
	PanelTopOpen,
	RefreshCw,
	Sparkles,
	Square,
	Volume2,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useHostLocale, useI18n } from '@/hooks';
import { cn } from '@/lib/utils';
import {
	cancelVocabDetail,
	errorMessage,
	loadVocabDetail,
	regenerateVocabDetail,
	type VersionSource,
	type VocabVersions,
} from './api';
import { cardFromPayload, type PointModule } from './point';
import type { VocabCardSnapshot, VocabDetail } from './types';

type HostApi = {
	locale?: 'zh-CN' | 'en-US';
	event?: {
		on: (event: string, handler: (data?: unknown) => void) => void;
		off: (event: string, handler: (data?: unknown) => void) => void;
	};
	http?: {
		get: (url: string) => Promise<unknown>;
		post?: (url: string, body?: unknown) => Promise<unknown>;
	};
	modules?: { point?: PointModule };
};

function displayIpa(ipa: string): string {
	const text = ipa.trim();
	if (!text) return '';
	if (text.length >= 2 && text.startsWith('/') && text.endsWith('/')) {
		return text;
	}
	return `/${text}/`;
}

const KIND_LABEL: Record<string, string> = {
	prefix: 'vocabDetail.kind.prefix',
	root: 'vocabDetail.kind.root',
	suffix: 'vocabDetail.kind.suffix',
	base: 'vocabDetail.kind.base',
};

function kindLabel(kind: string, t: (key: string) => string): string {
	const key = KIND_LABEL[kind];
	return key ? t(key) : kind;
}

function WordHead({
	card,
	playing,
	onPlay,
}: {
	card: VocabCardSnapshot | null;
	playing: boolean;
	onPlay?: (key: string, text: string) => void;
}) {
	const { t } = useI18n();
	if (!card?.word) return null;
	const ipa = card.ipa ? displayIpa(card.ipa) : '';
	const pos = card.pos?.trim();
	const key = `word:${card.word}`;
	return (
		<header className="flex items-start gap-2">
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="flex flex-wrap items-baseline gap-x-2">
					<h2 className="text-textcolor text-[1.75rem] font-semibold leading-none tracking-tight">
						{card.word}
					</h2>
					{pos ? (
						<span className="text-textcolor/45 text-xs">{pos}</span>
					) : null}
				</div>
				{ipa ? (
					<p className="font-mono text-[13px] leading-snug text-teal-600/90 dark:text-teal-400/90">
						{ipa}
					</p>
				) : null}
			</div>
			{onPlay ? (
				<PlayButton
					playing={playing}
					label={playing ? t('vocabDetail.stop') : t('vocabDetail.play')}
					onClick={() => onPlay(key, card.word)}
				/>
			) : null}
		</header>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<h3 className="text-textcolor/55 text-[13px] font-medium">{title}</h3>
			{children}
		</section>
	);
}

function Tag({ children }: { children: string }) {
	return (
		<span className="mr-1.5 inline-flex shrink-0 rounded bg-teal-500/15 px-1.5 text-[11px] leading-5 text-teal-600 dark:text-teal-400">
			{children}
		</span>
	);
}

const VERSION_ORDER: VersionSource[] = ['manual', 'generated', 'regen'];

const VERSION_LABEL: Record<VersionSource, string> = {
	manual: 'vocabDetail.version.manual',
	generated: 'vocabDetail.version.generated',
	regen: 'vocabDetail.version.regen',
};

const VERSION_ICON: Record<VersionSource, typeof Import> = {
	manual: Import,
	generated: History,
	regen: Sparkles,
};

function presentVersions(versions: VocabVersions | null): VersionSource[] {
	if (!versions) return [];
	return VERSION_ORDER.filter((source) => versions[source]);
}

function DetailActions({
	source,
	choices,
	regenerating,
	stopping,
	onPick,
	onRegen,
	onStop,
}: {
	source: VersionSource;
	choices: VersionSource[];
	regenerating: boolean;
	stopping: boolean;
	onPick: (source: VersionSource) => void;
	onRegen: () => void;
	onStop: () => void;
}) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const TriggerIcon = open ? PanelTopClose : PanelTopOpen;
	const link =
		'h-auto gap-1.5 px-0! py-0 text-sm font-medium text-teal-500 shadow-none has-[>svg]:px-0! hover:bg-transparent hover:text-teal-400 disabled:opacity-40 data-[state=open]:bg-transparent data-[state=open]:text-teal-400';
	return (
		<div className="flex items-center justify-end gap-4">
			{choices.length >= 2 ? (
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={regenerating}
							aria-expanded={open}
							className={link}
						>
							<TriggerIcon className="size-4 shrink-0 opacity-90" aria-hidden />
							<span className="max-w-28 truncate">
								{t(VERSION_LABEL[source])}
							</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						side="top"
						align="end"
						sideOffset={6}
						className="min-w-36"
					>
						{choices.map((item) => {
							const Icon = VERSION_ICON[item];
							return (
								<DropdownMenuItem
									key={item}
									className="gap-2"
									onSelect={() => onPick(item)}
								>
									<Icon
										className="size-4 shrink-0 text-textcolor"
										aria-hidden
									/>
									<span className="min-w-0 flex-1 truncate">
										{t(VERSION_LABEL[item])}
									</span>
									<Check
										className={cn(
											'size-3.5 shrink-0',
											item === source ? 'opacity-100' : 'opacity-0',
										)}
										aria-hidden
									/>
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
			{regenerating ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={stopping}
					className={link}
					onClick={onStop}
				>
					<Square
						className="size-4 shrink-0 fill-current opacity-90"
						aria-hidden
					/>
					{stopping ? t('vocabDetail.stopping') : t('vocabDetail.stopGenerate')}
				</Button>
			) : (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className={link}
					onClick={onRegen}
				>
					<RefreshCw className="size-4 shrink-0 opacity-90" aria-hidden />
					{t('vocabDetail.regenerate')}
				</Button>
			)}
		</div>
	);
}

function StopGenerate({
	stopping,
	onStop,
}: {
	stopping: boolean;
	onStop: () => void;
}) {
	const { t } = useI18n();
	return (
		<Button
			type="button"
			size="sm"
			variant="link"
			disabled={stopping}
			className="text-teal-500 hover:text-teal-400 px-0! h-5"
			onClick={onStop}
		>
			<Square className="size-4 fill-current" />
			{t('vocabDetail.stopGenerate')}
		</Button>
	);
}

function PlayButton({
	playing,
	label,
	onClick,
}: {
	playing: boolean;
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			aria-label={label}
			onClick={onClick}
			className={
				playing
					? 'mt-0.5 h-7 w-7 shrink-0 rounded-md border border-teal-500/40 bg-teal-500/15 p-0 text-teal-600 dark:text-teal-400'
					: 'border-theme/10 text-textcolor/60 hover:border-theme/20 hover:bg-theme/10 mt-0.5 h-7 w-7 shrink-0 rounded-md border p-0 hover:text-teal-600 dark:hover:text-teal-400'
			}
		>
			{playing ? (
				<Square className="size-3.5 fill-current" />
			) : (
				<Volume2 className="size-3.5" />
			)}
		</Button>
	);
}

function Lines({
	items,
	tag = false,
	playingKey,
	onPlay,
	playLabel,
	stopLabel,
}: {
	items: {
		key: string;
		main: string;
		aside?: string;
		detail: string;
		speak?: string;
	}[];
	/** 类型标在形式前面，用小标签标识 */
	tag?: boolean;
	playingKey?: string | null;
	onPlay?: (key: string, text: string) => void;
	playLabel?: string;
	stopLabel?: string;
}) {
	return (
		<div className="flex flex-col gap-2">
			{items.map((item) => {
				const playing = playingKey === item.key;
				const line = (
					<p className="min-w-0 flex-1 text-sm leading-6">
						{tag && item.aside ? <Tag>{item.aside}</Tag> : null}
						<span className="text-textcolor mr-1.5 font-medium">
							{item.main}
						</span>
						{!tag && item.aside ? (
							<span className="mr-1.5 text-xs text-teal-600/80 dark:text-teal-400/80">
								{item.aside}
							</span>
						) : null}
						<span className="text-textcolor/70">{item.detail}</span>
					</p>
				);
				if (!item.speak || !onPlay) {
					return <div key={item.key}>{line}</div>;
				}
				return (
					<div key={item.key} className="flex items-start gap-2">
						{line}
						<PlayButton
							playing={playing}
							label={(playing ? stopLabel : playLabel) ?? ''}
							onClick={() => onPlay(item.key, item.speak ?? '')}
						/>
					</div>
				);
			})}
		</div>
	);
}

function DetailSections({
	detail,
	onPlay,
	playingKey,
}: {
	detail: VocabDetail;
	onPlay?: (key: string, text: string) => void;
	playingKey: string | null;
}) {
	const { t } = useI18n();
	const playLabel = t('vocabDetail.play');
	const stopLabel = t('vocabDetail.stop');
	return (
		<div className="flex flex-col gap-7">
			<Section title={t('vocabDetail.morphology')}>
				<Lines
					tag
					items={detail.morphology.parts.map((part) => ({
						key: `${part.kind}-${part.form}`,
						main: part.form,
						aside: kindLabel(part.kind, t),
						detail: part.meaningZh,
					}))}
				/>
				{detail.morphology.storyZh ? (
					<p className="text-textcolor/70 text-sm leading-7">
						{detail.morphology.storyZh}
					</p>
				) : null}
			</Section>
			<Section title={t('vocabDetail.memory')}>
				<p className="text-textcolor text-sm leading-7">
					{detail.memory.hookZh}
				</p>
			</Section>
			<Section title={t('vocabDetail.senses')}>
				<div className="flex flex-col gap-3">
					{detail.senses.map((sense) => (
						<div
							key={`${sense.pos}-${sense.glossZh}`}
							className="flex flex-col gap-1"
						>
							<p className="text-sm leading-6">
								<Tag>{sense.pos}</Tag>
								<span className="text-textcolor font-medium">
									{sense.glossZh}
								</span>
							</p>
							{sense.nuanceZh ? (
								<p className="text-textcolor/55 text-xs leading-5">
									{sense.nuanceZh}
								</p>
							) : null}
						</div>
					))}
				</div>
			</Section>
			<Section title={t('vocabDetail.examples')}>
				<div className="flex flex-col gap-4">
					{detail.examples.map((example) => {
						const key = `example:${example.en}`;
						const playing = playingKey === key;
						return (
							<div key={example.en} className="flex items-start gap-2">
								<div className="min-w-0 flex-1">
									<p className="text-textcolor text-sm leading-7">
										{example.en}
									</p>
									<p className="text-textcolor/55 mt-1 text-sm leading-6">
										{example.zh}
									</p>
								</div>
								{onPlay ? (
									<PlayButton
										playing={playing}
										label={playing ? stopLabel : playLabel}
										onClick={() => onPlay(key, example.en)}
									/>
								) : null}
							</div>
						);
					})}
				</div>
			</Section>
			{(detail.family ?? []).length > 0 ? (
				<Section title={t('vocabDetail.family')}>
					<Lines
						playingKey={playingKey}
						onPlay={onPlay}
						playLabel={playLabel}
						stopLabel={stopLabel}
						items={(detail.family ?? []).map((row) => ({
							key: `family:${row.word}`,
							main: row.word,
							aside: row.pos,
							detail: row.glossZh,
							speak: row.word,
						}))}
					/>
				</Section>
			) : null}
			{(detail.collocations ?? []).length > 0 ? (
				<Section title={t('vocabDetail.collocations')}>
					<Lines
						playingKey={playingKey}
						onPlay={onPlay}
						playLabel={playLabel}
						stopLabel={stopLabel}
						items={(detail.collocations ?? []).map((row) => ({
							key: `collocation:${row.phrase}`,
							main: row.phrase,
							detail: row.glossZh,
							speak: row.phrase,
						}))}
					/>
				</Section>
			) : null}
			{(detail.synonyms ?? []).length > 0 ? (
				<Section title={t('vocabDetail.synonyms')}>
					<Lines
						playingKey={playingKey}
						onPlay={onPlay}
						playLabel={playLabel}
						stopLabel={stopLabel}
						items={(detail.synonyms ?? []).map((row) => ({
							key: `synonym:${row.word}`,
							main: row.word,
							aside: row.pos,
							detail: row.glossZh,
							speak: row.word,
						}))}
					/>
				</Section>
			) : null}
			{(detail.tags ?? []).length > 0 ? (
				<p className="text-textcolor/45 text-xs">
					{(detail.tags ?? []).join(' · ')}
				</p>
			) : null}
		</div>
	);
}

export default function VocabDetailPanel({ api }: { api: HostApi }) {
	const { t } = useI18n();
	useHostLocale(api);
	const point = api.modules?.point;
	const httpRef = useRef(api.http);
	httpRef.current = api.http;
	const [card, setCard] = useState<VocabCardSnapshot | null>(null);
	const [detail, setDetail] = useState<VocabDetail | null>(null);
	const [head, setHead] = useState<{ ipa: string; pos: string } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [playingKey, setPlayingKey] = useState<string | null>(null);
	const [stopping, setStopping] = useState(false);
	const [stopped, setStopped] = useState(false);
	const [versions, setVersions] = useState<VocabVersions | null>(null);
	const [source, setSource] = useState<VersionSource | null>(null);
	const [regenerating, setRegenerating] = useState(false);
	const [generating, setGenerating] = useState(false);
	const playRun = useRef(0);
	const regenRun = useRef(0);

	const togglePlay = (key: string, text: string) => {
		if (!text.trim() || !point) return;
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
		void Promise.resolve(point.command('play', text)).finally(() => {
			if (playRun.current === run) setPlayingKey(null);
		});
	};

	useEffect(() => {
		return () => {
			playRun.current += 1;
			point?.command('stop', undefined);
		};
	}, [point]);

	useEffect(() => {
		if (!point) return;
		const pull = () => setCard(cardFromPayload(point.getPayload('drawer')));
		pull();
		return point.subscribe(pull);
	}, [point]);

	useEffect(() => {
		const word = card?.word.trim();
		const http = httpRef.current;
		if (!word || !http) return;
		setDetail(null);
		setHead(null);
		setError(null);
		setStopped(false);
		setStopping(false);
		setVersions(null);
		setSource(null);
		setRegenerating(false);
		setGenerating(false);
		regenRun.current += 1;
		let cancelled = false;
		const setPending = (pending: boolean) =>
			point?.publishSignal('pending', {
				pluginId: 'vocabDetail',
				key: word,
				on: pending,
			});
		void loadVocabDetail(http, word, {
			setPending,
			setGenerating: (on) => {
				if (!cancelled) setGenerating(on);
			},
		})
			.then((next) => {
				if (cancelled) return;
				if (next.cancelled) {
					setStopped(true);
					setStopping(false);
					return;
				}
				setStopping(false);
				setDetail(next.detail);
				setVersions(next.versions);
				setSource(next.source);
				setHead({ ipa: next.ipa, pos: next.pos });
			})
			.catch((cause: unknown) => {
				if (!cancelled) {
					setStopping(false);
					setError(errorMessage(cause));
				}
			});
		return () => {
			cancelled = true;
			playRun.current += 1;
			point?.command('stop', undefined);
			setPlayingKey(null);
		};
	}, [attempt, point, card?.word]);

	const stopGenerate = () => {
		const word = card?.word.trim();
		const http = httpRef.current;
		if (!word || !http || stopping) return;
		setStopping(true);
		cancelVocabDetail(http, word, regenerating ? 'regen' : undefined);
	};

	const onPickVersion = (nextSource: VersionSource) => {
		const next = versions?.[nextSource];
		if (!next) return;
		setSource(nextSource);
		setDetail(next);
	};

	const regenerate = async () => {
		const word = card?.word.trim();
		const http = httpRef.current;
		if (!word || !http || regenerating) return;
		regenRun.current += 1;
		const run = regenRun.current;
		setRegenerating(true);
		setStopping(false);
		setError(null);
		try {
			const next = await regenerateVocabDetail(http, word);
			if (regenRun.current !== run) return;
			if (next.cancelled) return;
			setVersions((current) => ({
				manual: current?.manual ?? null,
				generated: current?.generated ?? null,
				regen: next.detail,
			}));
			setSource('regen');
			setDetail(next.detail);
		} catch (cause: unknown) {
			if (regenRun.current === run) setError(errorMessage(cause));
		} finally {
			if (regenRun.current === run) {
				setRegenerating(false);
				setStopping(false);
			}
		}
	};

	const pending = Boolean(card?.word) && !detail && !error && !stopped;
	const showStop = generating || stopping;
	const shownCard = card
		? {
				...card,
				ipa: card.ipa?.trim() || head?.ipa || '',
				pos: card.pos?.trim() || head?.pos || detail?.senses[0]?.pos || '',
			}
		: null;
	// 列表只有词条，整页 Loading；卡片打开时词头已经有了，不再换成 Loading
	if (pending && card?.source === 'list') {
		return (
			<div className="flex h-full min-h-0 flex-col">
				<Loading
					className="min-h-0 flex-1"
					text={stopping ? t('vocabDetail.stopping') : t('vocabDetail.loading')}
				/>
				{showStop ? (
					<div className="flex justify-center px-4 pb-4">
						<StopGenerate stopping={stopping} onStop={stopGenerate} />
					</div>
				) : null}
			</div>
		);
	}

	const versionChoices = presentVersions(versions);
	return (
		<div className="flex h-full min-h-0 flex-col py-3.5 pl-3.5">
			<ScrollArea
				className="min-h-0 flex-1"
				scrollbarClassName="right-0 w-1.5 border-l-0 p-0"
			>
				<div className="flex select-text flex-col gap-6 pr-3.5">
					<WordHead
						card={shownCard}
						playing={playingKey === `word:${card?.word ?? ''}`}
						onPlay={point ? togglePlay : undefined}
					/>
					{!card?.word ? (
						<p className="text-textcolor/55 text-sm">
							{t('vocabDetail.empty')}
						</p>
					) : null}
					{error ? (
						<div className="flex flex-col items-start gap-2">
							<p className="text-sm text-rose-500">{error}</p>
							<Button
								type="button"
								size="sm"
								onClick={() => setAttempt((n) => n + 1)}
							>
								{t('vocabDetail.retry')}
							</Button>
						</div>
					) : null}
					{stopped ? (
						<div className="flex flex-col items-start gap-2">
							<p className="text-textcolor/55 text-sm">
								{t('vocabDetail.stopped')}
							</p>
							<Button
								type="button"
								size="sm"
								onClick={() => setAttempt((n) => n + 1)}
							>
								{t('vocabDetail.retry')}
							</Button>
						</div>
					) : null}
					{pending ? (
						<div className="w-full text-textcolor/55 flex items-center justify-between gap-3 self-start text-sm">
							<span className="flex items-center gap-2">
								<Spinner
									className="size-4 shrink-0 text-textcolor/55"
									aria-hidden
								/>
								<span>
									{stopping
										? t('vocabDetail.stopping')
										: t('vocabDetail.loading')}
								</span>
							</span>
							{showStop ? (
								<StopGenerate stopping={stopping} onStop={stopGenerate} />
							) : null}
						</div>
					) : null}
					{detail ? (
						<DetailSections
							detail={detail}
							playingKey={playingKey}
							onPlay={point ? togglePlay : undefined}
						/>
					) : null}
					{detail && source ? (
						<DetailActions
							source={source}
							choices={versionChoices}
							regenerating={regenerating}
							stopping={stopping}
							onPick={onPickVersion}
							onRegen={() => void regenerate()}
							onStop={stopGenerate}
						/>
					) : null}
				</div>
			</ScrollArea>
		</div>
	);
}
