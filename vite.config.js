import { defineConfig } from 'vite';

// BASE_PATH is set by the Pages workflow (the repo lives under /threejs-maplibre/);
// dev, tests and CI screenshots run from the root.
export default defineConfig( {
	base: process.env.BASE_PATH || '/',
	build: {
		outDir: 'dist',
		rollupOptions: {
			input: {
				index: 'index.html',
				demos: 'demo/index.html',
				globe: 'demo/globe.html',
				planar: 'demo/planar.html',
				bench: 'bench/index.html',
			},
		},
	},
} );
