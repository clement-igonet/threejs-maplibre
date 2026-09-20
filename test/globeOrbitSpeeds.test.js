import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { geocentricHeight, latLonToEcef, WGS84_RADIUS } from '../src/math/Ellipsoid.js';
import { globeOrbitSpeeds } from '../src/three/globeOrbitSpeeds.js';

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

describe( 'globeOrbitSpeeds', () => {

	it( 'scales rotate speed with altitude and caps it for the whole earth', () => {

		const far = globeOrbitSpeeds( 3 * WGS84_RADIUS, WGS84_RADIUS, 60 );
		const city = globeOrbitSpeeds( 8000, WGS84_RADIUS, 60 );
		const street = globeOrbitSpeeds( 1000, WGS84_RADIUS, 60 );
		expect( far.rotateSpeed ).toBeLessThanOrEqual( 1 );
		expect( city.rotateSpeed / street.rotateSpeed ).toBeCloseTo( 8, 5 );

		// a drag across the viewport height moves the ground by the height
		// the viewport covers at nadir: 2 * alt * tan(fov / 2)
		const groundPerViewport = 2 * Math.PI * WGS84_RADIUS * street.rotateSpeed;
		expect( groundPerViewport ).toBeCloseTo( 2 * 1000 * Math.tan( Math.PI / 6 ), 3 );

	} );

	it( 'makes one wheel notch change the altitude by a fixed fraction', () => {

		for ( const alt of [ 2e7, 4e5, 8000, 1000, 50 ] ) {

			const { zoomSpeed } = globeOrbitSpeeds( alt, WGS84_RADIUS, 60, 0.05 );
			// OrbitControls: distance *= 0.95 ^ zoomSpeed per notch
			const distance = ( WGS84_RADIUS + alt ) * Math.pow( 0.95, zoomSpeed );
			expect( distance - WGS84_RADIUS ).toBeCloseTo( 0.95 * alt, 3 );

		}

	} );

} );
