import {
	type ComponentProps,
	type ComponentType,
	useEffect,
	useState,
} from 'react';
import { useI18n } from '@/hooks';
import { connectIframeHost } from '@/utils/iframeHostClient';
import IdeasListApp from '@/views/ebook/ideas';
import LearningNotesApp from '@/views/learning-notes';

type Bridge = {
	api: ComponentProps<typeof IdeasListApp>['api'];
	plugin: ComponentProps<typeof IdeasListApp>['plugin'];
};

function applyBodyTheme(theme: 'light' | 'dark') {
	document.documentElement.classList.toggle('dark', theme === 'dark');
	document.body.classList.toggle('dark', theme === 'dark');
}

function EmbedShell({
	pluginId,
	App,
}: {
	pluginId: string;
	App: ComponentType<Bridge>;
}) {
	const { t } = useI18n();
	const [bridge, setBridge] = useState<Bridge | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void connectIframeHost(pluginId)
			.then((b) => {
				if (!cancelled) setBridge(b as Bridge);
			})
			.catch((e) => {
				if (!cancelled) {
					setError(e instanceof Error ? e.message : String(e));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [pluginId]);

	useEffect(() => {
		if (!bridge) return;
		applyBodyTheme(bridge.api.theme);
	}, [bridge]);

	if (error) {
		return <div className="text-destructive h-full p-3 text-sm">{error}</div>;
	}
	if (!bridge) {
		return (
			<div className="text-textcolor/55 h-full p-3 text-sm">
				{t('common.connectingHost')}
			</div>
		);
	}

	return (
		<div className="h-full min-h-0">
			<App {...bridge} />
		</div>
	);
}

export function EmbedIdeasList() {
	return <EmbedShell pluginId="ebookIdeas" App={IdeasListApp} />;
}

export function EmbedLearningNotes() {
	return <EmbedShell pluginId="learningNotes" App={LearningNotesApp} />;
}
