import { Link, type RouteObject } from 'react-router';
import Layout from '@/layout';
import { mockApi, mockPlugin } from '@/utils/mockHost';
import EbookHighlightsApp from '@/views/ebook/highlights';
import IdeasListApp from '@/views/ebook/ideas';
import EbookTestBookInfoApp from '@/views/ebook/toolbar-test/book-info';
import { EmbedIdeasList, EmbedLearningNotes } from '@/views/embed';
import Home from '@/views/home';
import LearningNotesApp from '@/views/learning-notes';
import VideoPlayerApp from '@/views/video-player';

const mockEbookModules = {
	ebook: {
		getBookId: () => 'preview-book',
		getBookTitle: () => 'Standalone preview book',
		navigateToCfi: () => undefined,
		openThought: () => undefined,
		closeIdeasList: () => undefined,
	},
};

/** 独立预览路由；path 与主站 registry / 业务树对齐 */
export const routes: RouteObject[] = [
	{
		path: '/',
		element: <Layout />,
		children: [
			{ index: true, element: <Home /> },
			{
				path: 'english-learning/notes',
				element: (
					<LearningNotesApp
						independent
						api={mockApi()}
						plugin={mockPlugin('learningNotes', '/english-learning/notes')}
					/>
				),
			},
			{
				path: 'ebook/plugins/ideas-list',
				element: (
					<IdeasListApp
						independent
						api={mockApi({ modules: mockEbookModules })}
						plugin={mockPlugin('ebookIdeas', '/ebook/plugins/ebook-ideas')}
					/>
				),
			},
			{
				path: 'ebook/plugins/highlights',
				element: (
					<EbookHighlightsApp
						independent
						api={mockApi({ modules: mockEbookModules })}
						plugin={mockPlugin('ebookHighlights', '/ebook/plugins/highlights')}
					/>
				),
			},
			{
				path: 'ebook/plugins/toolbar-test',
				element: (
					<EbookTestBookInfoApp
						independent
						api={mockApi({ modules: mockEbookModules })}
						plugin={mockPlugin(
							'ebookTestBookInfo',
							'/ebook/plugins/toolbar-test',
						)}
					/>
				),
			},
			{
				path: 'video-player',
				element: (
					<div className="h-full min-h-0">
						<VideoPlayerApp
							independent
							api={mockApi()}
							plugin={mockPlugin('videoPlayer', '/video-player')}
						/>
					</div>
				),
			},
			{
				path: '*',
				element: (
					<p className="text-textcolor/55 text-sm">
						页面不存在，回{' '}
						<Link className="text-theme underline" to="/">
							首页
						</Link>
					</p>
				),
			},
		],
	},
	{
		path: '/embed/ebook/plugins/ideas-list',
		element: <EmbedIdeasList />,
	},
	{
		path: '/embed/english-learning/notes',
		element: <EmbedLearningNotes />,
	},
];
