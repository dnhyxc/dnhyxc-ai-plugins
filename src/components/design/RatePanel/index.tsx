import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

const RATE_MIN = 0.5;
const RATE_MAX = 3;
/** 短刻度 0.1x；长刻度每 0.5x（中间 4 根短线） */
const RATE_STEP = 0.1;
const RATE_MAJOR = 0.5;
const MAJOR_EVERY = Math.round(RATE_MAJOR / RATE_STEP); // 5
const STEP_COUNT = Math.round((RATE_MAX - RATE_MIN) / RATE_STEP); // 25 → 26 根刻度
const LABELS = Array.from(
	{ length: Math.round(STEP_COUNT / MAJOR_EVERY) + 1 },
	(_, i) => Number((RATE_MIN + i * RATE_MAJOR).toFixed(1)),
); // 0.5 … 3.0
const PRESETS = [1, 1.5, 2, 2.5, 3] as const;

const TICK_MAJOR_H = 20;
const TICK_MIDDLE_H = 15;
const TICK_MINOR_H = 10;

type Tick = { index: number; major: boolean };

const TICKS: Tick[] = Array.from({ length: STEP_COUNT + 1 }, (_, index) => ({
	index,
	major: index % MAJOR_EVERY === 0,
}));

function formatRate(value: number): string {
	return `${value.toFixed(1)} X`;
}

function clampRate(rate: number): number {
	return Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
}

function toIndex(rate: number): number {
	return Math.round((clampRate(rate) - RATE_MIN) / RATE_STEP);
}

function fromIndex(index: number): number {
	const i = Math.min(STEP_COUNT, Math.max(0, index));
	return Number((RATE_MIN + i * RATE_STEP).toFixed(1));
}

function snapRate(rate: number): number {
	return fromIndex(toIndex(rate));
}

function indexFromClientX(el: HTMLElement, clientX: number): number {
	const rect = el.getBoundingClientRect();
	if (rect.width <= 0) return 0;
	const ratio = (clientX - rect.left) / rect.width;
	return Math.round(Math.min(1, Math.max(0, ratio)) * STEP_COUNT);
}

export type RatePanelProps = {
	rate: number;
	onRateChange: (rate: number) => void;
	label: string;
	className?: string;
	footer?: ReactNode;
};

/**
 * 播放倍速面板：0.5X–3.0X 刻度（0.1 步进）+ 快捷预设。
 * 刻度用 flex 均分绘制，避免 absolute + 父级 text-align 导致错乱。
 */
