import { defineConfig } from 'vite';

// base './' : the built folder works from any path on the platform (e.g. https://platform/games/athar/).
export default defineConfig({
	base: './',
	build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 6000, target: 'es2020' },
	server: { host: true, port: 5173 }
});
