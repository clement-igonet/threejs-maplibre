import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { latLonToEcef, WGS84_RADIUS, WGS84_RADIUS_POLAR } from '../src/math/Ellipsoid.js';
import { createGlobePatch, createPlanarPatch } from '../src/three/TilePatchGeometry.js';

describe( 'Ellipsoid', () => {

	it( 'places the origin meridian and poles on the three.js globe axes', () => {

		const p = latLonToEcef( 0, 0, 0, new Vector3() );
		expect( p.x ).toBeCloseTo( WGS84_RADIUS, 6 );
		expect( p.y ).toBeCloseTo( 0, 6 );
		expect( p.z ).toBeCloseTo( 0, 6 );

		const north = latLonToEcef( 90, 0, 0, new Vector3() );
		expect( north.y ).toBeCloseTo( WGS84_RADIUS_POLAR, 6 );

		const east = latLonToEcef( 0, 90, 0, new Vector3() );
		expect( east.z ).toBeCloseTo( - WGS84_RADIUS, 6 );

	} );

} );

describe( 'TilePatchGeometry', () => {

	it( 'keeps globe patch vertices on the ellipsoid surface', () => {

		const { geometry, center } = createGlobePatch( 66392, 45092, 17, 8 );
		const position = geometry.attributes.position;
		for ( let i = 0; i < position.count; i ++ ) {

			const p = new Vector3().fromBufferAttribute( position, i ).add( center );
			const radius = p.length();
			expect( radius ).toBeGreaterThan( WGS84_RADIUS_POLAR - 1 );
			expect( radius ).toBeLessThan( WGS84_RADIUS + 1 );

		}

	} );

	it( 'anchors vertices relative to the tile center for float precision', () => {

		const { geometry, center } = createGlobePatch( 66392, 45092, 17, 8 );
		expect( center.length() ).toBeGreaterThan( WGS84_RADIUS_POLAR );

		// a zoom-17 tile is ~300 m across: relative vertices must stay small
		const box = geometry.boundingBox;
		expect( box.getSize( new Vector3() ).length() ).toBeLessThan( 1000 );

	} );

	it( 'builds flat planar patches with north toward -z', () => {

		const paris = createPlanarPatch( 66392, 45092, 17 ); // northern hemisphere
		const sydney = createPlanarPatch( 120589, 78655, 17 ); // southern hemisphere
		expect( paris.center.y ).toBe( 0 );
		expect( paris.center.z ).toBeLessThan( 0 );
		expect( sydney.center.z ).toBeGreaterThan( 0 );

	} );

	it( 'maps texture v = 1 to the north edge of the tile', () => {

		const { geometry } = createPlanarPatch( 0, 0, 1, 1 );
		const uv = geometry.attributes.uv;
		const position = geometry.attributes.position;
		for ( let i = 0; i < uv.count; i ++ ) {

			if ( uv.getY( i ) === 1 ) {

				// v = 1 rows sit at smaller z (further north) than v = 0 rows
				expect( position.getZ( i ) ).toBeLessThan( 0 );

			}

		}

	} );

} );
