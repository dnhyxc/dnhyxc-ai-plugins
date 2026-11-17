export type ReadingWordSource = {
	readingId: string;
	titleEn: string;
	titleZh: string;
	sentence: string;
	surface: 'selection' | 'gloss' | 'glossary';
	collectedAt: string;
};

export type ReadingWord = {
	id: string;
	word: string;
	wordKey: string;
	zh: string;
	zhEdited: boolean;
	sources: ReadingWordSource[];
	updatedAt: string;
};

export type ReadingSource = {
	readingId: string;
	titleEn: string;
	titleZh: string;
	count: number;
	collectedAt: string;
};

export type WordPage = {
	items: ReadingWord[];
	total: number;
	nextCursor: string | null;
};

type HostHttp = {
	get: (url: string) => Promise<unknown>;
	put?: (url: string, body?: unknown) => Promise<unknown>;
};

const ROOT = '/english-learning/daily-reading-words';

function unwrap<T>(res: unknown): T {
	if (res && typeof res === 'object' && 'data' in res) {
		return (res as { data: T }).data;
	}
	return res as T;
}

export async function readingTitle(
	http: HostHttp,
	id: string,
): Promise<{ titleEn: string; titleZh: string }> {
	const data = unwrap<{ titleEn?: unknown; titleZh?: unknown } | null>(
		await http.get(
			`/english-learning/daily-readings/${encodeURIComponent(id)}`,
		),
	);
	return {
		titleEn: typeof data?.titleEn === 'string' ? data.titleEn.trim() : '',
		titleZh: typeof data?.titleZh === 'string' ? data.titleZh.trim() : '',
	};
}

export async function listSources(http: HostHttp): Promise<ReadingSource[]> {
	const data = unwrap<ReadingSource[] | null>(
		await http.get(`${ROOT}/sources`),
	);
	return Array.isArray(data) ? data : [];
}

export async function listWords(
	http: HostHttp,
	query: { readingId: string; q: string; cursor: string },
): Promise<WordPage> {
	const params = new URLSearchParams();
	if (query.readingId) params.set('readingId', query.readingId);
	if (query.q) params.set('q', query.q);
	if (query.cursor) params.set('cursor', query.cursor);
	const suffix = params.toString();
	const data = unwrap<WordPage | null>(
		await http.get(`${ROOT}/words${suffix ? `?${suffix}` : ''}`),
	);
	return {
		items: Array.isArray(data?.items) ? data.items : [],
		total: typeof data?.total === 'number' ? data.total : 0,
		nextCursor: data?.nextCursor ?? null,
	};
}

export async function saveWordZh(
	http: HostHttp,
	id: string,
	zh: string,
): Promise<ReadingWord> {
	if (!http.put) throw new Error('no put');
	return unwrap<ReadingWord>(
		await http.put(`${ROOT}/${encodeURIComponent(id)}`, { zh }),
	);
}
