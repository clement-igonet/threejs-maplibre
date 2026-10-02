import { describe, expect, it } from 'vitest';
import { Matrix4, Object3D, Vector3, Vector4 } from 'three';
import { MapLibreLayer } from '../src/bridge/MapLibreLayer.js';
import { MAPLIBRE_EARTH_RADIUS, globeFrame, mercatorFrame } from '../src/bridge/MapLibreFrames.js';

// the Louvre pyramid, the reference scene
const LNG = 2.3359, LAT = 48.8610;

// projection data the way maplibre-gl hands it to a custom layer: a
// column-major mat4 as a plain array, plus the globe transition
function projectionData( { main, fallback = main, transition = 0 } ) {

	return { mainMatrix: main.toArray(), fallbackMatrix: fallback.toArray(), projectionTransition: transition };

}

// a made-up clip projection: identity in mercator units, so clip space is
// mercator space and the checks below can read positions straight off
const IDENTITY = new Matrix4();

describe( 'MapLibreLayer', () => {

	it( 'is a maplibre-gl custom layer that shares the depth buffer', () => {

		const layer = new MapLibreLayer( { id: 'x', lng: LNG, lat: LAT } );
		expect( layer.type ).toBe( 'custom' );
		expect( layer.renderingMode ).toBe( '3d' );
		expect( typeof layer.onAdd ).toBe( 'function' );
		expect( typeof layer.render ).toBe( 'function' );
		expect( layer.anchor ).toEqual( { lng: LNG, lat: LAT, altitude: 0 } );

	} );

	it( 'uses the mercator frame when the map is flat', () => {

		const layer = new MapLibreLayer( { lng: LNG, lat: LAT } );
		const m = layer.projectionFor( projectionData( { main: IDENTITY, transition: 0 } ), new Matrix4() );
		expect( m.equals( mercatorFrame( LNG, LAT ) ) ).toBe( true );
		expect( layer.lastProjection.transition ).toBe( 0 );

	} );

	it( 'uses the globe frame on the pure globe', () => {

		const layer = new MapLibreLayer( { lng: LNG, lat: LAT } );
		const m = layer.projectionFor( projectionData( { main: IDENTITY, transition: 1 } ), new Matrix4() );
		expect( m.equals( globeFrame( LNG, LAT ) ) ).toBe( true );

	} );

	it( 'mixes the two exactly as MapLibre does, halfway through the morph', () => {

		// MapLibre: result = mix( flat, globe, transition ) per vertex; at the
		// anchor both frames give their own origin, so the mixed matrix must put
		// the anchor at the mix of the two origins
		const layer = new MapLibreLayer( { lng: LNG, lat: LAT } );
		const m = layer.projectionFor( projectionData( { main: IDENTITY, fallback: IDENTITY, transition: 0.25 } ), new Matrix4() );
		const at = frame => new Vector4( 0, 0, 0, 1 ).applyMatrix4( frame );
		const globe = at( globeFrame( LNG, LAT ) ), flat = at( mercatorFrame( LNG, LAT ) ), mixed = at( m );
		for ( const k of [ 'x', 'y', 'z', 'w' ] ) expect( mixed[ k ] ).toBeCloseTo( flat[ k ] + ( globe[ k ] - flat[ k ] ) * 0.25, 15 );
		expect( layer.lastProjection.transition ).toBe( 0.25 );

	} );

	it( 'moves the whole scene when the anchor moves', () => {

		const layer = new MapLibreLayer( { lng: LNG, lat: LAT } );
		const before = layer.projectionFor( projectionData( { main: IDENTITY } ), new Matrix4() );
		layer.setAnchor( LNG + 0.01, LAT, 0 );
		const after = layer.projectionFor( projectionData( { main: IDENTITY } ), new Matrix4() );
		// the origin moved east by 0.01 degrees of mercator x, nothing else
		const o0 = new Vector3().applyMatrix4( before ), o1 = new Vector3().applyMatrix4( after );
		expect( o1.x - o0.x ).toBeCloseTo( 0.01 / 360, 12 );
		expect( o1.y ).toBeCloseTo( o0.y, 15 );

	} );

	it( 'converts places to local meters and back, exactly at the anchor and to a decimetre a kilometre out', () => {

		const layer = new MapLibreLayer( { lng: LNG, lat: LAT, altitude: 30 } );
		expect( layer.localFromLngLat( LNG, LAT, 30 ).length() ).toBe( 0 );

		// north is -z, east is +x, up is +y
		const north = layer.localFromLngLat( LNG, LAT + 0.001, 30 );
		expect( north.z ).toBeLessThan( 0 );
		expect( Math.abs( north.x ) ).toBeLessThan( 1e-9 );
		const east = layer.localFromLngLat( LNG + 0.001, LAT, 45 );
		expect( east.x ).toBeGreaterThan( 0 );
		expect( east.y ).toBeCloseTo( 15, 12 );

		// a kilometre north is a kilometre on the sphere
		const km = layer.localFromLngLat( LNG, LAT + 1000 / MAPLIBRE_EARTH_RADIUS * 180 / Math.PI );
		expect( - km.z ).toBeCloseTo( 1000, 6 );

		// round trip
		const back = layer.lngLatFromLocal( new Vector3( 412.5, 7, - 980 ) );
		const again = layer.localFromLngLat( back.lng, back.lat, back.altitude );
		expect( again.x ).toBeCloseTo( 412.5, 9 );
		expect( again.y ).toBeCloseTo( 7, 9 );
		expect( again.z ).toBeCloseTo( - 980, 9 );

	} );

	it( 'places an object at a place with a heading clockwise from north', () => {

		const layer = new MapLibreLayer( { lng: LNG, lat: LAT } );
		const object = layer.place( new Object3D(), LNG + 0.001, LAT, 5, 90 );
		expect( object.position.x ).toBeGreaterThan( 0 );
		expect( object.position.y ).toBe( 5 );
		// heading 90 turns the object's -z (north) to face +x (east)
		const facing = new Vector3( 0, 0, - 1 ).applyEuler( object.rotation );
		expect( facing.x ).toBeCloseTo( 1, 12 );
		expect( facing.z ).toBeCloseTo( 0, 12 );

	} );

} );
