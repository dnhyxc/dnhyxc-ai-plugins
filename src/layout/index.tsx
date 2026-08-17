import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@ui/dropdown-menu';
import { TooltipProvider } from '@ui/index';
import {
	ChevronRight,
	Languages,
	LayoutGrid,
	MoreHorizontal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useI18n } from '@/hooks';
import { cn } from '@/lib/utils';

interface NavItem {
	to: string;
	label: string;
	end?: boolean;
}

export default function Layout() {
	const { t, toggleLocale } = useI18n();
	const location = useLocation();
	const navigate = useNavigate();
	const [moreOpen, setMoreOpen] = useState(false);

	useEffect(() => {
		setMoreOpen(false);
	}, []);

	const allLinks: NavItem[] = [
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

	const visibleOnNav = allLinks.slice(0, 2);
	const overflowLinks = allLinks.slice(2);

	const isActive = (to: string, end?: boolean) => {
		if (end) return location.pathname === to;
		return location.pathname === to || location.pathname.startsWith(`${to}/`);
	};

	return (
		<div className="bg-theme-background text-textcolor flex h-screen flex-col">
			<TooltipProvider>
				<header className="border-theme-border bg-theme-background/80 backdrop-blur-sm sticky top-0 z-40 flex shrink-0 items-center px-4 h-14 border-b">
					{/* Brand */}
					<NavLink
						to="/"
						end
						className="flex items-center gap-2 mr-2 transition-opacity hover:opacity-80"
					>
						<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500 text-white">
							<LayoutGrid className="h-4 w-4" />
						</div>
						<span className="text-sm font-semibold tracking-tight">
							{t('layout.brand')}
						</span>
					</NavLink>

					{/* Divider */}
					<div className="mx-1 hidden h-5 w-px bg-theme/10 sm:block" />

					{/* Main Nav */}
					<nav className="hidden sm:flex items-center gap-0.5">
						{visibleOnNav.map(({ to, label, end }) => (
							<NavLink
								key={to}
								to={to}
								end={end}
								className={({ isActive: active }) =>
									cn(
										'group relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
										active
											? 'text-teal-500'
											: 'text-textcolor/60 hover:text-textcolor',
									)
								}
							>
								{({ isActive: active }) => (
									<>
										{label}
										<span
											className={cn(
												'absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-teal-500 transition-all duration-200',
												active
													? 'opacity-100 scale-x-100'
													: 'opacity-0 scale-x-0',
												'group-hover:opacity-100 group-hover:scale-x-100',
											)}
										/>
									</>
								)}
							</NavLink>
						))}

						{/* Overflow items: visible on md+ */}
						<div className="hidden md:flex items-center gap-0.5">
							{overflowLinks.map(({ to, label }) => (
								<NavLink
									key={to}
									to={to}
									className={({ isActive: active }) =>
										cn(
											'group relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
											active
												? 'text-teal-500'
												: 'text-textcolor/60 hover:text-textcolor',
										)
									}
								>
									{({ isActive: active }) => (
										<>
											{label}
											<span
												className={cn(
													'absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-teal-500 transition-all duration-200',
													active
														? 'opacity-100 scale-x-100'
														: 'opacity-0 scale-x-0',
													'group-hover:opacity-100 group-hover:scale-x-100',
												)}
											/>
										</>
									)}
								</NavLink>
							))}
						</div>

						{/* More dropdown: visible when overflow items hidden */}
						<DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className="group flex items-center gap-0.5 relative rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors text-textcolor/60 hover:text-textcolor md:hidden"
								>
									<MoreHorizontal className="h-4 w-4" />
									{t('layout.more')}
									<span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-teal-500 opacity-0 scale-x-0 transition-all duration-200 group-hover:opacity-100 group-hover:scale-x-100" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="w-44 mt-1">
								<DropdownMenuLabel>{t('layout.moreLabel')}</DropdownMenuLabel>
								<DropdownMenuSeparator />
								{overflowLinks.map(({ to, label }) => (
									<DropdownMenuItem
										key={to}
										className={cn(
											isActive(to) && 'bg-teal-500/10 text-teal-500',
										)}
										onSelect={() => navigate(to)}
									>
										{label}
										{isActive(to) && (
											<ChevronRight className="ml-auto h-3.5 w-3.5" />
										)}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					</nav>

					{/* Right area */}
					<div className="ml-auto flex items-center gap-1">
						<button
							type="button"
							title={t('common.toggleLanguage')}
							className="group text-textcolor/60 hover:text-textcolor relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
							onClick={() => toggleLocale()}
						>
							<Languages className="h-4 w-4" />
							<span className="absolute bottom-0 left-1.5 right-1.5 h-[2px] rounded-full bg-teal-500 opacity-0 scale-x-0 transition-all duration-200 group-hover:opacity-100 group-hover:scale-x-100" />
						</button>
					</div>
				</header>
				<main className="min-h-0 flex-1 overflow-auto">
					<Outlet />
				</main>
			</TooltipProvider>
		</div>
	);
}
