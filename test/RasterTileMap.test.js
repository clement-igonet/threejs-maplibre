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

const rendererStub = { domElement: { height: 800 }, initTexture() {} };

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

	it( 'culls tiles beyond the horizon, whatever the far plane', () => {

		const map = new RasterTileMap( createStubSource(), { mode: 'globe' } );
		const surface = latLonToEcef( 48.8566, 2.3522, 0, new Vector3() );
		const eye = latLonToEcef( 48.8566, 2.3522, 4000, new Vector3() );
		// the far plane at 1e8 m reaches through the planet: without a horizon
		// test the frustum picks up tiles on the far side of the globe
		map.update( createCamera( eye, surface ), rendererStub );

		const down = eye.clone().normalize();
		for ( const record of map._records.values() ) {

			if ( record.lastUsed !== map._frame ) continue;
			// every tile in use touches the 10 degrees around the point below the camera
			const angle = Math.acos( record.cone.direction.dot( down ) ) - record.cone.halfAngle;
			expect( angle, record.key ).toBeLessThan( 10 * Math.PI / 180 );

		}

		expect( map.stats.culled ).toBeGreaterThan( 0 );
		map.dispose();

	} );

	it( 'keeps large tiles outside a pitched view out of the selection', () => {

		const map = new RasterTileMap( createStubSource(), { mode: 'globe' } );
		const eye = latLonToEcef( 48.8566, 2.3522, 1000, new Vector3() );
		// looking north-north-east at 50 degrees of pitch: the frustum continues
		// underground, where an axis-aligned box around a big curved tile would
		// meet it a few hundred kilometers away
		const target = latLonToEcef( 48.8666, 2.3572, 0, new Vector3() );
		map.update( createCamera( eye, target ), rendererStub );

		const down = eye.clone().normalize();
		for ( const record of map._records.values() ) {

			if ( record.lastUsed !== map._frame ) continue;
			const angle = Math.acos( record.cone.direction.dot( down ) ) - record.cone.halfAngle;
			expect( angle, record.key ).toBeLessThan( 1 * Math.PI / 180 );

		}

		map.dispose();

	} );

	it( 'requests ancestors for backfill only near the leaves', () => {

		const surface = latLonToEcef( 48.8566, 2.3522, 0, new Vector3() );
		const eye = latLonToEcef( 48.8566, 2.3522, 500, new Vector3() );
		const loading = map => [ ...map._records.values() ].filter( r => r.state === 'loading' ).map( r => r.key );

		const map = new RasterTileMap( createStubSource(), { mode: 'globe' } );
		map.update( createCamera( eye, surface ), rendererStub );
		const withBackfill = loading( map );
		expect( withBackfill ).not.toContain( '0/0/0' );
		expect( withBackfill.some( key => key.startsWith( `${ maxSelectedZoom( map ) - 3 }/` ) ) ).toBe( true );
		map.dispose();

		const leavesOnly = new RasterTileMap( createStubSource(), { mode: 'globe', backfillLevels: 0 } );
		leavesOnly.update( createCamera( eye, surface ), rendererStub );
		expect( loading( leavesOnly ).length ).toBeLessThan( withBackfill.length );
		expect( loading( leavesOnly ).length ).toBe( leavesOnly.stats.selected );
		leavesOnly.dispose();

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

	it( 'uploads ready textures within the per-frame budget, ancestors covering meanwhile', () => {

		const uploads = [];
		const slowRenderer = { domElement: { height: 800 }, initTexture( texture ) {

			uploads.push( texture );
			const t0 = performance.now();
			while ( performance.now() - t0 < 3 ); // one upload alone exhausts the budget

		} };
		const map = new RasterTileMap( createStubSource( { maxZoom: 1 } ), { mode: 'globe', uploadBudgetMs: 2, fadeDuration: 0 } );

		// every tile down to maxZoom is already decoded, as if just loaded
		const fakeTexture = () => ( { userData: {}, dispose() {} } );
		for ( const key of [ '0/0/0', '1/0/0', '1/1/0', '1/0/1', '1/1/1' ] ) map._cache.set( key, fakeTexture() );

		const eye = latLonToEcef( 48.8566, 2.3522, 500, new Vector3() );
		const camera = createCamera( eye, latLonToEcef( 48.8566, 2.3522, 0, new Vector3() ) );

		map.update( camera, slowRenderer );
		expect( map.stats.uploaded ).toBe( 1 ); // the budget lets exactly one through
		expect( map.stats.rendered ).toBe( 0 ); // nothing was uploaded before the walk

		let frames = 1;
		while ( uploads.length < 3 && frames < 10 ) {

			map.update( camera, slowRenderer );
			frames ++;

		}

		// the two northern z1 tiles (Paris sits 2 degrees from their shared edge,
		// the southern ones are past the horizon) and the root behind them
		expect( uploads.length ).toBe( 3 );
		expect( frames ).toBe( 3 );
		expect( map.stats.rendered ).toBeGreaterThan( 0 );

		// a fast renderer takes everything in one frame
		const fastMap = new RasterTileMap( createStubSource( { maxZoom: 1 } ), { mode: 'globe' } );
		for ( const key of [ '0/0/0', '1/0/0', '1/1/0', '1/0/1', '1/1/1' ] ) fastMap._cache.set( key, fakeTexture() );
		fastMap.update( camera, rendererStub );
		expect( fastMap.stats.uploaded ).toBe( 3 );

		map.dispose();
		fastMap.dispose();

	} );

} );
