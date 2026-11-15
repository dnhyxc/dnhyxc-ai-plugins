import type { VocabCardSnapshot } from './types';

/** 主站按插件的 host.surface 下发的唯一模块。 */
export type PointModule = {
	getContext: () => Record<string, unknown> | null;
	getPayload: (slot: string) => Record<string, unknown> | null;
	subscribe: (listener: () => void) => () => void;
	publishSignal: (name: string, value: unknown) => void;
	command: (name: string, arg?: unknown) => unknown;
};

export function cardFromPayload(
	payload: Record<string, unknown> | null,
): VocabCardSnapshot | null {
	if (!payload || typeof payload.word !== 'string' || !payload.word.trim()) {
		return null;
	}
	return {
		word: payload.word,
		pos: typeof payload.pos === 'string' ? payload.pos : null,
		ipa: typeof payload.ipa === 'string' ? payload.ipa : null,
		translationZh:
			typeof payload.translationZh === 'string' ? payload.translationZh : null,
		example: typeof payload.example === 'string' ? payload.example : null,
		source: payload.source === 'list' ? 'list' : 'card',
	};
}

export function libraryIdFromContext(
	context: Record<string, unknown> | null | undefined,
): string {
	const libraryId = context?.libraryId;
	return typeof libraryId === 'string' ? libraryId : '';
}

export type ImportTarget =
	| { scope: 'dailyReading' }
	| { scope: 'library'; libraryId: string; title: string };

export function importTargetFromPayload(
	payload: Record<string, unknown> | null,
): ImportTarget | null {
	if (payload?.scope === 'dailyReading') return { scope: 'dailyReading' };
	if (!payload || typeof payload.libraryId !== 'string' || !payload.libraryId) {
		return null;
	}
	return {
		scope: 'library',
		libraryId: payload.libraryId,
		title: typeof payload.title === 'string' ? payload.title : '',
	};
}
