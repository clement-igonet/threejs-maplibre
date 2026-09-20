import { describe, expect, it } from 'vitest';
import {
	EARTH_RADIUS, MAX_LATITUDE,
	latitudeToNormalized, longitudeToNormalized,
	normalizedToLatitude, normalizedToLongitude,
	pointToTile, texelSizeMeters, tileToBounds,
} from '../src/math/WebMercator.js';

describe( 'WebMercator', () => {

	it( 'maps the origin to the center of the projection', () => {

		expect( longitudeToNormalized( 0 ) ).toBeCloseTo( 0.5, 12 );
		expect( latitudeToNormalized( 0 ) ).toBeCloseTo( 0.5, 12 );

	} );

	it( 'round-trips longitude and latitude', () => {

		for ( const lon of [ - 180, - 74.006, 0, 2.3522, 179.9 ] ) {

			expect( normalizedToLongitude( longitudeToNormalized( lon ) ) ).toBeCloseTo( lon, 9 );

		}

		for ( const lat of [ - 85, - 48.85, 0, 48.8566, 85 ] ) {

			expect( normalizedToLatitude( latitudeToNormalized( lat ) ) ).toBeCloseTo( lat, 9 );

		}

	} );

	it( 'clamps latitude to the Web Mercator limit', () => {

		expect( latitudeToNormalized( 90 ) ).toBeCloseTo( latitudeToNormalized( MAX_LATITUDE ), 12 );
		expect( latitudeToNormalized( - 90 ) ).toBeCloseTo( 1, 6 );

	} );

	it( 'addresses the central Paris tile at zoom 17', () => {

		// independently computed: floor(((2.3522+180)/360) * 2^17) and the
		// mercator row for lat 48.8566
		expect( pointToTile( 2.3522, 48.8566, 17 ) ).toEqual( [ 66392, 45092, 17 ] );

	} );

	it( 'computes tile bounds that contain their addressing point', () => {

		const [ x, y, z ] = pointToTile( 2.3522, 48.8566, 12 );
		const [ west, south, east, north ] = tileToBounds( x, y, z );
		expect( west ).toBeLessThan( 2.3522 );
		expect( east ).toBeGreaterThan( 2.3522 );
		expect( south ).toBeLessThan( 48.8566 );
		expect( north ).toBeGreaterThan( 48.8566 );

	} );

	it( 'halves the texel size with each zoom level and shrinks it with latitude', () => {

		const z10 = texelSizeMeters( 10, 0 );
		expect( texelSizeMeters( 11, 0 ) ).toBeCloseTo( z10 / 2, 9 );
		expect( texelSizeMeters( 10, 60 ) ).toBeCloseTo( z10 / 2, 9 ); // cos(60 deg) = 0.5
		expect( texelSizeMeters( 0, 0, 256 ) ).toBeCloseTo( 2 * Math.PI * EARTH_RADIUS / 256, 6 );

	} );

} );