export function RatePanel({
	rate,
	onRateChange,
	label,
	className,
	footer,
}: RatePanelProps) {
	const trackRef = useRef<HTMLDivElement>(null);
	const draggingRef = useRef(false);
	const index = toIndex(rate);
	const indicatorLeft = `${(index / STEP_COUNT) * 100}%`;

	const setFromClientX = useCallback(
		(clientX: number) => {
			const track = trackRef.current;
			if (!track) return;
			onRateChange(fromIndex(indexFromClientX(track, clientX)));
		},
		[onRateChange],
	);

	const onPointerDown = useCallback(
		(e: PointerEvent<HTMLDivElement>) => {
			e.preventDefault();
			e.stopPropagation();
			draggingRef.current = true;
			e.currentTarget.setPointerCapture(e.pointerId);
			setFromClientX(e.clientX);
		},
		[setFromClientX],
	);

	const onPointerMove = useCallback(
		(e: PointerEvent<HTMLDivElement>) => {
			if (!draggingRef.current) return;
			setFromClientX(e.clientX);
		},
		[setFromClientX],
	);

	const onPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
		draggingRef.current = false;
		if (e.currentTarget.hasPointerCapture(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId);
		}
	}, []);

	const onKeyDown = useCallback(
		(e: KeyboardEvent<HTMLDivElement>) => {
			let delta = 0;
			if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = 1;
			else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -1;
			if (!delta) return;
			e.preventDefault();
			onRateChange(fromIndex(index + delta));
		},
		[index, onRateChange],
	);

	return (
		<div
			className={cn('px-3 pt-2 pb-3 text-left text-textcolor', className)}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<div className="text-left text-sm font-normal text-textcolor mb-2.5">
				{label}
			</div>

			<div className="rounded-md bg-theme/5 pt-2 pb-3.5 px-2">
				<p className="text-center text-3xl font-semibold tabular-nums">
					{formatRate(snapRate(rate))}
				</p>

				{/* 左右留白给端点标签；track 内 0%→100% 对应 0.5→3.0 */}
				<div className="mt-5 px-3.5">
					<div
						ref={trackRef}
						role="slider"
						tabIndex={0}
						aria-label={label}
						aria-valuemin={RATE_MIN}
						aria-valuemax={RATE_MAX}
						aria-valuenow={clampRate(rate)}
						aria-valuetext={formatRate(rate)}
						className="relative cursor-pointer touch-none outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-teal-500/40"
						onPointerDown={onPointerDown}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerUp}
						onKeyDown={onKeyDown}
					>
						<div
							className="pointer-events-none relative"
							style={{ height: TICK_MAJOR_H + 8 }}
						>
							{/* 行内样式绘刻度，避免 Tailwind bg-* 在 MF 下未生成 */}
							<div
								className="absolute inset-x-0 bottom-0"
								style={{ height: TICK_MAJOR_H }}
							>
								{TICKS.map((tick) => (
									<div
										key={tick.index}
										style={{
											position: 'absolute',
											left: `${(tick.index / STEP_COUNT) * 100}%`,
											bottom: 0,
											transform: 'translateX(-50%)',
											width: 1,
											height: tick.major ? TICK_MIDDLE_H : TICK_MINOR_H,
										}}
										className="bg-textcolor/50"
									/>
								))}
							</div>

							<div
								className="absolute bottom-0 z-10 flex -translate-x-1/2 flex-col items-center gap-0 leading-none"
								style={{ left: indicatorLeft }}
								aria-hidden
							>
								<span
									className="block size-0 border-x-[5px] border-x-transparent border-t-[6px]"
									style={{ borderTopColor: 'var(--brand-accent, #14b8a6)' }}
								/>
								{/* 负 margin 让竖线上探进三角底边，消除 border 三角形抗锯齿缝隙 */}
								<span
									className="block"
									style={{
										width: 2,
										height: TICK_MAJOR_H,
										marginTop: -2,
										backgroundColor: 'var(--brand-accent, #14b8a6)',
									}}
								/>
							</div>
						</div>

						{/* 6 个主刻度标签均分，与长刻度对齐 */}
						<div className="relative mt-1 flex h-4 justify-between">
							{LABELS.map((value) => (
								<span
									key={value}
									className="w-0 overflow-visible text-center text-xs whitespace-nowrap text-textcolor tabular-nums"
								>
									<span className="inline-block -translate-x-1/2">
										{formatRate(value)}
									</span>
								</span>
							))}
						</div>
					</div>
				</div>

				<div className="mt-5 flex items-center justify-between gap-1 px-2">
					{PRESETS.map((preset) => {
						const selected = Math.abs(rate - preset) < 0.001;
						return (
							<button
								key={preset}
								type="button"
								className={cn(
									'size-10 shrink-0 cursor-pointer rounded-full border text-sm tabular-nums transition-colors',
									selected
										? 'border-teal-500 font-medium text-teal-500'
										: 'border-theme/35 text-textcolor/70 hover:border-teal-500 hover:text-teal-500',
								)}
								aria-label={formatRate(preset)}
								aria-pressed={selected}
								onClick={() => onRateChange(preset)}
							>
								{preset.toFixed(1)}
							</button>
						);
					})}
				</div>
			</div>

			{footer}
		</div>
	);
}

export default RatePanel;
