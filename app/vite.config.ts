import { createAppConfig } from '@nextcloud/vite-config';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default createAppConfig(
	{
		main: 'src/main.tsx',
	},
	{
		config: defineConfig({ plugins: [react()] }),
		inlineCSS: true,
	},
);
