import fs from 'node:fs';
import path from 'node:path';
import { federation } from '@module-federation/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** MF mf_owner id 递增后 .vite/deps 会失效，serve 时清缓存 */
function clearMfViteDepCache(): Plugin {
	return {
		name: 'clear-mf-vite-dep-cache',
		enforce: 'pre',
		config(config, { command }) {
			if (command !== 'serve') return;
			const root = config.root ? path.resolve(config.root) : process.cwd();
			fs.rmSync(path.join(root, 'node_modules/.vite'), {
				recursive: true,
				force: true,
			});
		},
	};
}

const host = '127.0.0.1';
const port = 9008;
const devOrigin = `http://${host}:${port}`;

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	const origin = env.VITE_REMOTE_PUBLIC_ORIGIN || devOrigin;
	const reactRefreshHost =
		env.VITE_REACT_REFRESH_HOST || 'http://127.0.0.1:9002';

	return {
		base: `${origin}/`,
		plugins: [
			clearMfViteDepCache(),
			react({
				reactRefreshHost,
			}),
			tailwindcss(),
			federation({
				name: 'dnhyxc-ai-plugins',
				filename: 'remoteEntry.js',
				manifest: true,
				exposes: {
					'./EbookIdeas': './src/views/ebook/ideas/index.tsx',
					'./EbookHighlights': './src/views/ebook/highlights/index.tsx',
					'./EbookTestBookInfo': './src/views/ebook/toolbar-test/index.ts',
					'./LearningNotes': './src/views/learning-notes/index.tsx',
					'./VideoPlayer': './src/views/video-player/index.tsx',
				},
				shared: {
					react: { singleton: true, requiredVersion: '^19.1.0' },
					'react-dom': { singleton: true, requiredVersion: '^19.1.0' },
				},
				hostInitInjectLocation: 'entry',
				dts: false,
				dev: {
					remoteHmr: true,
				},
			}),
		],
		resolve: {
			alias: {
				'@': path.resolve(__dirname, 'src'),
				'@ui': path.resolve(__dirname, 'src/components/ui'),
				'@design': path.resolve(__dirname, 'src/components/design'),
			},
		},
		optimizeDeps: {
			// 预打包 tiptap，避免 HMR 中途发现新 dep 再整页 reload（会打断 Host 对 remoteEntry 的 import）
			include: [
				'@tiptap/core',
				'@tiptap/pm/gapcursor',
				'@tiptap/pm/model',
				'@tiptap/pm/state',
				'@tiptap/react',
				'@tiptap/react/menus',
				'@tiptap/starter-kit',
				'@tiptap/extension-code-block-lowlight',
				'@tiptap/extension-document',
				'@tiptap/extension-highlight',
				'@tiptap/extension-image',
				'@tiptap/extension-list',
				'@tiptap/extension-placeholder',
				'@tiptap/extension-table',
				'@tiptap/extension-text-align',
				'@tiptap/extensions',
				'lowlight',
			],
			exclude: [
				'react',
				'react/jsx-runtime',
				'react/jsx-dev-runtime',
				'react-dom',
				'react-dom/client',
			],
		},
		server: {
			host,
			port,
			strictPort: true,
			origin: devOrigin,
			cors: true,
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
		},
		preview: {
			host,
			port,
			strictPort: true,
			cors: true,
		},
		build: {
			target: 'esnext',
			modulePreload: false,
			minify: false,
		},
	};
});
