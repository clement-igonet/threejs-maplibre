import { readFileSync } from 'fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse( readFileSync( new URL( './package.json', import.meta.url ) ) );

// BASE_PATH is set by the Pages workflow (the repo lives under /threejs-maplibre/);
// dev, tests and CI screenshots run from the root.
export default defineConfig( {
	base: process.env.BASE_PATH || '/',
	define: {
		// shown in the demo footer so a cached page is recognizable
		__VERSION__: JSON.stringify( version ),
		__BUILD__: JSON.stringify( ( process.env.GITHUB_SHA || 'dev' ).slice( 0, 7 ) ),
	},
	build: {
		outDir: 'dist',
		rollupOptions: {
			input: {
				index: 'index.html',
				demos: 'demo/index.html',
				globe: 'demo/globe.html',
				planar: 'demo/planar.html',
				bench: 'bench/index.html',
				decode: 'bench/decode.html',
			},
		},
	},
} );
