import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { MapControls } from '../src/three/MapControls.js';
import { geocentricHeight, latLonToEcef, WGS84_RADIUS } from '../src/math/Ellipsoid.js';
import { latitudeToNormalized, longitudeToNormalized, normalizedToMeters } from '../src/math/WebMercator.js';

const PARIS = { lat: 48.8566, lon: 2.3522 };

// enough of an element for the pixel math; no events are dispatched here
const fakeElement = { clientWidth: 800, clientHeight: 500, style: {}, addEventListener() {}, removeEventListener() {} };

function createControls( view, options ) {

	const camera = new PerspectiveCamera( 60, 1.6, 10, 1e8 );
	const controls = new MapControls( camera, fakeElement, options );
	controls.setView( view );
	controls.update();
	return { camera, controls };

}

function groundDistance( a, b ) {

	return a.angleTo( b ) * WGS84_RADIUS;

}

describe( 'MapControls', () => {

	it( 'places the camera at the distance above the center, looking down, north up', () => {

		const { camera } = createControls( { ...PARIS, distance: 2000, heading: 0, pitch: 0 } );
		const center = latLonToEcef( PARIS.lat, PARIS.lon, 0, new Vector3() );
		expect( geocentricHeight( camera.position ) ).toBeCloseTo( 2000, - 1 );
		expect( camera.position.distanceTo( center ) ).toBeCloseTo( 2000, 3 );

		// the camera's up axis points north: towards the pole, in the tangent plane
		const up = new Vector3( 0, 1, 0 ).applyQuaternion( camera.quaternion );
		const north = latLonToEcef( PARIS.lat + 0.01, PARIS.lon, 0, new Vector3() ).sub( center ).normalize();
		expect( up.dot( north ) ).toBeGreaterThan( 0.9999 );

	} );

	it( 'pitches the view by lowering the camera behind the center', () => {

		const { camera } = createControls( { ...PARIS, distance: 2000, heading: 0, pitch: 60 } );
		const center = latLonToEcef( PARIS.lat, PARIS.lon, 0, new Vector3() );
		expect( camera.position.distanceTo( center ) ).toBeCloseTo( 2000, 3 );
		expect( geocentricHeight( camera.position ) ).toBeCloseTo( 2000 * Math.cos( Math.PI / 3 ), - 1 );
		// heading 0: the camera sits 2000 * sin(60) m south of the center
		const south = latLonToEcef( PARIS.lat - 2000 * Math.sin( Math.PI / 3 ) / WGS84_RADIUS * 180 / Math.PI, PARIS.lon, 1000, new Vector3() );
		expect( camera.position.distanceTo( south ) ).toBeLessThan( 20 );

	} );

	it( 'pans by what the pixels cover at the center, along the heading', () => {

		const { controls } = createControls( { ...PARIS, distance: 2000, heading: 0, pitch: 0 } );
		const before = latLonToEcef( controls.lat, controls.lon, 0, new Vector3() );
		const mpp = 2 * 2000 * Math.tan( Math.PI / 6 ) / 500;
		expect( controls.metersPerPixel() ).toBeCloseTo( mpp, 6 );

		controls.panByPixels( 100, 0 ); // drag right: the center moves west
		const after = latLonToEcef( controls.lat, controls.lon, 0, new Vector3() );
		expect( groundDistance( before, after ) / ( 100 * mpp ) ).toBeCloseTo( 1, 2 ); // ellipsoid vs sphere: 0.4%
		expect( controls.lon ).toBeLessThan( PARIS.lon );
		expect( controls.lat ).toBeCloseTo( PARIS.lat, 6 );

		// facing east, the same drag moves the center north
		controls.setView( { ...PARIS, heading: 90 } );
		controls.panByPixels( 100, 0 );
		expect( controls.lat ).toBeGreaterThan( PARIS.lat );
		expect( controls.lon ).toBeCloseTo( PARIS.lon, 6 );

	} );

	it( 'zooms by a fixed fraction and keeps the ground under the cursor', () => {

		const { controls } = createControls( { ...PARIS, distance: 2000, heading: 0, pitch: 0 } );
		controls.zoomBy( 0.95 );
		expect( controls.distance ).toBeCloseTo( 1900, 6 );
		expect( controls.lat ).toBeCloseTo( PARIS.lat, 8 );

		// ground point 200 px right of the center, before and after a 2x zoom in
		const mppBefore = controls.metersPerPixel();
		const pointBefore = new Vector3();
		controls.moveByMeters( 200 * mppBefore, 0 );
		latLonToEcef( controls.lat, controls.lon, 0, pointBefore );
		controls.moveByMeters( - 200 * mppBefore, 0 );

		controls.zoomBy( 0.5, 200, 0 );
		const mppAfter = controls.metersPerPixel();
		controls.moveByMeters( 200 * mppAfter, 0 );
		const pointAfter = latLonToEcef( controls.lat, controls.lon, 0, new Vector3() );
		expect( groundDistance( pointBefore, pointAfter ) ).toBeLessThan( 0.5 );

	} );

	it( 'clamps pitch, latitude and the camera altitude', () => {

		const { controls, camera } = createControls( { ...PARIS, distance: 2000, heading: 0, pitch: 0 } );
		controls.rotateBy( 400, 120 );
		expect( controls.heading ).toBeCloseTo( 40, 6 );
		expect( controls.pitch ).toBe( 85 );

		controls.setView( { pitch: 60, distance: 10 } );
		controls.update();
		expect( geocentricHeight( camera.position ) ).toBeGreaterThan( 90 );

		controls.setView( { lat: 89, lon: 181 } );
		expect( controls.lat ).toBe( 85 );
		expect( controls.lon ).toBe( - 179 );

	} );

	it( 'places and pans the camera on the Web Mercator plane in planar mode', () => {

		const { camera, controls } = createControls( { ...PARIS, distance: 2000, heading: 0, pitch: 60 }, { mode: 'planar' } );
		const [ mx, my ] = normalizedToMeters( longitudeToNormalized( PARIS.lon ), latitudeToNormalized( PARIS.lat ) );
		// heading 0, pitch 60: 1000 m up, 1732 m south (+z) of the center
		expect( camera.position.x ).toBeCloseTo( mx, 3 );
		expect( camera.position.y ).toBeCloseTo( 1000, 3 );
		expect( camera.position.z ).toBeCloseTo( - my + 2000 * Math.sin( Math.PI / 3 ), 3 );
		const forward = new Vector3( 0, 0, - 1 ).applyQuaternion( camera.quaternion );
		expect( forward.z ).toBeLessThan( 0 ); // looking north
		expect( forward.y ).toBeCloseTo( - Math.cos( Math.PI / 3 ), 6 );

		// a drag right moves the center west by the mercator meters the pixels cover
		controls.setView( { pitch: 0 } );
		controls.panByPixels( 100, 0 );
		controls.update();
		expect( camera.position.x ).toBeCloseTo( mx - 100 * controls.metersPerPixel(), 3 );
		expect( controls.lat ).toBeCloseTo( PARIS.lat, 8 );

	} );

} );
