import { useEffect, useState } from 'react';

/** 阅读页按 host.surface = ebook.read 下发的扩展点。 */
export type PointModule = {
	getContext: () => Record<string, unknown> | null;
	getPayload: (slot: string) => Record<string, unknown> | null;
	subscribe: (listener: () => void) => () => void;
	publishSignal: (name: string, value: unknown) => void;
	command: (name: string, arg?: unknown) => unknown;
};

function bookFromContext(ctx: Record<string, unknown> | null): {
	bookId: string;
	bookTitle: string;
} {
	return {
		bookId: typeof ctx?.bookId === 'string' ? ctx.bookId : '',
		bookTitle: typeof ctx?.bookTitle === 'string' ? ctx.bookTitle : '',
	};
}

export function useBookPoint(point: PointModule | undefined): {
	bookId: string;
	bookTitle: string;
} {
	const [book, setBook] = useState({ bookId: '', bookTitle: '' });
	useEffect(() => {
		if (!point) return;
		const pull = () => setBook(bookFromContext(point.getContext()));
		pull();
		return point.subscribe(pull);
	}, [point]);
	return point ? book : { bookId: '', bookTitle: '' };
}
