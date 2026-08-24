import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import {
	clipboardHasTextContent,
	clipboardImageFiles,
	dataTransferImageFiles,
	fileToDataUrl,
	insertImages,
	isImageFile,
	type ResolveImageSrc,
} from './image';

export type ImageUploadOptions = {
	/** 可变引用：始终读最新上传实现（默认 FileReader → data URL） */
	resolveSrcRef: { current: ResolveImageSrc };
};

/** Host（Tauri）粘贴本地图时派发，detail.files 为 File[] */
export const DESKTOP_PASTE_IMAGES_EVENT = 'rich-editor:desktop-paste-images';

/**
 * 粘贴 / 拖放本地图片到编辑器。
 * ponytail: 通过 ref 读上传函数，避免 useEditor 扩展不随 props 重建。
 * 桌面端 Host 拦截 Cmd+V 后通过 DESKTOP_PASTE_IMAGES_EVENT 交回本扩展上传。
 */
export const ImageUpload = Extension.create<ImageUploadOptions>({
	name: 'imageUpload',

	addOptions() {
		return {
			resolveSrcRef: { current: fileToDataUrl },
		};
	},

	addProseMirrorPlugins() {
		const editor = this.editor;
		const { resolveSrcRef } = this.options;

		return [
			new Plugin({
				key: new PluginKey('imageUpload'),
				view(editorView) {
					const onDesktopPaste = (e: Event) => {
						const ce = e as CustomEvent<{ files?: File[] }>;
						const files = (ce.detail?.files ?? []).filter(isImageFile);
						if (!files.length) return;
						ce.preventDefault();
						ce.stopPropagation();
						void insertImages(editor, files, (f) => resolveSrcRef.current(f));
					};
					editorView.dom.addEventListener(
						DESKTOP_PASTE_IMAGES_EVENT,
						onDesktopPaste,
					);
					return {
						destroy() {
							editorView.dom.removeEventListener(
								DESKTOP_PASTE_IMAGES_EVENT,
								onDesktopPaste,
							);
						},
					};
				},
				props: {
					handlePaste(_view, event) {
						const files = clipboardImageFiles(event);
						if (!files.length) return false;
						// 剪贴板同时含图片与文本/HTML：让 ProseMirror 先完成默认文本粘贴，
						// 再异步插入图片（insertImages 读图是异步的，会在默认粘贴落盘后执行）
						if (clipboardHasTextContent(event)) {
							void insertImages(editor, files, (f) => resolveSrcRef.current(f));
							return false;
						}
						// 仅有图片（如截图）：阻止默认行为，只插入图片
						event.preventDefault();
						void insertImages(editor, files, (f) => resolveSrcRef.current(f));
						return true;
					},
					handleDrop(_view, event, _slice, moved) {
						if (moved) return false;
						const files = dataTransferImageFiles(event.dataTransfer);
						if (!files.length) return false;
						event.preventDefault();
						void insertImages(editor, files, (f) => resolveSrcRef.current(f));
						return true;
					},
				},
			}),
		];
	},
});
