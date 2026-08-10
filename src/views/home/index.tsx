import { Link } from 'react-router';
import { useI18n } from '@/hooks';

export default function Home() {
	const { t } = useI18n();

	const pages = [
		{
			to: '/english-learning/notes',
			title: t('home.learningNotes.title'),
			desc: t('home.learningNotes.desc'),
		},
		{
			to: '/ebook/plugins/ideas-list',
			title: t('home.ideasList.title'),
			desc: t('home.ideasList.desc'),
		},
		{
			to: '/ebook/plugins/highlights',
			title: t('home.ebookHighlights.title'),
			desc: t('home.ebookHighlights.desc'),
		},
		{
			to: '/ebook/plugins/toolbar-test',
			title: t('home.ebookTestBookInfo.title'),
			desc: t('home.ebookTestBookInfo.desc'),
		},
		{
			to: '/video-player',
			title: t('home.videoPlayer.title'),
			desc: t('home.videoPlayer.desc'),
		},
	] as const;

	return (
		<div className="w-full h-full p-4 mx-auto flex max-w-lg flex-col gap-4">
			<div>
				<h1 className="text-lg font-medium">{t('home.title')}</h1>
				<p className="text-textcolor/55 mt-1 text-sm">{t('home.desc')}</p>
			</div>
			<ul className="m-0 flex list-none flex-col gap-2 p-0">
				{pages.map((p) => (
					<li key={p.to}>
						<Link
							to={p.to}
							className="border-theme-border bg-theme/5 hover:bg-theme/10 block rounded-md border px-3 py-2.5 transition-colors"
						>
							<div className="text-sm font-medium">{p.title}</div>
							<div className="text-textcolor/45 mt-0.5 text-xs">{p.desc}</div>
							<div className="text-textcolor/35 mt-1 font-mono text-[11px]">
								{p.to}
							</div>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}
