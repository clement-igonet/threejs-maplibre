import { decodeVectorTile } from './decodeVectorTile.js';

// Loads MVT tiles: the fetch runs on the main thread (abortable, like
// ImageTileLoader), the buffer is transferred to a small pool of Workers for
// decoding, and the decoded layers come back transferred. Without Workers
// (Node, tests) decoding runs inline. load() resolves to the decoded tile
// ({ layers }); abort( key ) cancels an in-flight fetch (the promise rejects
// with an AbortError); a tile already being decoded finishes and is dropped.

export class VectorTileLoader {

	constructor( { workers = 2, createWorker = defaultCreateWorker } = {} ) {

		this._controllers = new Map();
		this._workers = [];
		this._pending = new Map();
		this._nextId = 1;
		this._nextWorker = 0;

		for ( let i = 0; i < workers; i ++ ) {

			const worker = createWorker();
			if ( ! worker ) break;
			worker.onmessage = event => this._onMessage( event.data );
			this._workers.push( worker );

		}

	}

	get pendingCount() {

		return this._controllers.size;

	}

	async load( key, url ) {

		const controller = new AbortController();
		this._controllers.set( key, controller );

		try {

			const response = await fetch( url, { signal: controller.signal } );
			if ( ! response.ok ) {

				throw new Error( `VectorTileLoader: HTTP ${ response.status } for ${ url }` );

			}

			const buffer = await response.arrayBuffer();
			return await this._decode( buffer );

		} finally {

			this._controllers.delete( key );

		}

	}

	abort( key ) {

		const controller = this._controllers.get( key );
		if ( controller ) {

			controller.abort();
			this._controllers.delete( key );

		}

	}

	abortAll() {

		for ( const controller of this._controllers.values() ) controller.abort();
		this._controllers.clear();

	}

	dispose() {

		this.abortAll();
		for ( const worker of this._workers ) worker.terminate();
		this._workers.length = 0;
		for ( const { reject } of this._pending.values() ) reject( new Error( 'VectorTileLoader disposed' ) );
		this._pending.clear();

	}

	_decode( buffer ) {

		if ( this._workers.length === 0 ) return Promise.resolve( decodeVectorTile( buffer ) );

		const id = this._nextId ++;
		const worker = this._workers[ this._nextWorker ];
		this._nextWorker = ( this._nextWorker + 1 ) % this._workers.length;

		return new Promise( ( resolve, reject ) => {

			this._pending.set( id, { resolve, reject } );
			worker.postMessage( { id, buffer }, [ buffer ] );

		} );

	}

	_onMessage( data ) {

		const pending = this._pending.get( data.id );
		if ( ! pending ) return;
		this._pending.delete( data.id );
		if ( data.error ) pending.reject( new Error( data.error ) );
		else pending.resolve( data.tile );

	}

}

function defaultCreateWorker() {

	if ( typeof Worker === 'undefined' ) return null;
	return new Worker( new URL( './vectorTileWorker.js', import.meta.url ), { type: 'module' } );

}
