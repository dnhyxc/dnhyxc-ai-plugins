import type { VocabCardSnapshot, VocabDetail } from './types';

export const previewSnapshot: VocabCardSnapshot = {
	word: 'toilsome',
	pos: 'adj.',
	ipa: '/ˈtɔɪlsəm/',
	translationZh: '辛苦的；劳苦的；费力的',
	example: 'The consequences of this decision could be toilsome.',
};

export const previewDetail: VocabDetail = {
	lemma: 'toilsome',
	morphology: {
		parts: [
			{ form: 'toil', kind: 'base', meaningZh: '辛劳' },
			{ form: '-some', kind: 'suffix', meaningZh: '易于…的' },
		],
		storyZh: '辛劳，再加上“易于…的”。',
	},
	memory: { hookZh: 'toil 是劳苦，后面再加一些，就是很费力。' },
	senses: [
		{
			pos: 'adj.',
			glossZh: '费力的，劳苦的',
			nuanceZh: '多形容工作、路程或后果，不用于轻松的小事。',
		},
	],
	examples: [
		{
			en: 'The consequences of this decision could be toilsome.',
			zh: '这个决定的后果可能会很费力。',
		},
	],
	family: [{ word: 'toil', pos: 'n.', glossZh: '苦工' }],
	collocations: [{ phrase: 'toilsome work', glossZh: '费力的工作' }],
	synonyms: [{ word: 'laborious', pos: 'adj.', glossZh: '吃力的' }],
	tags: ['CET-6'],
};
