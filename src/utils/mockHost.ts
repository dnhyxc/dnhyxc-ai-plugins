/** 独立预览用假 HostBridge；嵌入主站时由 Host 注入真 api */

const DOCX_MIME =
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

type PickLocalFilesOptions = {
	accept?: string;
	multiple?: boolean;
	title?: string;
};

type HostPickedLocalFile = {
	path: string;
	name: string;
	src: string;
};

/** 独立预览无 Tauri：用浏览器 `<a download>` 模拟 Host downloadBlob */
async function mockDownloadBlob(options: {
	fileName: string;
	data: ArrayBuffer | Uint8Array;
	mimeType?: string;
}): Promise<{ ok: boolean; hostToasted: boolean; message?: string }> {
	try {
		const bytes =
			options.data instanceof ArrayBuffer
				? new Uint8Array(options.data)
				: new Uint8Array(options.data);
		const blob = new Blob([bytes], {
			type: options.mimeType?.trim() || DOCX_MIME,
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = options.fileName || 'download';
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
		return { ok: true, hostToasted: false };
	} catch (e) {
		return {
			ok: false,
			hostToasted: false,
			message: e instanceof Error ? e.message : String(e),
		};
	}
}

/** 独立预览：input 模拟 Host pickLocalFiles */
function mockPickLocalFiles(
	options?: PickLocalFilesOptions,
): Promise<HostPickedLocalFile[] | null> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		if (options?.accept?.trim()) input.accept = options.accept.trim();
		input.multiple = options?.multiple === true;
		input.style.display = 'none';
		document.body.appendChild(input);
		const cleanup = () => input.remove();
		input.addEventListener('change', () => {
			const list = Array.from(input.files ?? []);
			cleanup();
			if (!list.length) {
				resolve(null);
				return;
			}
			resolve(
				list.map((f) => ({
					path: f.name,
					name: f.name,
					src: URL.createObjectURL(f),
				})),
			);
		});
		input.addEventListener('cancel', () => {
			cleanup();
			resolve(null);
		});
		input.click();
	});
}

export function mockApi(extra?: Record<string, unknown>) {
	return {
		theme: 'light' as const,
		// 不传 locale：独立预览用本地 useI18n；插件模式由 Host 注入
		event: {
			on: () => undefined,
			off: () => undefined,
			emit: () => undefined,
		},
		ui: {
			showToast: (o: { message: string }) => console.info('[toast]', o.message),
			downloadBlob: mockDownloadBlob,
			pickLocalFiles: mockPickLocalFiles,
		},
		...extra,
	};
}

export function mockPlugin(id: string, routePath: string, version = '1.0.0') {
	return { id, version, routePath };
}
