import { afterEach, describe, expect, it, vi } from 'vitest';
import { VectorTileLoader } from '../src/core/VectorTileLoader.js';
import { handleVectorTileMessage } from '../src/core/vectorTileWorker.js';
import { createStubVectorSource } from '../demo/stub-vector-tiles.js';
import { latitudeToNormalized, longitudeToNormalized } from '../src/math/WebMercator.js';

const Z = 14;
const X = Math.floor( longitudeToNormalized( 2.3522 ) * 2 ** Z );
const Y = Math.floor( latitudeToNormalized( 48.8566 ) * 2 ** Z );

// a Worker stand-in running the real message handler on a microtask, so the
// loader's request/response bookkeeping is exercised without a Worker
function createFakeWorker() {

	const worker = {
		posted: 0,
		terminated: false,
		onmessage: null,
		postMessage( message ) {

			worker.posted ++;
			queueMicrotask( () => handleVectorTileMessage( message, reply => worker.onmessage( { data: reply } ) ) );

		},
		terminate() {

			worker.terminated = true;

		},
	};
	return worker;

}

describe( 'VectorTileLoader', () => {

	afterEach( () => vi.restoreAllMocks() );

	it( 'fetches and decodes inline when no Worker is available', async () => {

		const loader = new VectorTileLoader( { createWorker: () => null } );
		const source = createStubVectorSource();
		const tile = await loader.load( 'a', source.tileUrl( X, Y, Z ) );
		expect( Object.keys( tile.layers ) ).toContain( 'building' );
		expect( loader.pendingCount ).toBe( 0 );

	} );

	it( 'decodes an empty tile to no layers', async () => {

		const loader = new VectorTileLoader( { createWorker: () => null } );
		const tile = await loader.load( 'empty', createStubVectorSource().tileUrl( 0, 0, Z ) );
		expect( tile.layers ).toEqual( {} );

	} );

	it( 'round-robins decoding over the worker pool and matches replies by id', async () => {

		const workers = [];
		const loader = new VectorTileLoader( { workers: 2, createWorker: () => {

			const w = createFakeWorker();
			workers.push( w );
			return w;

		} } );
		const url = createStubVectorSource().tileUrl( X, Y, Z );
		const tiles = await Promise.all( [ loader.load( 'a', url ), loader.load( 'b', url ), loader.load( 'c', url ) ] );
		expect( tiles.every( t => t.layers.building.featureCount > 0 ) ).toBe( true );
		expect( workers.map( w => w.posted ) ).toEqual( [ 2, 1 ] );

		loader.dispose();
		expect( workers.every( w => w.terminated ) ).toBe( true );

	} );

	it( 'rejects with the worker error', async () => {

		const loader = new VectorTileLoader( { workers: 1, createWorker: createFakeWorker } );
		vi.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( new Uint8Array( [ 0xff, 0xff, 0xff ] ) ) );
		await expect( loader.load( 'bad', 'stub://bad' ) ).rejects.toThrow();

	} );

	it( 'aborts an in-flight fetch', async () => {

		const loader = new VectorTileLoader( { createWorker: () => null } );
		vi.spyOn( globalThis, 'fetch' ).mockImplementation( ( url, { signal } ) => new Promise( ( resolve, reject ) => {

			signal.addEventListener( 'abort', () => reject( signal.reason ) );

		} ) );
		const promise = loader.load( 'slow', 'stub://slow' );
		expect( loader.pendingCount ).toBe( 1 );
		loader.abort( 'slow' );
		await expect( promise ).rejects.toMatchObject( { name: 'AbortError' } );
		expect( loader.pendingCount ).toBe( 0 );

	} );

	it( 'reports HTTP errors', async () => {

		const loader = new VectorTileLoader( { createWorker: () => null } );
		vi.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( null, { status: 404 } ) );
		await expect( loader.load( 'missing', 'https://example.com/1/2/3.pbf' ) ).rejects.toThrow( /404/ );

	} );

} );
