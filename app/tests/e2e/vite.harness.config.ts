import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { mockDocumentApi } from './mockDocumentApi';
import { mockCollaborationApi } from './mockCollaborationApi';

export default defineConfig({
	root: fileURLToPath(new URL('./harness', import.meta.url)),
	plugins: [
		react(),
		mockDocumentApi(fileURLToPath(new URL('../../../poc/sample-files/betteroffice-demo.docx', import.meta.url))),
		mockCollaborationApi(),
	],
	worker: { format: 'es' },
	optimizeDeps: {
		exclude: ['@betteroffice/docx', '@betteroffice/docx-react'],
	},
	server: {
		port: 5184,
		strictPort: true,
	},
});
