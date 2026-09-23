import { describe, expect, it } from 'vitest';
import { decodeVectorTile, featureRings, vectorTileTransferables } from '../src/core/decodeVectorTile.js';
import { createStubCity, stubVectorTile } from '../demo/stub-vector-tiles.js';
import { latitudeToNormalized, longitudeToNormalized } from '../src/math/WebMercator.js';

// the z14 tile holding the stub city center
const Z = 14;
const CENTER_X = Math.floor( longitudeToNormalized( 2.3522 ) * 2 ** Z );
const CENTER_Y = Math.floor( latitudeToNormalized( 48.8566 ) * 2 ** Z );

describe( 'decodeVectorTile', () => {

	it( 'decodes the stub city tile into flat per-layer arrays', () => {

		const tile = decodeVectorTile( stubVectorTile( Z, CENTER_X, CENTER_Y ) );
		const names = Object.keys( tile.layers ).sort();
		expect( names ).toEqual( [ 'building', 'park', 'place', 'transportation', 'water' ] );

		const buildings = tile.layers.building;
		expect( buildings.extent ).toBe( 4096 );
		expect( buildings.featureCount ).toBeGreaterThan( 50 );
		expect( buildings.types.every( t => t === 3 ) ).toBe( true );
		expect( buildings.featureStart.length ).toBe( buildings.featureCount + 1 );
		expect( buildings.ringStart.length ).toBe( buildings.featureStart[ buildings.featureCount ] + 1 );
		expect( buildings.positions.length ).toBe( 2 * buildings.ringStart[ buildings.ringStart.length - 1 ] );
		expect( typeof buildings.properties[ 0 ].render_height ).toBe( 'number' );
		expect( Number.isNaN( buildings.ids[ 0 ] ) ).toBe( false );

		// a footprint is one closed ring of 5 vertices inside the buffered extent
		const rings = featureRings( buildings, 0 );
		expect( rings.length ).toBe( 1 );
		expect( rings[ 0 ].length ).toBe( 5 );
		expect( rings[ 0 ][ 0 ] ).toEqual( rings[ 0 ][ 4 ] );
		for ( const [ x, y ] of rings[ 0 ] ) {

			expect( x ).toBeGreaterThanOrEqual( - 64 );
			expect( x ).toBeLessThanOrEqual( 4096 + 64 );
			expect( y ).toBeGreaterThanOrEqual( - 64 );
			expect( y ).toBeLessThanOrEqual( 4096 + 64 );

		}

		expect( tile.layers.transportation.types.every( t => t === 2 ) ).toBe( true );
		expect( tile.layers.place.types[ 0 ] ).toBe( 1 );
		expect( tile.layers.place.properties[ 0 ].name ).toBe( 'Stub City' );

	} );

	it( 'keeps the MVT polygon winding (exterior clockwise in tile space)', () => {

		const tile = decodeVectorTile( stubVectorTile( Z, CENTER_X, CENTER_Y ) );
		const [ ring ] = featureRings( tile.layers.building, 0 );
		let area = 0;
		for ( let i = 0; i < ring.length - 1; i ++ ) area += ring[ i ][ 0 ] * ring[ i + 1 ][ 1 ] - ring[ i + 1 ][ 0 ] * ring[ i ][ 1 ];
		// y points down in tile space, so a clockwise ring has positive shoelace area
		expect( area ).toBeGreaterThan( 0 );

	} );

	it( 'lists one buffer per typed array for transfer', () => {

		const tile = decodeVectorTile( stubVectorTile( Z, CENTER_X, CENTER_Y ) );
		const transfer = vectorTileTransferables( tile );
		expect( transfer.length ).toBe( 5 * Object.keys( tile.layers ).length );
		expect( transfer.every( b => b instanceof ArrayBuffer ) ).toBe( true );

	} );

	it( 'returns no layers for an empty buffer', () => {

		expect( decodeVectorTile( new Uint8Array( 0 ) ).layers ).toEqual( {} );

	} );

} );

describe( 'stub city', () => {

	it( 'is deterministic', () => {

		const a = createStubCity();
		const b = createStubCity();
		expect( a.building.features.length ).toBe( b.building.features.length );
		expect( a.building.features[ 10 ] ).toEqual( b.building.features[ 10 ] );
		expect( stubVectorTile( Z, CENTER_X, CENTER_Y ) ).toEqual( stubVectorTile( Z, CENTER_X, CENTER_Y ) );

	} );

	it( 'is empty away from the city', () => {

		expect( stubVectorTile( Z, 0, 0 ) ).toBeNull();

	} );

} );
