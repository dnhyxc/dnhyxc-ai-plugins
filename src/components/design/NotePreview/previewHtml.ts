/**
 * 去掉文档内嵌的 title 节点。
 * ponytail: 大文档（含 base64 图）用正则，避免 DOMParser 整树解析卡死主线程。
 * title 的 renderHTML 是单层 div，无嵌套同名闭合问题。
 */
export function stripNoteTitleHtml(html: string): string {
	if (!html) return '';
	return html.replace(
		/<div\b[^>]*\bdata-type=["']note-title["'][^>]*>[\s\S]*?<\/div>/i,
		'',
	);
}

/**
 * 空段落补 `<br>`，与 TipTap 编辑态占位一致（纯 `<p></p>` 在静态 HTML 高度会塌掉）。
 */
export function preserveEmptyParagraphs(html: string): string {
	if (!html) return '';
	return html.replace(
		/<p(\b[^>]*)>(?:\s|&nbsp;|\u00a0)*<\/p>/gi,
		'<p$1><br></p>',
	);
}

const IMG_RADIUS = 'border-radius: 0.5rem';
const IMG_MARGIN = 'margin: 0.75em 0';
const IMG_MARGIN_FLUSH_TOP = 'margin: 0 0 0.75em';

/** 正文是否以 `<img` 开头（忽略前导空白） */
export function startsWithImg(html: string): boolean {
	return /^\s*<img\b/i.test(html);
}

/** 写入/覆盖 style 里的 margin 与 border-radius */
function withImgInlineStyle(attrs: string, marginDecl: string): string {
	const styleValue = `${marginDecl}; ${IMG_RADIUS}`;
	if (/\bstyle\s*=\s*"/i.test(attrs)) {
		return attrs.replace(/\bstyle\s*=\s*"([^"]*)"/i, (_m, raw: string) => {
			const rest = raw
				.replace(/\bmargin\s*:[^;]*;?/gi, '')
				.replace(/\bborder-radius\s*:[^;]*;?/gi, '')
				.trim()
				.replace(/^;+|;+$/g, '')
				.trim();
			return `style="${rest ? `${styleValue}; ${rest}` : styleValue}"`;
		});
	}
	if (/\bstyle\s*=\s*'/i.test(attrs)) {
		return attrs.replace(/\bstyle\s*=\s*'([^']*)'/i, (_m, raw: string) => {
			const rest = raw
				.replace(/\bmargin\s*:[^;]*;?/gi, '')
				.replace(/\bborder-radius\s*:[^;]*;?/gi, '')
				.trim()
				.replace(/^;+|;+$/g, '')
				.trim();
			return `style='${rest ? `${styleValue}; ${rest}` : styleValue}'`;
		});
	}
	return `${attrs} style="${styleValue}"`;
}

export type DecoratePreviewHtmlOptions = {
	/**
	 * 为 true 且正文以图开头时，首张图 margin-top: 0。
	 * 长文窗口 origin>0 时须传 false，避免窗口首图误当成文档首图。
	 */
	flushLeadingImg?: boolean;
};

/** 预览图：懒加载 + 内联 margin/圆角（不依赖 MF @scope 下的 stylesheet） */
export function decoratePreviewHtml(
	html: string,
	opts?: DecoratePreviewHtmlOptions,
): string {
	if (!html) return '';
	const flushLeading = opts?.flushLeadingImg !== false && startsWithImg(html);
	let isFirst = true;
	return html.replace(/<img\b([^>]*)>/gi, (_full, attrs: string) => {
		let next = attrs;
		if (!/\bloading\s*=/i.test(next)) next += ' loading="lazy"';
		if (!/\bdecoding\s*=/i.test(next)) next += ' decoding="async"';
		const flushTop = flushLeading && isFirst;
		isFirst = false;
		next = withImgInlineStyle(
			next,
			flushTop ? IMG_MARGIN_FLUSH_TOP : IMG_MARGIN,
		);
		return `<img${next}>`;
	});
}

/**
 * 按顶层开闭标签切开（笔记多为扁平 p/h/ul/table）。
 * ponytail: 嵌套同名标签可能切不准；失败时调用方回退整段挂载。
 */
export function splitPreviewBlocks(html: string): string[] {
	if (!html) return [];
	const blocks: string[] = [];
	const re = /<([a-z][a-z0-9]*)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/gi;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		if (m.index > last) {
			const gap = html.slice(last, m.index).trim();
			if (gap) blocks.push(gap);
		}
		blocks.push(m[0]);
		last = m.index + m[0].length;
	}
	if (last < html.length) {
		const tail = html.slice(last).trim();
		if (tail) blocks.push(tail);
	}
	return blocks.length ? blocks : [html];
}

/** 预览正文：去 title、保留空行（与编辑态一致），图懒加载 + 首图顶距 */
export function preparePreviewBody(html: string): string {
	return decoratePreviewHtml(preserveEmptyParagraphs(stripNoteTitleHtml(html)));
}
