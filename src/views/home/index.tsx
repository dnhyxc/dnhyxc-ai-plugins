import {
	ArrowRight,
	BookOpen,
	Brain,
	Highlighter,
	Library,
	type LucideIcon,
	Play,
	Sparkles,
	Zap,
} from 'lucide-react';
import { Link } from 'react-router';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';

interface PageDef {
	to: string;
	title: string;
	desc: string;
	category: string;
	icon: LucideIcon;
	featured?: boolean;
}

export default function Home() {
	const { t } = useI18n();

	const pages: PageDef[] = [
		{
			to: '/english-learning/notes',
			title: t('home.learningNotes.title'),
			desc: t('home.learningNotes.desc'),
			category: t('home.category.learning'),
			icon: Brain,
		},
		{
			to: '/ebook/plugins/ideas-list',
			title: t('home.ideasList.title'),
			desc: t('home.ideasList.desc'),
			category: t('home.category.ebook'),
			icon: Library,
		},
		{
			to: '/ebook/plugins/highlights',
			title: t('home.ebookHighlights.title'),
			desc: t('home.ebookHighlights.desc'),
			category: t('home.category.ebook'),
			icon: Highlighter,
		},
		{
			to: '/ebook/plugins/toolbar-test',
			title: t('home.ebookTestBookInfo.title'),
			desc: t('home.ebookTestBookInfo.desc'),
			category: t('home.category.ebook'),
			icon: BookOpen,
			featured: true,
		},
		{
			to: '/video-player',
			title: t('home.videoPlayer.title'),
			desc: t('home.videoPlayer.desc'),
			category: t('home.category.media'),
			icon: Play,
		},
	];

	const grouped = pages.reduce<Record<string, PageDef[]>>((acc, p) => {
		acc[p.category] ??= [];
		acc[p.category].push(p);
		return acc;
	}, {});

	return (
		<div className="mx-auto w-full max-w-5xl px-6 py-10">
			{/* Hero */}
			<section className="mb-10">
				<div className="flex items-center gap-2 text-teal-500/80">
					<Zap className="h-4 w-4" />
					<span className="text-xs font-medium uppercase tracking-[0.2em]">
						{t('home.hero.tag')}
					</span>
				</div>
				<h1 className="mt-3 text-2xl font-semibold tracking-tight text-textcolor sm:text-3xl">
					{t('home.title')}
				</h1>
				<p className="mt-2 max-w-xl text-sm leading-relaxed text-textcolor/55">
					{t('home.desc')}
				</p>
			</section>

			{/* Card Grid */}
			<div className="space-y-8">
				{Object.entries(grouped).map(([category, items]) => (
					<section key={category}>
						<div className="mb-3 flex items-center gap-2">
							<div className="h-px flex-1 bg-linear-to-r from-transparent via-theme/15 to-transparent" />
							<span className="text-[11px] font-medium uppercase tracking-[0.15em] text-textcolor/40">
								{category}
							</span>
							<div className="h-px flex-1 bg-linear-to-r from-transparent via-theme/15 to-transparent" />
						</div>
						<div
							className={cn(
								'grid gap-3',
								items.length === 1
									? 'grid-cols-1'
									: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
							)}
						>
							{items.map((p) => (
								<Link
									key={p.to}
									to={p.to}
									className={cn(
										'group relative overflow-hidden rounded-xl border border-theme/10 bg-card p-4',
										'transition-all duration-200',
										'hover:border-teal-500/30 hover:shadow-lg hover:shadow-teal-500/5',
										'hover:-translate-y-0.5',
										'focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:outline-none',
									)}
								>
									{/* Decorative gradient */}
									<div
										className={cn(
											'pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300',
											'group-hover:opacity-100',
										)}
									>
										<div className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-teal-500/10 blur-2xl" />
									</div>

									<div className="relative">
										{/* Icon + featured badge */}
										<div className="mb-3 flex items-center justify-between">
											<div
												className={cn(
													'flex h-10 w-10 items-center justify-center rounded-lg',
													'bg-teal-500/10 text-teal-500',
													'ring-1 ring-inset ring-teal-500/10',
													'transition-transform duration-200 group-hover:scale-105',
												)}
											>
												<p.icon className="h-5 w-5" />
											</div>
											{p.featured && (
												<span className="inline-flex items-center gap-1 rounded-full bg-teal-500/10 px-2 py-0.5 text-[10px] font-medium text-teal-500">
													<Sparkles className="h-3 w-3" />
													{t('home.beta')}
												</span>
											)}
										</div>

										{/* Content */}
										<h3 className="text-sm font-medium text-textcolor">
											{p.title}
										</h3>
										<p className="mt-1 text-xs leading-relaxed text-textcolor/50">
											{p.desc}
										</p>

										{/* Route tag */}
										<div className="mt-3 flex items-center justify-between">
											<code
												className={cn(
													'rounded-md bg-theme/5 px-1.5 py-0.5 font-mono text-[10px] text-textcolor/35',
													'transition-colors group-hover:bg-teal-500/10 group-hover:text-teal-500/60',
												)}
											>
												{p.to}
											</code>
											<div
												className={cn(
													'flex h-6 w-6 items-center justify-center rounded-md',
													'bg-theme/0 text-textcolor/30',
													'transition-all duration-200',
													'group-hover:bg-teal-500/10 group-hover:text-teal-500',
												)}
											>
												<ArrowRight className="h-3.5 w-3.5" />
											</div>
										</div>
									</div>
								</Link>
							))}
						</div>
					</section>
				))}
			</div>
		</div>
	);
}
