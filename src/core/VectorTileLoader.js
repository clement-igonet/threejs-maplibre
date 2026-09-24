import { createVectorTileHandler } from './vectorTileWorker.js';
import { createVectorTileWorker } from './createWorker.js';

// Loads MVT tiles: the fetch runs on the main thread (abortable, like
// ImageTileLoader), the buffer is transferred to a small pool of Workers for
// decoding, and the result comes back transferred. Without Workers (Node,
// tests) the same handler runs inline. load( key, url ) resolves to the
// decoded tile ({ layers }); after configure( { style, sourceId, mode } ),
// load( key, url, { x, y, z } ) resolves to the built
// geometry blocks instead (see build/buildTile.js). abort( key ) cancels an
// in-flight fetch (the promise rejects with an AbortError); a tile already
// in a Worker finishes and is dropped.

export class VectorTileLoader {

	constructor( { workers = 2, createWorker = createVectorTileWorker } = {} ) {

		this._controllers = new Map();
		this._workers = [];
		this._pending = new Map();
		this._nextId = 1;
		this._nextWorker = 0;
		this._config = null;
		this._inline = createVectorTileHandler();

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

	// Sends the style to the Workers; tiles loaded with a { x, y, z } are
	// built against it.
	configure( { style, sourceId, mode = 'globe' } ) {

		const styleJSON = style.json ?? style;
		this._config = { type: 'init', style: styleJSON, sourceId, mode };
		for ( const worker of this._workers ) worker.postMessage( this._config );
		if ( this._workers.length === 0 ) this._inline( this._config, () => {} );

	}

	async load( key, url, tile = null ) {

		const controller = new AbortController();
		this._controllers.set( key, controller );

		try {

			const response = await fetch( url, { signal: controller.signal } );
			if ( ! response.ok ) {

				throw new Error( `VectorTileLoader: HTTP ${ response.status } for ${ url }` );

			}

			const buffer = await response.arrayBuffer();
			const message = tile && this._config
				? { type: 'build', buffer, x: tile.x, y: tile.y, z: tile.z }
				: { buffer };
			return await this._request( message );

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

	_request( message ) {

		const id = this._nextId ++;
		message.id = id;

		return new Promise( ( resolve, reject ) => {

			this._pending.set( id, { resolve, reject } );

			if ( this._workers.length === 0 ) {

				this._inline( message, reply => this._onMessage( reply ) );
				return;

			}

			const worker = this._workers[ this._nextWorker ];
			this._nextWorker = ( this._nextWorker + 1 ) % this._workers.length;
			worker.postMessage( message, [ message.buffer ] );

		} );

	}

	_onMessage( data ) {

		const pending = this._pending.get( data.id );
		if ( ! pending ) return;
		this._pending.delete( data.id );
		if ( data.error ) pending.reject( new Error( data.error ) );
		else pending.resolve( data.built ?? data.tile );

	}

}
