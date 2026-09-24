import { rmSync } from 'fs';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

// Library build, two files in build/ (npm run build):
//   threejs-maplibre.module.js  ES module, three stays an import: for bundlers
//                               and import maps, next to your own three
//   threejs-maplibre.js         standalone script (--mode standalone): the
//                               library and its copy of three under the
//                               global threejsMaplibre, for a plain <script>
// Both carry the tile Worker inline, so a single file works from any origin.
// The demo site is a separate build (vite.config.js).

const workerFactory = fileURLToPath( new URL( './src/core/createWorker.lib.js', import.meta.url ) );

export default defineConfig( ( { mode } ) => {

	const standalone = mode === 'standalone';

	return {
		resolve: {
			alias: [ { find: /^\.\/createWorker\.js$/, replacement: workerFactory } ],
		},
		plugins: [ {
			// the inlined Worker has no file of its own to map: drop the map Vite emits for it
			name: 'drop-worker-sourcemap',
			closeBundle() {

				rmSync( 'build/assets', { recursive: true, force: true } );

			},
		} ],
		build: {
			outDir: 'build',
			emptyOutDir: ! standalone, // the standalone build lands next to the module one
			sourcemap: true,
			minify: standalone,
			lib: standalone
				? { entry: 'src/standalone.js', name: 'threejsMaplibre', formats: [ 'umd' ], fileName: () => 'threejs-maplibre.js' }
				: { entry: 'src/index.js', formats: [ 'es' ], fileName: () => 'threejs-maplibre.module.js' },
			rollupOptions: {
				// three/src/extras/Earcut.js is bundled: it is self-contained and
				// import maps only know the bare 'three'
				external: standalone ? [] : [ 'three' ],
			},
		},
	};

} );
