// The Worker running vectorTileWorker.js. From the sources (dev server,
// tests) it is a module Worker resolved next to this file; the library build
// swaps this module for createWorker.lib.js, which carries the Worker inline
// so one bundle file works from any origin, a CDN included.

export function createVectorTileWorker() {

	if ( typeof Worker === 'undefined' ) return null;
	return new Worker( new URL( './vectorTileWorker.js', import.meta.url ), { type: 'module' } );

}
