import { translateSync } from '@/i18n';
import type { VocabDetail } from './types';

type HostHttp = {
	get: (url: string) => Promise<unknown>;
	post?: (url: string, body?: unknown) => Promise<unknown>;
};

export type VersionSource = 'manual' | 'generated' | 'regen';

export type VocabVersions = {
	manual: VocabDetail | null;
	generated: VocabDetail | null;
	regen: VocabDetail | null;
};

export type VocabDetailPayload = {
	detail: VocabDetail;
	ipa: string;
	pos: string;
	source: VersionSource;
	versions: VocabVersions;
};

function asText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function unwrap(res: unknown): {
	detail?: VocabDetail;
	ipa?: unknown;
	pos?: unknown;
	cancelled?: unknown;
	miss?: unknown;
	source?: unknown;
	versions?: unknown;
} {
	const body =
		res && typeof res === 'object' && 'data' in res
			? (res as { data: unknown }).data
			: res;
	if (!body || typeof body !== 'object') return {};
	return body as {
		detail?: VocabDetail;
		ipa?: unknown;
		pos?: unknown;
		cancelled?: unknown;
		miss?: unknown;
		source?: unknown;
		versions?: unknown;
	};
}

function asDetail(value: unknown): VocabDetail | null {
	if (!value || typeof value !== 'object') return null;
	const detail = value as VocabDetail;
	return detail.memory?.hookZh ? detail : null;
}

function asVersions(value: unknown): VocabVersions {
	const row =
		value && typeof value === 'object'
			? (value as Partial<Record<VersionSource, unknown>>)
			: {};
	return {
		manual: asDetail(row.manual),
		generated: asDetail(row.generated),
		regen: asDetail(row.regen),
	};
}

function asSource(value: unknown, versions: VocabVersions): VersionSource {
	if (value === 'regen' || value === 'manual' || value === 'generated') {
		return versions[value] ? value : fallbackSource(versions);
	}
	return fallbackSource(versions);
}

function fallbackSource(versions: VocabVersions): VersionSource {
	if (versions.regen) return 'regen';
	if (versions.manual) return 'manual';
	return 'generated';
}

export function errorMessage(cause: unknown): string {
	if (cause instanceof Error && cause.message.trim()) return cause.message;
	if (cause && typeof cause === 'object' && 'message' in cause) {
		const message = (cause as { message?: unknown }).message;
		if (typeof message === 'string' && message.trim()) return message;
	}
	return translateSync('vocabDetail.loadFailed');
}

export type VocabDetailResult =
	| { cancelled: true }
	| ({ cancelled?: false } & VocabDetailPayload);

function parseVocabDetailResult(
	body: ReturnType<typeof unwrap>,
): VocabDetailResult {
	if (body.cancelled === true) return { cancelled: true };
	const detail = body.detail;
	if (!detail?.memory?.hookZh) {
		throw new Error(translateSync('vocabDetail.loadFailed'));
	}
	const versions = asVersions(body.versions);
	return {
		detail,
		ipa: asText(body.ipa),
		pos: asText(body.pos),
		source: asSource(body.source, versions),
		versions,
	};
}

export async function getVocabDetail(
	http: HostHttp,
	word: string,
): Promise<VocabDetailResult> {
	const res = await http.get(
		`/english-learning/vocab-detail?word=${encodeURIComponent(word)}`,
	);
	return parseVocabDetailResult(unwrap(res));
}

/** 只读已有解析，不打模型。没有则 miss。 */
export async function peekVocabDetail(
	http: HostHttp,
	word: string,
): Promise<VocabDetailResult | { miss: true }> {
	const res = await http.get(
		`/english-learning/vocab-detail?word=${encodeURIComponent(word)}&peek=1`,
	);
	const body = unwrap(res);
	if (body.miss === true) return { miss: true };
	return parseVocabDetailResult(body);
}

/** 再打一次模型。结果只写入重新生成，不改手动导入和全站缓存。 */
export async function regenerateVocabDetail(
	http: HostHttp,
	word: string,
): Promise<VocabDetailResult> {
	if (!http.post) throw new Error(translateSync('vocabDetail.loadFailed'));
	const res = await http.post(
		`/english-learning/vocab-detail/regenerate?word=${encodeURIComponent(word)}`,
		{},
	);
	const body = unwrap(res);
	if (body.cancelled === true) return { cancelled: true };
	const detail = asDetail(body.detail);
	if (!detail) throw new Error(translateSync('vocabDetail.loadFailed'));
	return {
		detail,
		ipa: '',
		pos: '',
		source: 'regen',
		versions: { manual: null, generated: null, regen: detail },
	};
}

/** 让后端 abort 这一词正在进行的模型调用。关掉面板不会走这里。 */
export function cancelVocabDetail(
	http: HostHttp,
	word: string,
	scope?: 'regen',
): void {
	const extra = scope === 'regen' ? '&scope=regen' : '';
	void http
		.post?.(
			`/english-learning/vocab-detail/cancel?word=${encodeURIComponent(word)}${extra}`,
			{},
		)
		?.catch(() => {
			// 失败时宿主会 Toast。这里接住拒绝，避免生成请求还在飞时多一条未处理异常。
		});
}

const flights = new Map<string, Promise<VocabDetailResult>>();
const generatingKeys = new Set<string>();

function flightKey(word: string): string {
	return word.trim().replace(/\s+/g, ' ').toLowerCase();
}

type LoadHooks = {
	setPending?: (pending: boolean) => void;
	setGenerating?: (generating: boolean) => void;
};

/** 先 peek 缓存；没有再生成。同词在途复用。关掉面板不会取消。点停止才断开模型。 */
export function loadVocabDetail(
	http: HostHttp,
	word: string,
	hooks?: LoadHooks | ((pending: boolean) => void),
): Promise<VocabDetailResult> {
	const { setPending, setGenerating } =
		typeof hooks === 'function' ? { setPending: hooks } : (hooks ?? {});
	const key = flightKey(word);
	const existing = flights.get(key);
	if (existing) {
		setPending?.(true);
		setGenerating?.(generatingKeys.has(key));
		return existing.finally(() => {
			setPending?.(false);
			setGenerating?.(false);
		});
	}
	setPending?.(true);
	const job = (async () => {
		const peeked = await peekVocabDetail(http, word);
		if (!('miss' in peeked)) return peeked;
		generatingKeys.add(key);
		setGenerating?.(true);
		try {
			return await getVocabDetail(http, word);
		} finally {
			generatingKeys.delete(key);
			setGenerating?.(false);
		}
	})().finally(() => {
		flights.delete(key);
		setPending?.(false);
	});
	flights.set(key, job);
	return job;
}
