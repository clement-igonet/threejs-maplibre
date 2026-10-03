import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MAPLIBRE_SPHERE, WGS84, ecefToLatLon, geocentricHeight, latLonToEcef, rayEllipsoidIntersection } from '../src/math/Ellipsoid.js';

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

describe( 'datum', () => {

	it( 'builds the same place on MapLibre\'s sphere 21 km from where WGS84 puts it', () => {

		// the Louvre: on the sphere the point is at the sphere's radius, and
		// 11.45 arcminutes south of the ellipsoid's direction to the same
		// geodetic latitude, which is 21 km on the ground
		const sphere = latLonToEcef( 48.8610, 2.3359, 0, new Vector3(), MAPLIBRE_SPHERE );
		const wgs = latLonToEcef( 48.8610, 2.3359, 0, new Vector3(), WGS84 );
		expect( sphere.length() ).toBeCloseTo( MAPLIBRE_SPHERE.radius, 6 );
		const arcmin = Math.acos( sphere.clone().normalize().dot( wgs.clone().normalize() ) ) * 180 / Math.PI * 60;
		expect( arcmin ).toBeCloseTo( 11.45, 1 );
		expect( arcmin / 60 * Math.PI / 180 * MAPLIBRE_SPHERE.radius ).toBeCloseTo( 21200, - 3 );

		// heights, rays and the default all follow the datum
		expect( geocentricHeight( sphere, MAPLIBRE_SPHERE ) ).toBeCloseTo( 0, 6 );
		expect( geocentricHeight( wgs ) ).toBeCloseTo( 0, 0 );
		const eye = latLonToEcef( 48.8610, 2.3359, 500, new Vector3(), MAPLIBRE_SPHERE );
		const hit = rayEllipsoidIntersection( eye, sphere.clone().sub( eye ).normalize(), new Vector3(), MAPLIBRE_SPHERE );
		expect( hit.distanceTo( sphere ) ).toBeLessThan( 1e-6 );

	} );

	it( 'reads a place back off a point, on either datum', () => {

		for ( const datum of [ WGS84, MAPLIBRE_SPHERE ] ) {

			for ( const [ lat, lon, height ] of [ [ 48.8610, 2.3359, 0 ], [ - 33.8688, 151.2093, 1200 ], [ 69.65, 18.96, 36000000 ], [ 0, - 90, 0 ], [ 89.9, 10, 5 ] ] ) {

				const place = ecefToLatLon( latLonToEcef( lat, lon, height, new Vector3(), datum ), datum );
				expect( place.lat ).toBeCloseTo( lat, 8 );
				expect( ( ( place.lon - lon ) % 360 + 540 ) % 360 - 180 ).toBeCloseTo( 0, 8 );
				expect( place.height ).toBeCloseTo( height, 3 );

			}

		}

	} );

} );
