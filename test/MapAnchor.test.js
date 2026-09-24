import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from 'three';
import { MapAnchor } from '../src/three/MapAnchor.js';
import { latLonToEcef, localFrame, WGS84_RADIUS, WGS84_RADIUS_POLAR } from '../src/math/Ellipsoid.js';
import { latitudeToNormalized, longitudeToNormalized, normalizedToMeters } from '../src/math/WebMercator.js';

const LOUVRE = { lat: 48.8606, lon: 2.3376 };
const RAD2DEG = 180 / Math.PI;

// where a child at a local offset ends up in the world
function worldPoint( anchor, x, y, z ) {

	const child = new Object3D();
	child.position.set( x, y, z );
	anchor.add( child );
	anchor.updateMatrixWorld( true );
	return child.getWorldPosition( new Vector3() );

}

describe( 'MapAnchor', () => {

	it( 'stands level and north-aligned on the globe', () => {

		const anchor = new MapAnchor().setLocation( LOUVRE.lat, LOUVRE.lon, 30 );
		expect( anchor.position.distanceTo( latLonToEcef( LOUVRE.lat, LOUVRE.lon, 30, new Vector3() ) ) ).toBeLessThan( 1e-6 );

		const east = new Vector3(), north = new Vector3(), up = new Vector3();
		localFrame( LOUVRE.lat, LOUVRE.lon, east, north, up );
		// local y is up, local -z is north, local x is east
		expect( worldPoint( anchor, 0, 10, 0 ).sub( anchor.position ).normalize().dot( up ) ).toBeCloseTo( 1, 9 );
		expect( worldPoint( anchor, 0, 0, - 10 ).sub( anchor.position ).normalize().dot( north ) ).toBeCloseTo( 1, 9 );
		expect( worldPoint( anchor, 10, 0, 0 ).sub( anchor.position ).normalize().dot( east ) ).toBeCloseTo( 1, 9 );

		// 100 m north along the local frame lands within a centimeter of 100 m
		// north on the ellipsoid (the meridional radius of curvature at this
		// latitude gives the degrees; the tangent leaves the surface by 0.8 mm)
		const e2 = 1 - ( WGS84_RADIUS_POLAR / WGS84_RADIUS ) ** 2;
		const sinLat = Math.sin( LOUVRE.lat / RAD2DEG );
		const meridional = WGS84_RADIUS * ( 1 - e2 ) / ( 1 - e2 * sinLat * sinLat ) ** 1.5;
		const north100 = latLonToEcef( LOUVRE.lat + 100 / meridional * RAD2DEG, LOUVRE.lon, 30, new Vector3() );
		expect( worldPoint( anchor, 0, 0, - 100 ).distanceTo( north100 ) ).toBeLessThan( 0.01 );

	} );

	it( 'turns by the heading, clockwise from north', () => {

		const anchor = new MapAnchor().setLocation( LOUVRE.lat, LOUVRE.lon, 0, 90 );
		const east = new Vector3(), north = new Vector3(), up = new Vector3();
		localFrame( LOUVRE.lat, LOUVRE.lon, east, north, up );
		expect( worldPoint( anchor, 0, 0, - 10 ).sub( anchor.position ).normalize().dot( east ) ).toBeCloseTo( 1, 9 );
		expect( worldPoint( anchor, 0, 10, 0 ).sub( anchor.position ).normalize().dot( up ) ).toBeCloseTo( 1, 9 );

	} );

	it( 'translates on the plane in planar mode', () => {

		const anchor = new MapAnchor( { mode: 'planar' } ).setLocation( LOUVRE.lat, LOUVRE.lon, 30 );
		const [ mx, my ] = normalizedToMeters( longitudeToNormalized( LOUVRE.lon ), latitudeToNormalized( LOUVRE.lat ) );
		expect( anchor.position.toArray() ).toEqual( [ mx, 30, - my ] );
		const p = worldPoint( anchor, 0, 0, - 100 );
		expect( p.x ).toBeCloseTo( mx, 6 );
		expect( p.z ).toBeCloseTo( - my - 100, 6 );

		anchor.setLocation( LOUVRE.lat, LOUVRE.lon, 0, 90 );
		const q = worldPoint( anchor, 0, 0, - 100 );
		expect( q.x ).toBeCloseTo( mx + 100, 6 );
		expect( q.z ).toBeCloseTo( - my, 6 );

	} );

} );
