import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { geocentricHeight, latLonToEcef } from '../src/math/Ellipsoid.js';

describe( 'geocentricHeight', () => {

	it( 'is zero on the surface at any latitude and tracks height above it', () => {

		for ( const lat of [ 0, 48.8566, - 33.9, 89 ] ) {

			const p = latLonToEcef( lat, 2.35, 0, new Vector3() );
			expect( Math.abs( geocentricHeight( p ) ) ).toBeLessThan( 25 ); // geocentric vs geodetic, meters
			const up = latLonToEcef( lat, 2.35, 1500, new Vector3() );
			expect( geocentricHeight( up ) ).toBeGreaterThan( 1470 );
			expect( geocentricHeight( up ) ).toBeLessThan( 1530 );

		}

	} );

} );
