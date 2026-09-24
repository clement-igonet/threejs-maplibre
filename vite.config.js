import { cpSync, existsSync, readFileSync } from 'fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse( readFileSync( new URL( './package.json', import.meta.url ) ) );

// Demo site build (npm run build:site); the library itself is built by
// vite.lib.config.js into build/, which the site ships as is under /build/ for
// the standalone demo. BASE_PATH is set by the Pages workflow (the repo lives
// under /threejs-maplibre/); dev, tests and CI screenshots run from the root.
export default defineConfig( {
	base: process.env.BASE_PATH || '/',
	plugins: [ {
		name: 'copy-library-build',
		closeBundle() {

			if ( existsSync( 'build' ) ) cpSync( 'build', 'dist/build', { recursive: true } );

		},
	} ],
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
				vector: 'demo/vector.html',
				objects: 'demo/objects.html',
				standalone: 'demo/standalone.html',
				bench: 'bench/index.html',
				decode: 'bench/decode.html',
			},
		},
	},
} );
