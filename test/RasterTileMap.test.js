import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { RasterTileMap } from '../src/three/RasterTileMap.js';
import { latLonToEcef, WGS84_RADIUS } from '../src/math/Ellipsoid.js';

// a source whose fetches always fail fast: selection logic runs, textures
// never resolve, which is all these tests need
function createStubSource( { minZoom = 0, maxZoom = 19 } = {} ) {

	return {
		minZoom, maxZoom,
		tileResolution: 256,
		attribution: '',
		tileUrl: ( x, y, z ) => `data:text/plain,${ z }/${ x }/${ y }`,
	};

}

const rendererStub = { domElement: { height: 800 } };

function createCamera( position, target ) {

	const camera = new PerspectiveCamera( 60, 1, 1, 1e8 );
	camera.position.copy( position );
	camera.lookAt( target );
	camera.updateMatrixWorld( true );
	camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();
	camera.updateProjectionMatrix();
	return camera;

}

function maxSelectedZoom( map ) {

	let max = - 1;
	for ( const record of map._records.values() ) {

		if ( record.lastUsed === map._frame ) max = Math.max( max, record.z );

	}

	return max;

}

describe( 'RasterTileMap selection', () => {

	it( 'selects coarse tiles when the whole globe is in view', () => {

		const map = new RasterTileMap( createStubSource(), { mode: 'globe' } );
		const camera = createCamera( new Vector3( 4 * WGS84_RADIUS, 0, 0 ), new Vector3() );
		map.update( camera, rendererStub );

		expect( map.stats.selected ).toBeGreaterThan( 0 );
		expect( maxSelectedZoom( map ) ).toBeLessThanOrEqual( 4 );
		map.dispose();

	} );

	it( 'refines toward the source maxZoom near the surface', () => {

		const map = new RasterTileMap( createStubSource(), { mode: 'globe' } );
		const surface = latLonToEcef( 48.8566, 2.3522, 0, new Vector3() );
		const eye = latLonToEcef( 48.8566, 2.3522, 500, new Vector3() );
		const camera = createCamera( eye, surface );
		map.update( camera, rendererStub );

		expect( maxSelectedZoom( map ) ).toBeGreaterThanOrEqual( 15 );
		map.dispose();

	} );

	it( 'never refines past the source maxZoom', () => {

		const map = new RasterTileMap( createStubSource( { maxZoom: 8 } ), { mode: 'globe' } );
		const surface = latLonToEcef( 48.8566, 2.3522, 0, new Vector3() );
		const eye = latLonToEcef( 48.8566, 2.3522, 100, new Vector3() );
		map.update( createCamera( eye, surface ), rendererStub );

		expect( maxSelectedZoom( map ) ).toBe( 8 );
		map.dispose();

	} );

	it( 'culls tiles behind the camera', () => {

		const map = new RasterTileMap( createStubSource(), { mode: 'globe' } );
		const eye = latLonToEcef( 48.8566, 2.3522, 2000, new Vector3() );
		// look straight up, away from the planet
		const camera = createCamera( eye, eye.clone().multiplyScalar( 2 ) );
		map.update( camera, rendererStub );

		expect( map.stats.culled ).toBeGreaterThan( 0 );
		map.dispose();

	} );

	it( 'selects planar tiles the same way', () => {

		const map = new RasterTileMap( createStubSource(), { mode: 'planar' } );
		// 500 m over Paris in mercator meters, looking straight down
		const camera = createCamera( new Vector3( 261848, 500, - 6250565 ), new Vector3( 261848, 0, - 6250565 ) );
		camera.up.set( 0, 0, - 1 );
		camera.lookAt( 261848, 0, - 6250565 );
		camera.updateMatrixWorld( true );
		camera.matrixWorldInverse.copy( camera.matrixWorld ).invert();
		map.update( camera, rendererStub );

		expect( maxSelectedZoom( map ) ).toBeGreaterThanOrEqual( 15 );
		map.dispose();

	} );

	it( 'aborts loads for tiles that leave the selection', async () => {

		const map = new RasterTileMap( createStubSource(), { mode: 'globe' } );
		const surface = latLonToEcef( 48.8566, 2.3522, 0, new Vector3() );
		const eye = latLonToEcef( 48.8566, 2.3522, 500, new Vector3() );
		map.update( createCamera( eye, surface ), rendererStub );

		// move to the antipode: everything from the first frame is stale
		const surface2 = latLonToEcef( - 48.8566, - 177.6478, 0, new Vector3() );
		const eye2 = latLonToEcef( - 48.8566, - 177.6478, 500, new Vector3() );
		map.update( createCamera( eye2, surface2 ), rendererStub );
		map.update( createCamera( eye2, surface2 ), rendererStub );

		// give aborted fetch promises a tick to settle
		await new Promise( resolve => setTimeout( resolve, 50 ) );

		for ( const record of map._records.values() ) {

			if ( record.lastUsed < map._frame - 1 ) {

				expect( record.state ).not.toBe( 'loading' );

			}

		}

		map.dispose();

	} );

} );
