import { decodeVectorTile, vectorTileTransferables } from './decodeVectorTile.js';

// Worker entry: receives { id, buffer }, answers { id, tile } with the tile's
// arrays transferred, or { id, error }. The message handling lives in
// handleVectorTileMessage so the loader can be tested without a Worker.

export function handleVectorTileMessage( data, post ) {

	const { id, buffer } = data;

	try {

		const tile = decodeVectorTile( buffer );
		post( { id, tile }, vectorTileTransferables( tile ) );

	} catch ( error ) {

		post( { id, error: String( error && error.message || error ) } );

	}

}

if ( typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof window === 'undefined' ) {

	self.onmessage = event => handleVectorTileMessage( event.data, ( message, transfer ) => self.postMessage( message, transfer ) );

}
