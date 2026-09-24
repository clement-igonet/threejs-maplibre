import { decodeVectorTile, vectorTileTransferables } from './decodeVectorTile.js';
import { buildTile, builtTileTransferables } from '../build/buildTile.js';
import { Style } from '../style/Style.js';

// Worker entry. Messages:
//   { type: 'init', style, sourceId, mode }
//       compiles the style once; no answer
//   { type: 'build', id, buffer, x, y, z }
//       decodes and builds the tile, answers { id, built } with the geometry
//       blocks transferred (see build/buildTile.js)
//   { id, buffer }
//       decodes only, answers { id, tile } with the tile's arrays transferred
// Errors answer { id, error }. The handling lives in a plain function so the
// loader can run it inline without a Worker (Node, tests).

export function createVectorTileHandler() {

	let config = null;

	return function handleVectorTileMessage( data, post ) {

		if ( data.type === 'init' ) {

			config = {
				style: new Style( data.style ),
				sourceId: data.sourceId,
				mode: data.mode,
			};
			return;

		}

		const { id, buffer } = data;

		try {

			const t0 = performance.now();
			const tile = decodeVectorTile( buffer );
			const decodeMs = performance.now() - t0;

			if ( data.type === 'build' ) {

				if ( config === null ) throw new Error( 'vectorTileWorker: build before init' );
				const built = buildTile( tile, config.style, { ...config, x: data.x, y: data.y, z: data.z } );
				built.stats.decodeMs = decodeMs;
				post( { id, built }, builtTileTransferables( built ) );

			} else {

				post( { id, tile }, vectorTileTransferables( tile ) );

			}

		} catch ( error ) {

			post( { id, error: String( error && error.message || error ) } );

		}

	};

}

export const handleVectorTileMessage = createVectorTileHandler();

if ( typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined' ) {

	self.onmessage = event => handleVectorTileMessage( event.data, ( message, transfer ) => self.postMessage( message, transfer ) );

}
