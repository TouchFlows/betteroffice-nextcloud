import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { mockDocumentApi } from './mockDocumentApi';
import { mockCollaborationApi } from './mockCollaborationApi';

const sample = (name: string): string => fileURLToPath(new URL(`../../../poc/sample-files/${name}`, import.meta.url));

export default defineConfig({
	root: fileURLToPath(new URL('./harness', import.meta.url)),
	plugins: [
		react(),
		// One fixture per format, each on its own file id, so a spec picks the
		// editor it means to drive instead of relying on a content sniff.
		mockDocumentApi([
			{
				fileId: 1,
				path: sample('betteroffice-demo.docx'),
				mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			},
			{
				fileId: 2,
				path: sample('showcase.xlsx'),
				mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			},
			{
				fileId: 3,
				path: sample('betteroffice-demo.pptx'),
				mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
			},
		]),
		mockCollaborationApi(),
	],
	worker: { format: 'es' },
	optimizeDeps: {
		// Same wasm-bindgen `import.meta.url` reason as the production config:
		// pre-bundling rewrites it into the .vite/deps cache and the engine
		// cannot find its .wasm.
		exclude: [
			'@betteroffice/docx',
			'@betteroffice/docx-react',
			'@betteroffice/xlsx',
			'@betteroffice/xlsx-react',
			'@betteroffice/pptx',
			'@betteroffice/pptx-react',
		],
	},
	server: {
		port: 5184,
		strictPort: true,
	},
});
