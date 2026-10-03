import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { MapLibreUnderlay } from '../src/bridge/MapLibreUnderlay.js';
import { MapControls, MAPLIBRE_FOV } from '../src/three/MapControls.js';
import { EARTH_RADIUS } from '../src/math/WebMercator.js';

const HEIGHT = 500;

// a planar camera placed by MapControls, the way the demos do it
function placed( { lat, lon, distance, heading, pitch } ) {

	const camera = new PerspectiveCamera( MAPLIBRE_FOV, 800 / HEIGHT, 1, 1e8 );
	const controls = new MapControls( camera, { addEventListener() {}, style: {} }, { mode: 'planar' } );
	controls.maxPitch = 89;
	controls.minAltitude = 0; // the controls would lift a 120 m camera at pitch 85 otherwise
	controls.setView( { lat, lon, distance, heading, pitch } );
	controls.update();
	return camera;

}

// MapLibre's zoom for a camera distance to the centre, the relation the
// benchmark uses to put both engines on the same ground
function zoomFor( distance ) {

	const metersPerPixel = distance * 2 * Math.tan( 0.5 * MAPLIBRE_FOV * Math.PI / 180 ) / HEIGHT;
	return Math.log2( 2 * Math.PI * EARTH_RADIUS / ( metersPerPixel * 512 ) );

}

describe( 'MapLibreUnderlay.cameraState', () => {

	it( 'reads the controls\' view back off the camera', () => {

		const view = { lat: 48.8606, lon: 2.3376, distance: 900, heading: 20, pitch: 50 };
		const state = MapLibreUnderlay.cameraState( placed( view ), HEIGHT );
		expect( state.lng ).toBeCloseTo( view.lon, 9 );
		expect( state.lat ).toBeCloseTo( view.lat, 9 );
		expect( state.bearing ).toBeCloseTo( view.heading, 9 );
		expect( state.pitch ).toBeCloseTo( view.pitch, 9 );
		expect( state.roll ).toBeCloseTo( 0, 9 );
		expect( state.zoom ).toBeCloseTo( zoomFor( view.distance ), 9 );
		expect( state.fov ).toBe( MAPLIBRE_FOV );

	} );

	it( 'is exact straight down and at a steep pitch, and turns with the heading', () => {

		for ( const view of [
			{ lat: 0, lon: 0, distance: 5000, heading: 0, pitch: 0 },
			{ lat: - 33.8688, lon: 151.2093, distance: 120, heading: 270, pitch: 85 },
			{ lat: 69.65, lon: 18.96, distance: 30000, heading: 135, pitch: 30 },
		] ) {

			const state = MapLibreUnderlay.cameraState( placed( view ), HEIGHT );
			expect( state.lng ).toBeCloseTo( view.lon, 7 );
			expect( state.lat ).toBeCloseTo( view.lat, 7 );
			expect( ( ( state.bearing - view.heading ) % 360 + 540 ) % 360 - 180 ).toBeCloseTo( 0, 7 );
			expect( state.pitch ).toBeCloseTo( view.pitch, 7 );
			expect( state.zoom ).toBeCloseTo( zoomFor( view.distance ), 7 );

		}

	} );

	it( 'reads a rolled camera, and gives up on one that sees no ground', () => {

		const camera = placed( { lat: 48.8606, lon: 2.3376, distance: 900, heading: 0, pitch: 45 } );
		camera.rotateZ( 10 * Math.PI / 180 ); // roll about the view axis
		camera.updateMatrixWorld();
		const rolled = MapLibreUnderlay.cameraState( camera, HEIGHT );
		expect( Math.abs( rolled.roll ) ).toBeCloseTo( 10, 6 );
		expect( rolled.pitch ).toBeCloseTo( 45, 6 );

		const sky = placed( { lat: 48.8606, lon: 2.3376, distance: 900, heading: 0, pitch: 45 } );
		sky.lookAt( sky.position.x, sky.position.y + 1000, sky.position.z - 1000 );
		sky.updateMatrixWorld();
		expect( MapLibreUnderlay.cameraState( sky, HEIGHT ) ).toBeNull();

	} );

	it( 'drives a map only when something changed', () => {

		const calls = [];
		const map = {
			setMaxPitch: v => calls.push( [ 'maxPitch', v ] ),
			setVerticalFieldOfView: v => calls.push( [ 'fov', v ] ),
			jumpTo: o => calls.push( [ 'jump', o ] ),
			getCanvas: () => ( { clientHeight: HEIGHT } ),
		};
		const underlay = new MapLibreUnderlay( map );
		const camera = placed( { lat: 48.8606, lon: 2.3376, distance: 900, heading: 20, pitch: 50 } );
		expect( underlay.sync( camera ) ).toBe( true );
		expect( underlay.sync( camera ) ).toBe( true );
		const jumps = calls.filter( c => c[ 0 ] === 'jump' );
		expect( jumps.length ).toBe( 1 ); // the second frame had nothing new
		expect( jumps[ 0 ][ 1 ].center[ 0 ] ).toBeCloseTo( 2.3376, 9 );
		expect( calls.find( c => c[ 0 ] === 'maxPitch' )[ 1 ] ).toBe( 180 );
		expect( calls.find( c => c[ 0 ] === 'fov' )[ 1 ] ).toBe( MAPLIBRE_FOV );

	} );

} );
