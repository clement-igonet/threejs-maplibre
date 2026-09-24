import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { geocentricHeight, latLonToEcef, rayEllipsoidIntersection } from '../src/math/Ellipsoid.js';

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

describe( 'rayEllipsoidIntersection', () => {

	it( 'finds the ground under a camera looking down at mid latitude', () => {

		// the ellipsoid there lies inside the equatorial sphere: a sphere test
		// would hit the far side
		const ground = latLonToEcef( 48.8566, 2.3522, 0, new Vector3() );
		const eye = latLonToEcef( 48.8566, 2.3522, 500, new Vector3() );
		const direction = ground.clone().sub( eye ).normalize();
		const hit = rayEllipsoidIntersection( eye, direction, new Vector3() );
		expect( hit ).not.toBeNull();
		expect( hit.distanceTo( ground ) ).toBeLessThan( 1 );
		expect( hit.distanceTo( eye ) ).toBeCloseTo( 500, 0 );

	} );

	it( 'misses when looking away from the planet', () => {

		const eye = latLonToEcef( 10, 20, 2000, new Vector3() );
		expect( rayEllipsoidIntersection( eye, eye.clone().normalize(), new Vector3() ) ).toBeNull();

	} );

} );
