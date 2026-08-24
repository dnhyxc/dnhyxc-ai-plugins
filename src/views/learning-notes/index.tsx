import Loading from '@design/Loading';
import { NotePreview } from '@design/NotePreview';
import {
	Btn,
	type Editor,
	getDocTitleText,
	RichEditor,
	richEditorLocaleOf,
} from '@design/RichEditor';
import {
	Eye,
	FileDown,
	FilePenLine,
	NotebookText,
	Save,
	SquarePen,
	Trash2,
} from 'lucide-react';
import { observer } from 'mobx-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Confirm from '@/components/design/Confirm';
import {
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@/components/ui/resizable';
import { useHostLocale, useI18n } from '@/hooks';
import type { Locale } from '@/i18n';
import { cn } from '@/lib/utils';
import useStore from '@/store';
import type { HostHttp } from './api';
import { LargeNoteEditor, type LargeNoteSaveApi } from './components/Editor';
import { NotesListPanel } from './components/NotesListPanel';
import { WindowedPreviewBody } from './components/PreviewBody';
import { isLargeNoteHtml } from './utils';
import '@/styles.css';

type HostBridgeProps = {
	api: {
		theme: 'light' | 'dark';
		locale?: Locale;
		event?: {
			on: (event: string, handler: (data?: unknown) => void) => void;
			off: (event: string, handler: (data?: unknown) => void) => void;
			emit: (event: string, data?: unknown) => void;
		};
		http?: HostHttp;
		ui?: {
			showToast: (options: {
				message: string;
				type?: 'success' | 'error' | 'info';
			}) => void;
			downloadBlob?: (options: {
				fileName: string;
				data: ArrayBuffer | Uint8Array;
				mimeType?: string;
			}) => Promise<{
				ok: boolean;
				hostToasted: boolean;
				message?: string;
			}>;
		};
	};
	plugin: { id: string; version: string; routePath: string };
	independent?: boolean;
};

function LearningNotesApp({ api }: HostBridgeProps) {
	const { learningNotesStore: store } = useStore();
	const { t, locale } = useI18n();
	useHostLocale(api);

	const editorRef = useRef<Editor | null>(null);
	const pagedSaveRef = useRef<LargeNoteSaveApi | null>(null);
	const savingRef = useRef(false);
	const previewRef = useRef(store.preview);
	const baselineHtmlRef = useRef('');
	const dirtyRef = useRef(false);
	const [readyKey, setReadyKey] = useState<string | null>(null);
	const [mountEditor, setMountEditor] = useState(false);
	const [dirty, setDirty] = useState(false);
	savingRef.current = store.saving;
	previewRef.current = store.preview;

	const toast = useCallback(
		(message: string, type: 'success' | 'error' | 'info' = 'info') => {
			api.ui?.showToast({ message, type });
		},
		[api.ui],
	);

	const currentHtml = useCallback(() => {
		const paged = pagedSaveRef.current;
		if (paged) return paged.getHTML();
		const editor = editorRef.current;
		if (!editor || editor.isDestroyed) return '';
		return editor.getHTML();
	}, []);

	const markClean = useCallback(() => {
		baselineHtmlRef.current = currentHtml();
		dirtyRef.current = false;
		setDirty(false);
	}, [currentHtml]);

	const syncDirty = useCallback(() => {
		const html = currentHtml();
		const nextDirty = html !== baselineHtmlRef.current;
		const wasDirty = dirtyRef.current;
		dirtyRef.current = nextDirty;
		setDirty(nextDirty);
		// 仅在「有改动 → 回到基线」（如上传又删）时结算 pending，避免每次干净态 onChange 打接口
		if (wasDirty && !nextDirty) {
			void store.settleUploadSessionIfNeeded(html);
		}
	}, [currentHtml, store]);

	useEffect(() => {
		store.bind(api.http, toast, t, api.ui?.downloadBlob);
	}, [api.http, api.ui?.downloadBlob, store, toast, t]);

	/** 仅 pagehide（刷新/关页）时 discard；编辑中切后台不处理 */
	useEffect(() => {
		if (store.preview) return;
		const sid = store.uploadSessionId;
		if (!sid) return;

		const onPageHide = () => store.flushUploadSessionOnPageHide(sid);
		window.addEventListener('pagehide', onPageHide);
		return () => window.removeEventListener('pagehide', onPageHide);
	}, [store.preview, store.uploadSessionId, store]);

	const focusTitle = useCallback(() => {
		const editor = editorRef.current;
		if (!editor || editor.isDestroyed) return;
		const root = editor.view.dom.closest('.rich-editor');
		if (!root) return;
		const vp = root.querySelector(
			'[data-slot="scroll-area-viewport"]',
		) as HTMLElement | null;
		if (vp) vp.scrollTop = 0;
		const input = root.querySelector(
			'.rich-editor-note-title input',
		) as HTMLInputElement | null;
		input?.focus();
	}, []);

	const onSave = useCallback(async () => {
		const paged = pagedSaveRef.current;
		if (paged) {
			const title = paged.getTitle();
			const ok = await store.saveNote({
				title,
				text: paged.getText(),
				html: paged.getHTML(),
				dirty,
			});
			if (ok) markClean();
			else if (dirty && !title.trim()) focusTitle();
			return;
		}
		const editor = editorRef.current;
		if (!editor || editor.isDestroyed) return;
		const title = getDocTitleText(editor.state.doc).trim();
		const ok = await store.saveNote({
			title,
			text: editor.getText({ blockSeparator: '\n\n' }).trim(),
			html: editor.getHTML(),
			dirty,
		});
		if (ok) markClean();
		else if (dirty && !title) focusTitle();
	}, [focusTitle, markClean, store, dirty, t]);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
			if (previewRef.current) return;
			e.preventDefault();
			if (savingRef.current) return;
			void onSave();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [onSave]);

	const listToggleBtn = useCallback(
		() => (
			<Btn
				title={
					store.listOpen
						? t('learningNotes.closeList')
						: t('learningNotes.openList')
				}
				onClick={() => store.toggleListOpen()}
			>
				<NotebookText size={15} />
			</Btn>
		),
		[store, store.listOpen, t],
	);

	const toolbarExtra = useMemo(
		() => (
			<>
				<Btn title={t('learningNotes.new')} onClick={() => store.openNew()}>
					<FilePenLine size={15} />
				</Btn>
				<Btn
					title={
						store.saving
							? t('learningNotes.saving')
							: store.editingId
								? t('learningNotes.update')
								: t('learningNotes.save')
					}
					onClick={() => void onSave()}
					disabled={store.saving}
					className="relative"
				>
					<Save size={15} />
					{dirty ? (
						<span
							className="pointer-events-none absolute right-0 top-0 size-2 rounded-full bg-orange-500"
							aria-hidden
						/>
					) : null}
				</Btn>
				{store.editingId ? (
					<Btn
						title={t('learningNotes.preview')}
						onClick={() => {
							const id = store.editingId;
							if (id) void store.openPreview(id);
						}}
					>
						<Eye size={15} />
					</Btn>
				) : null}
				{listToggleBtn()}
			</>
		),
		[dirty, listToggleBtn, onSave, store, store.editingId, store.saving, t],
	);

	const previewOwned = store.preview?.isOwned !== false;
	const previewHeaderExtra = useMemo(
		() => (
			<>
				<Btn title={t('learningNotes.new')} onClick={() => store.openNew()}>
					<FilePenLine size={15} />
				</Btn>
				{previewOwned ? (
					<>
						<Btn
							title={t('learningNotes.edit')}
							disabled={store.loadingDetail}
							onClick={() => {
								if (store.preview) store.openEdit(store.preview);
							}}
						>
							<SquarePen size={15} />
						</Btn>
						<Btn
							title={t('learningNotes.delete')}
							onClick={() => {
								if (store.preview) store.requestDelete(store.preview.id);
							}}
						>
							<Trash2 size={15} />
						</Btn>
						<Btn
							title={
								store.exportingDocx
									? t('learningNotes.exportingDocx')
									: t('learningNotes.exportDocx')
							}
							disabled={store.exportingDocx || store.loadingDetail}
							onClick={() => void store.exportPreviewDocx()}
						>
							<FileDown size={15} />
						</Btn>
					</>
				) : null}
				{listToggleBtn()}
			</>
		),
		[
			listToggleBtn,
			previewOwned,
			store,
			store.exportingDocx,
			store.loadingDetail,
			store.preview,
			t,
		],
	);

	const editorLocale = useMemo(() => richEditorLocaleOf(locale), [locale]);
	const editorKey = `${store.editorSeed}:${locale}`;
	const editorReady = readyKey === editorKey;
	const useLarge = isLargeNoteHtml(store.editorInitial);

	const onUploadImage = useCallback(
		(file: File) => store.uploadNoteImage(file),
		[store],
	);

	// 先画 Loading，下一帧再挂 TipTap，避免长文解析时连遮罩都刷不出来
	useEffect(() => {
		if (store.preview) {
			setMountEditor(false);
			return;
		}
		setMountEditor(false);
		pagedSaveRef.current = null;
		const id = requestAnimationFrame(() => setMountEditor(true));
		return () => cancelAnimationFrame(id);
	}, [editorKey, store.preview]);

	return (
		<div
			className={cn(
				'bg-theme-background text-textcolor flex h-full min-h-0 min-w-0 flex-col text-sm rounded-md',
			)}
		>
			<Confirm
				open={store.confirmOpen}
				onOpenChange={(open) => store.setConfirmOpen(open)}
				title={t('learningNotes.deleteConfirmTitle')}
				description={t('learningNotes.deleteConfirmDesc')}
				onConfirm={() => void store.confirmDelete()}
			/>
			<Confirm
				open={store.visibilityConfirmOpen}
				onOpenChange={(open) => store.setVisibilityConfirmOpen(open)}
				title={
					store.pendingVisibility?.isPublic
						? t('learningNotes.publicConfirmTitle')
						: t('learningNotes.privateConfirmTitle')
				}
				description={
					store.pendingVisibility?.isPublic
						? t('learningNotes.publicConfirmDesc')
						: t('learningNotes.privateConfirmDesc')
				}
				onConfirm={() => void store.confirmVisibility()}
			/>
			<ResizablePanelGroup
				id="learning-notes-split"
				orientation="horizontal"
				className="h-full min-h-0 min-w-0 flex-1"
			>
				{store.listOpen ? (
					<>
						<ResizablePanel
							id="learning-notes-list"
							defaultSize={35}
							minSize={0}
							className="min-h-0 min-w-0 overflow-hidden!"
						>
							<NotesListPanel locale={locale} />
						</ResizablePanel>
						<ResizableHandle withHandle className="w-0 -translate-x-px" />
					</>
				) : null}
				<ResizablePanel
					id="learning-notes-editor"
					defaultSize={store.listOpen ? 65 : 100}
					minSize={0}
					className="min-h-0 min-w-0 overflow-hidden!"
				>
					<div className="border-theme/10 relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
						{!store.preview ? (
							<>
								{mountEditor ? (
									useLarge && typeof store.editorInitial === 'string' ? (
										<LargeNoteEditor
											key={editorKey}
											defaultContent={store.editorInitial}
											placeholder={t('learningNotes.placeholder')}
											locale={editorLocale}
											onUploadImage={onUploadImage}
											onReady={(e, save) => {
												editorRef.current = e;
												pagedSaveRef.current = save;
												baselineHtmlRef.current = save.getHTML();
												setDirty(false);
												setReadyKey(editorKey);
											}}
											onChange={syncDirty}
											className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
											editorClassName="min-h-[6rem]"
											toolbarExtra={toolbarExtra}
										/>
									) : (
										<RichEditor
											key={editorKey}
											defaultContent={store.editorInitial}
											autofocus="end"
											placeholder={t('learningNotes.placeholder')}
											locale={editorLocale}
											showCharCount={false}
											onUploadImage={onUploadImage}
											onCreate={(e) => {
												editorRef.current = e;
												pagedSaveRef.current = null;
												baselineHtmlRef.current = e.getHTML();
												setDirty(false);
												setReadyKey(editorKey);
											}}
											onChange={syncDirty}
											className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
											editorClassName="min-h-[6rem]"
											toolbarExtra={toolbarExtra}
										/>
									)
								) : null}
								{!editorReady ? (
									<div className="rounded-md absolute inset-0 z-10 flex items-center justify-center">
										<Loading />
									</div>
								) : null}
							</>
						) : (
							<div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden contain-[layout_paint]">
								{isLargeNoteHtml(store.preview.html) ? (
									<NotePreview
										title={store.preview.title}
										headerExtra={previewHeaderExtra}
										loading={store.loadingDetail}
										downloadBlob={api.ui?.downloadBlob}
									>
										<WindowedPreviewBody
											key={store.preview.id}
											html={store.preview.html}
											downloadBlob={api.ui?.downloadBlob}
										/>
									</NotePreview>
								) : (
									<NotePreview
										title={store.preview.title}
										html={store.preview.html}
										headerExtra={previewHeaderExtra}
										loading={store.loadingDetail}
										downloadBlob={api.ui?.downloadBlob}
									/>
								)}
								{store.loadingDetail ? (
									<div className="w-full h-full absolute inset-0 z-10 flex items-center justify-center">
										<Loading />
									</div>
								) : null}
							</div>
						)}
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		</div>
	);
}

LearningNotesApp.activate = async (api: HostBridgeProps['api']) => {
	console.log('[learning-notes] activate', api);
};

LearningNotesApp.deactivate = () => {
	console.log('[learning-notes] deactivate');
};

export default observer(LearningNotesApp);
