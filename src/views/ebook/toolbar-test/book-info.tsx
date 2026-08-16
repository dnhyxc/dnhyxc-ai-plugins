import { Button } from '@ui/index';
import { useHostLocale, useI18n } from '@/hooks';
import { cn } from '@/lib/utils';
import '@/styles.css';
import { type EbookTestBridgeProps, readEbookModules } from './bridge';

/** 阅读页 Host 槽测试：toolbar 内联展示书名/Id + Toast */
function EbookTestBookInfoApp({ api }: EbookTestBridgeProps) {
	const { t } = useI18n();
	useHostLocale(api);

	const ebook = readEbookModules(api);
	const bookId = ebook?.getBookId() ?? null;
	const bookTitle = ebook?.getBookTitle() ?? '';
	const label = bookTitle || bookId || t('ebookTest.bookInfo.unbound');

	return (
		<div
			className={cn(
				'box-border flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md',
				'border border-theme/10 bg-theme/5 px-2 text-xs',
			)}
			title={bookId ? `${bookTitle}\n${bookId}` : undefined}
		>
			<span className="text-textcolor/80 min-w-0 truncate font-mono">
				{label}
			</span>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-6 shrink-0 px-1.5 text-xs"
				onClick={() =>
					api.ui?.showToast({
						type: 'info',
						message: bookId
							? t('ebookTest.bookInfo.toastOk', { id: bookId })
							: t('ebookTest.bookInfo.toastUnbound'),
					})
				}
			>
				{t('ebookTest.bookInfo.ping')}
			</Button>
		</div>
	);
}

EbookTestBookInfoApp.activate = async (api: EbookTestBridgeProps['api']) => {
	console.log('[ebook-test-book-info] activate', api);
};

EbookTestBookInfoApp.deactivate = () => {
	console.log('[ebook-test-book-info] deactivate');
};

export default EbookTestBookInfoApp;
