export type VocabCardSnapshot = {
	word: string;
	pos?: string | null;
	ipa?: string | null;
	translationZh?: string | null;
	example?: string | null;
	/** 宿主写入：list 用整页 Loading，card 保持词头。 */
	source?: 'card' | 'list';
};

export type VocabDetail = {
	lemma: string;
	morphology: {
		parts: { form: string; kind: string; meaningZh: string }[];
		storyZh: string;
	};
	memory: { hookZh: string };
	senses: { pos: string; glossZh: string; nuanceZh: string }[];
	examples: { en: string; zh: string }[];
	family: { word: string; pos: string; glossZh: string }[];
	collocations: { phrase: string; glossZh: string }[];
	synonyms: { word: string; pos: string; glossZh: string }[];
	tags: string[];
};
