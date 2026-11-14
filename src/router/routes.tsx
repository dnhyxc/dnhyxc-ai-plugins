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
import VocabDetailApp from '@/views/vocab-detail';
import type { PointModule } from '@/views/vocab-detail/point';
import { previewDetail, previewSnapshot } from '@/views/vocab-detail/preview';
import VocabDetailImportApp from '@/views/vocab-detail-import';
import VocabDetailListApp from '@/views/vocab-detail-list';

const ebookPoint: PointModule = {
	getContext: () => ({
		bookId: 'preview-book',
		bookTitle: 'Standalone preview book',
	}),
	getPayload: () => null,
	subscribe: () => () => undefined,
	publishSignal: () => undefined,
	command: () => undefined,
};

const previewPoint: PointModule = {
	getContext: () => ({ libraryId: 'preview-library' }),
	getPayload: (slot) => {
		if (slot === 'drawer') return previewSnapshot;
		if (slot === 'import-drawer') {
			return { libraryId: 'preview-library', title: 'Preview library' };
		}
		return null;
	},
	subscribe: () => () => undefined,
	publishSignal: () => undefined,
	command: (name, arg) => {
		if (name === 'stop') {
			speechSynthesis.cancel();
			return undefined;
		}
		if (name === 'play' && typeof arg === 'string') {
			return new Promise<void>((resolve) => {
				const utter = new SpeechSynthesisUtterance(arg);
				utter.lang = 'en-US';
				utter.onend = () => resolve();
				utter.onerror = () => resolve();
				speechSynthesis.cancel();
				speechSynthesis.speak(utter);
			});
		}
		if (name === 'openCard') return true;
		if (name === 'pickJsonFile') return Promise.resolve(null);
		return undefined;
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
				path: 'english-learning/vocab-detail',
				element: (
					<div className="h-full min-h-112">
						<VocabDetailApp
							api={mockApi({
								http: {
									get: async () => ({
										data: {
											detail: previewDetail,
											source: 'manual',
											ipa: previewSnapshot.ipa,
											pos: previewSnapshot.pos,
											versions: {
												manual: previewDetail,
												generated: {
													...previewDetail,
													memory: { hookZh: '这是之前生成的记忆。' },
												},
												regen: null,
											},
										},
									}),
									post: async (url: string) => {
										if (url.includes('regenerate')) {
											return {
												data: {
													detail: {
														...previewDetail,
														memory: { hookZh: '这是重新生成的记忆。' },
													},
												},
											};
										}
										return { data: { cancelled: true } };
									},
								},
								modules: { point: previewPoint },
							})}
						/>
					</div>
				),
			},
			{
				path: 'english-learning/vocab-detail-list',
				element: (
					<div className="h-full min-h-112">
						<VocabDetailListApp
							api={mockApi({
								http: {
									get: async () => ({
										data: {
											items: [
												{
													lemma: previewDetail.lemma,
													glossZh: previewDetail.senses[0]?.glossZh ?? '',
													updatedAt: new Date().toISOString(),
												},
											],
											nextCursor: null,
											total: 1,
										},
									}),
								},
								modules: { point: previewPoint },
							})}
						/>
					</div>
				),
			},
			{
				path: 'english-learning/vocab-detail-import',
				element: (
					<div className="h-full min-h-112">
						<VocabDetailImportApp
							api={mockApi({
								http: {
									get: async () => ({
										data: {
											items: [
												{
													lemma: previewDetail.lemma,
													glossZh: previewDetail.senses[0]?.glossZh ?? '',
													updatedAt: new Date().toISOString(),
												},
											],
											nextCursor: null,
											total: 1,
										},
									}),
								},
								modules: { point: previewPoint },
							})}
						/>
					</div>
				),
			},
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
						api={mockApi({ modules: { point: ebookPoint } })}
						plugin={mockPlugin('ebookIdeas', '/ebook/plugins/ebook-ideas')}
					/>
				),
			},
			{
				path: 'ebook/plugins/highlights',
				element: (
					<EbookHighlightsApp
						independent
						api={mockApi({ modules: { point: ebookPoint } })}
						plugin={mockPlugin('ebookHighlights', '/ebook/plugins/highlights')}
					/>
				),
			},
			{
				path: 'ebook/plugins/toolbar-test',
				element: (
					<EbookTestBookInfoApp
						independent
						api={mockApi({ modules: { point: ebookPoint } })}
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
