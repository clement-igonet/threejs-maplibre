// Library build variant of createWorker.js (aliased in vite.lib.config.js):
// Vite bundles the Worker with its imports and inlines it as a string, the
// Worker starts from a Blob URL. A Worker can not be loaded cross-origin, so
// this is what lets the built file run straight from a CDN.
import VectorTileWorker from './vectorTileWorker.js?worker&inline';

export function createVectorTileWorker() {

	if ( typeof Worker === 'undefined' ) return null;
	return new VectorTileWorker();

}
