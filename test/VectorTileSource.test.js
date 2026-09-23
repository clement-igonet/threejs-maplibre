import { afterEach, describe, expect, it, vi } from 'vitest';
import { VectorTileSource, loadOpenFreeMapSource, OPENFREEMAP_TILEJSON_URL } from '../src/core/VectorTileSource.js';

describe( 'VectorTileSource', () => {

	afterEach( () => vi.restoreAllMocks() );

	it( 'is an XYZ source with vector defaults', () => {

		const source = new VectorTileSource( { url: 'https://example.com/{z}/{x}/{y}.pbf' } );
		expect( source.type ).toBe( 'vector' );
		expect( source.maxZoom ).toBe( 14 );
		expect( source.extent ).toBe( 4096 );
		expect( source.tileUrl( 3, 2, 1 ) ).toBe( 'https://example.com/1/3/2.pbf' );

	} );

	it( 'reads url template, zoom range and attribution from TileJSON', () => {

		const source = VectorTileSource.fromTileJSON( {
			tilejson: '3.0.0',
			tiles: [ 'https://tiles.example.com/planet/20250101/{z}/{x}/{y}.pbf' ],
			minzoom: 2,
			maxzoom: 15,
			attribution: 'test',
		} );
		expect( source.tileUrl( 0, 0, 2 ) ).toBe( 'https://tiles.example.com/planet/20250101/2/0/0.pbf' );
		expect( source.minZoom ).toBe( 2 );
		expect( source.maxZoom ).toBe( 15 );
		expect( source.attribution ).toBe( 'test' );
		expect( () => VectorTileSource.fromTileJSON( { tiles: [] } ) ).toThrow( /tiles/ );

	} );

	it( 'loads TileJSON over fetch, with attribution overridable', async () => {

		vi.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( JSON.stringify( { tiles: [ 'https://t/{z}/{x}/{y}.pbf' ], maxzoom: 14, attribution: 'from tilejson' } ) ) );
		const source = await loadOpenFreeMapSource();
		expect( fetch ).toHaveBeenCalledWith( OPENFREEMAP_TILEJSON_URL );
		expect( source.tileUrl( 1, 2, 3 ) ).toBe( 'https://t/3/1/2.pbf' );
		expect( source.attribution ).toContain( 'OpenFreeMap' );

	} );

} );
