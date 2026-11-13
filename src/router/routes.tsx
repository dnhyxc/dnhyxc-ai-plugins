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
import { previewDetail, previewSnapshot } from '@/views/vocab-detail/preview';
import VocabDetailImportApp from '@/views/vocab-detail-import';
import VocabDetailListApp from '@/views/vocab-detail-list';

const mockEbookModules = {
	ebook: {
		getBookId: () => 'preview-book',
		getBookTitle: () => 'Standalone preview book',
		navigateToCfi: () => undefined,
		openThought: () => undefined,
		closeIdeasList: () => undefined,
	},
};

const mockVocabDetailModule = {
	getSnapshot: () => previewSnapshot,
	subscribeVocabDetail: () => () => undefined,
	play: (text: string) =>
		new Promise<void>((resolve) => {
			const utter = new SpeechSynthesisUtterance(text);
			utter.lang = 'en-US';
			utter.onend = () => resolve();
			utter.onerror = () => resolve();
			speechSynthesis.cancel();
			speechSynthesis.speak(utter);
		}),
	stop: () => speechSynthesis.cancel(),
	open: () => true,
	setListStats: () => undefined,
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
					<div className="h-full min-h-[28rem]">
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
								modules: { vocabDetail: mockVocabDetailModule },
							})}
						/>
					</div>
				),
			},
			{
				path: 'english-learning/vocab-detail-list',
				element: (
					<div className="h-full min-h-[28rem]">
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
								modules: { vocabDetail: mockVocabDetailModule },
							})}
						/>
					</div>
				),
			},
			{
				path: 'english-learning/vocab-detail-import',
				element: (
					<div className="h-full min-h-[28rem]">
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
								modules: {
									vocabDetailImport: {
										getTarget: () => ({
											libraryId: 'preview-library',
											title: 'Preview library',
										}),
										subscribe: () => () => undefined,
									},
								},
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
