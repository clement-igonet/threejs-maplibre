import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { MercatorCoordinate } from 'maplibre-gl';
import { MAPLIBRE_EARTH_RADIUS, globeFrame, mercatorFrame, mercatorUnitsPerMeter } from '../src/bridge/MapLibreFrames.js';

// the Louvre pyramid, the reference scene
const LNG = 2.3359, LAT = 48.8610;

describe( 'mercatorFrame', () => {

	it( 'lands on the mercator coordinate maplibre-gl computes, altitude included', () => {

		for ( const altitude of [ 0, 35, 1200 ] ) {

			const p = new Vector3( 0, 0, 0 ).applyMatrix4( mercatorFrame( LNG, LAT, altitude ) );
			const expected = MercatorCoordinate.fromLngLat( { lng: LNG, lat: LAT }, altitude );
			expect( p.x ).toBeCloseTo( expected.x, 14 );
			expect( p.y ).toBeCloseTo( expected.y, 14 );
			expect( p.z ).toBeCloseTo( expected.z, 14 );

		}

	} );

	it( 'measures a meter the way maplibre-gl does, in every direction', () => {

		const s = MercatorCoordinate.fromLngLat( { lng: LNG, lat: LAT } ).meterInMercatorCoordinateUnits();
		expect( mercatorUnitsPerMeter( LAT ) ).toBeCloseTo( s, 18 );

		// read the frame's axes off the matrix: subtracting a 4e-8 step from a
		// coordinate near 0.5 would measure float64 rounding, not the frame
		const east = new Vector3(), up = new Vector3(), south = new Vector3();
		mercatorFrame( LNG, LAT ).extractBasis( east, up, south );
		// east, up, south: +x, +z, +y (mercator y grows southwards)
		const close = v => v.map( c => expect.closeTo( c, 20 ) );
		expect( east.toArray() ).toEqual( close( [ s, 0, 0 ] ) );
		expect( up.toArray() ).toEqual( close( [ 0, 0, s ] ) );
		expect( south.toArray() ).toEqual( close( [ 0, s, 0 ] ) );

	} );

	it( 'drifts from the map with the square of the distance from its anchor', () => {

		// A frame in meters is mercator linearised at the anchor, and the
		// mercator scale changes with latitude (1 / cos): walking north in
		// the frame and walking north on the map part ways, slowly at first.
		// This is why a scene spread over kilometres needs more than one
		// anchor, not a bug to fix in the frame.
		const offNorth = meters => {

			const p = new Vector3( 0, 0, - meters ).applyMatrix4( mercatorFrame( LNG, LAT ) );
			const dLat = meters / MAPLIBRE_EARTH_RADIUS * 180 / Math.PI;
			const expected = MercatorCoordinate.fromLngLat( { lng: LNG, lat: LAT + dLat } );
			return Math.abs( p.y - expected.y ) / mercatorUnitsPerMeter( LAT );

		};

		expect( offNorth( 100 ) ).toBeLessThan( 0.001 ); // under a millimetre
		expect( offNorth( 1000 ) ).toBeLessThan( 0.1 ); // under ten centimetres
		// and it is quadratic: ten times further, a hundred times the drift
		expect( offNorth( 1000 ) / offNorth( 100 ) ).toBeCloseTo( 100, - 1 );

	} );

} );

describe( 'globeFrame', () => {

	it( 'lands where maplibre-gl puts the point on its unit sphere', () => {

		// globe_utils.ts: angularCoordinatesRadiansToVector
		const l = LNG * Math.PI / 180, f = LAT * Math.PI / 180;
		const expected = [ Math.sin( l ) * Math.cos( f ), Math.sin( f ), Math.cos( l ) * Math.cos( f ) ];
		const p = new Vector3().applyMatrix4( globeFrame( LNG, LAT ) );
		expect( p.toArray() ).toEqual( expected.map( v => expect.closeTo( v, 14 ) ) );

	} );

	it( 'raises altitude along the radius of maplibre-gl\'s sphere', () => {

		const p = new Vector3().applyMatrix4( globeFrame( LNG, LAT, MAPLIBRE_EARTH_RADIUS ) );
		expect( p.length() ).toBeCloseTo( 2, 12 );

		// and a local meter up is the same as a meter of altitude
		const a = new Vector3( 0, 250, 0 ).applyMatrix4( globeFrame( LNG, LAT ) );
		const b = new Vector3().applyMatrix4( globeFrame( LNG, LAT, 250 ) );
		expect( a.distanceTo( b ) ).toBeLessThan( 1e-15 );

	} );

	it( 'keeps the local frame orthonormal and right-handed, one meter per unit', () => {

		const x = new Vector3(), y = new Vector3(), z = new Vector3();
		globeFrame( LNG, LAT ).extractBasis( x, y, z );
		for ( const v of [ x, y, z ] ) v.multiplyScalar( MAPLIBRE_EARTH_RADIUS );
		for ( const v of [ x, y, z ] ) expect( v.length() ).toBeCloseTo( 1, 12 );
		expect( x.dot( y ) ).toBeCloseTo( 0, 12 );
		expect( y.dot( z ) ).toBeCloseTo( 0, 12 );
		expect( x.clone().cross( y ).dot( z ) ).toBeCloseTo( 1, 12 ); // right-handed, no mirror

	} );

	it( 'points local north at increasing latitude, local east at increasing longitude', () => {

		const toLngLat = v => {

			const p = v.applyMatrix4( globeFrame( LNG, LAT ) ).normalize();
			return [ Math.atan2( p.x, p.z ) * 180 / Math.PI, Math.asin( p.y ) * 180 / Math.PI ];

		};

		const [ lngN, latN ] = toLngLat( new Vector3( 0, 0, - 100 ) );
		expect( latN ).toBeGreaterThan( LAT );
		expect( lngN ).toBeCloseTo( LNG, 9 );

		const [ lngE, latE ] = toLngLat( new Vector3( 100, 0, 0 ) );
		expect( lngE ).toBeGreaterThan( LNG );
		expect( latE ).toBeCloseTo( LAT, 5 );

	} );

} );
