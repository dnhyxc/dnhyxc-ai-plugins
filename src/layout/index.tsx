import { TooltipProvider } from '@ui/index';
import { Languages } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';

export default function Layout() {
	const { t, toggleLocale } = useI18n();

	const links: { to: string; label: string; end?: boolean }[] = [
		{ to: '/', label: t('layout.home'), end: true },
		{ to: '/english-learning/notes', label: t('layout.learningNotes') },
		{ to: '/ebook/plugins/ideas-list', label: t('layout.ideasList') },
		{ to: '/ebook/plugins/highlights', label: t('layout.ebookHighlights') },
		{
			to: '/ebook/plugins/toolbar-test',
			label: t('layout.ebookTestBookInfo'),
		},
		{ to: '/video-player', label: t('layout.videoPlayer') },
	];

	return (
		<div className="bg-theme-background text-textcolor flex h-screen flex-col">
			<TooltipProvider>
				<header className="border-theme-border flex shrink-0 items-center gap-4 border-b px-4 py-2.5">
					<span className="text-sm font-medium">{t('layout.brand')}</span>
					<nav className="flex flex-wrap gap-1">
						{links.map(({ to, label, end }) => (
							<NavLink
								key={to}
								to={to}
								end={end}
								className={({ isActive }) =>
									cn(
										'rounded-md px-2.5 py-1 text-sm transition-colors',
										isActive
											? 'bg-theme/20 text-textcolor'
											: 'text-textcolor/60 hover:bg-theme/10 hover:text-textcolor',
									)
								}
							>
								{label}
							</NavLink>
						))}
					</nav>
					<button
						type="button"
						title={t('common.toggleLanguage')}
						className="text-textcolor/60 hover:text-textcolor ml-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-theme/10"
						onClick={() => toggleLocale()}
					>
						<Languages className="h-4 w-4" />
					</button>
					<span className="text-textcolor/40 text-xs">
						{t('layout.previewHint')}
					</span>
				</header>
				<main className="min-h-0 flex-1 overflow-auto">
					<Outlet />
				</main>
			</TooltipProvider>
		</div>
	);
}
