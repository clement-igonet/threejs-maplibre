import { describe, expect, it } from 'vitest';
import { BatchedMesh, Matrix4, PerspectiveCamera, Vector3 } from 'three';
import { VectorTileMap } from '../src/three/VectorTileMap.js';
import { VectorLineMaterial } from '../src/three/VectorLineMaterial.js';
import { Style } from '../src/style/Style.js';
import { latLonToEcef } from '../src/math/Ellipsoid.js';
import { latitudeToNormalized, longitudeToNormalized, normalizedToMeters } from '../src/math/WebMercator.js';
import { createStubVectorSource } from '../demo/stub-vector-tiles.js';
import { STUB_STYLE } from '../demo/stub-style.js';

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

// a camera over the stub city, looking down from "altitude" meters
function cityCamera( altitude ) {

	const surface = latLonToEcef( 48.8566, 2.3522, 0, new Vector3() );
	const eye = latLonToEcef( 48.8566, 2.3522, altitude, new Vector3() );
	return createCamera( eye, surface );

}

// what the tiles in a batch hold, holes left by dropped ones aside
function usedVertices( batch ) {

	let vertices = 0;
	for ( const info of batch._geometryInfo ) if ( info.active ) vertices += info.reservedVertexCount;
	return vertices;

}

// runs frames until every selected tile is built and drawn, or gives up
async function settle( map, camera, frames = 40 ) {

	for ( let i = 0; i < frames; i ++ ) {

		map.update( camera, rendererStub );
		if ( map.stats.loading === 0 && map.stats.rendered >= map.stats.selected && map.stats.rendered > 0 ) return;
		await new Promise( resolve => setTimeout( resolve, 20 ) );

	}

}

function createMap( options = {} ) {

	return new VectorTileMap( createStubVectorSource(), new Style( STUB_STYLE ), { workers: 0, createWorker: () => null, ...options } );

}

describe( 'VectorTileMap', () => {

	it( 'derives the MapLibre zoom from the camera altitude', () => {

		const map = createMap();
		map.update( cityCamera( 500 ), rendererStub );
		const near = map.zoom;
		map.update( cityCamera( 4000 ), rendererStub );
		const far = map.zoom;

		// eight times higher is three zoom levels out
		expect( near - far ).toBeCloseTo( 3, 1 );
		expect( near ).toBeGreaterThan( 15 );
		expect( near ).toBeLessThan( 19 );
		map.dispose();

	} );

	it( 'draws the selected tiles as instances of one batch per style layer, in style order', async () => {

		const map = createMap();
		const camera = cityCamera( 500 );
		await settle( map, camera );

		expect( map.stats.rendered ).toBeGreaterThan( 0 );
		expect( map.stats.built ).toBeGreaterThan( 0 );

		let instances = 0;
		const shown = new Set();
		for ( const record of map._records.values() ) {

			if ( record.state !== 'ready' || ! record.object ) continue;
			expect( record.content.uploaded ).toBe( true );
			let last = - 1;
			for ( const { entry, id } of record.object.instances ) {

				expect( entry.batch ).toBeInstanceOf( BatchedMesh );
				expect( entry.batch.renderOrder ).toBeGreaterThanOrEqual( last );
				last = entry.batch.renderOrder;
				expect( entry.batch.getVisibleAt( id ) ).toBe( record.object.visible );
				if ( record.object.visible ) shown.add( entry.batch );
				instances ++;

			}

		}

		// many tiles, a handful of objects: one batch per style layer and block type
		expect( instances ).toBeGreaterThan( map._materials.size );
		expect( shown.size ).toBeGreaterThan( 0 );
		expect( shown.size ).toBeLessThanOrEqual( map._materials.size );
		expect( map._materials.size ).toBeLessThanOrEqual( 5 ); // park, water, two roads, buildings
		for ( const batch of shown ) expect( batch.parent ).toBe( map );
		map.dispose();

	} );

	it( 'places instances relative to a floating origin that follows the camera', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );

		const record = [ ...map._records.values() ].find( r => r.object && r.object.visible );
		const { entry, id } = record.object.instances[ 0 ];
		const matrix = new Matrix4();
		entry.batch.getMatrixAt( id, matrix );
		const offset = new Vector3().setFromMatrixPosition( matrix );
		// the origin sits at the camera: the tile is a few hundred meters away, not millions
		expect( offset.length() ).toBeLessThan( 5000 );
		// and it lands where it belongs, to the centimeter float32 leaves
		expect( offset.clone().add( entry.batch.position ).distanceTo( record.content.center ) ).toBeLessThan( 0.05 );

		// a camera 100 km away moves the origin and rewrites the matrix
		const before = entry.batch.position.clone();
		const surface = latLonToEcef( 48.8566, 3.7, 0, new Vector3() );
		map.update( createCamera( latLonToEcef( 48.8566, 3.7, 500, new Vector3() ), surface ), rendererStub );
		expect( entry.batch.position.distanceTo( before ) ).toBeGreaterThan( 50000 );
		entry.batch.getMatrixAt( id, matrix );
		expect( new Vector3().setFromMatrixPosition( matrix ).add( entry.batch.position ).distanceTo( record.content.center ) ).toBeLessThan( 0.05 );
		map.dispose();

	} );

	it( 'shares one material and one batch per style layer and block type', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );

		const materials = new Set();
		const batches = new Set();
		for ( const record of map._records.values() ) {

			if ( ! record.object ) continue;
			for ( const { entry } of record.object.instances ) {

				materials.add( entry.material );
				batches.add( entry.batch );
				expect( entry.batch.material ).toBe( entry.material );

			}

		}

		expect( materials.size ).toBe( batches.size );
		expect( materials.size ).toBeGreaterThan( 0 );
		expect( materials.size ).toBeLessThanOrEqual( map._materials.size );
		expect( map._materials.size ).toBeLessThanOrEqual( 5 ); // park, water, two roads, buildings

		const lines = [ ...map._materials.values() ].filter( e => e.type === 'line' );
		expect( lines.length ).toBe( 2 );
		for ( const { material } of lines ) {

			expect( material ).toBeInstanceOf( VectorLineMaterial );
			expect( material.uniforms.pixelScale.value ).toBeGreaterThan( 0 );
			// the stub road width interpolates on zoom: a uniform, scaled per frame
			expect( material.uniforms.propScale.value.x ).toBeGreaterThan( 1 );

		}

		map.dispose();

	} );

	it( 'grows a batch past its starting capacity and reuses the space of dropped tiles', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );
		const [ key, entry ] = [ ...map._materials.entries() ].find( ( [ , e ] ) => e.type === 'fill-extrusion' );
		const batch = entry.batch;
		const vertices0 = batch._maxVertexCount;
		const instances0 = batch.maxInstanceCount;

		// a block the size of the whole starting buffer forces a resize
		const n = vertices0;
		const index = Number( key.split( ':' )[ 0 ] );
		const bigTile = () => ( { center: new Vector3(), blocks: [ { id: 'big', index, type: 'fill-extrusion', positions: new Float32Array( 3 * n ), colors: new Uint8Array( 4 * n ), indices: new Uint32Array( 3 * n ) } ] } );

		const built = bigTile();
		map._upload( built );
		const grown = batch._maxVertexCount;
		expect( grown ).toBeGreaterThan( vertices0 );
		expect( batch._maxIndexCount ).toBeGreaterThanOrEqual( 3 * n );
		// the Worker's arrays are gone once the batch holds them
		expect( built.blocks[ 0 ].positions ).toBeUndefined();

		// dropping it gives the buffers back, and the next tile still fits
		map._disposeContent( built );
		expect( batch._maxVertexCount ).toBeLessThan( grown );
		expect( batch._maxVertexCount ).toBeGreaterThanOrEqual( usedVertices( batch ) );
		const again = bigTile();
		map._upload( again );
		expect( batch._maxVertexCount ).toBeGreaterThanOrEqual( n );

		// instances grow the same way, and dropped ones free their slot
		const objects = [];
		for ( let i = 0; i <= instances0; i ++ ) objects.push( map._createObject( { content: again } ) );
		expect( batch.maxInstanceCount ).toBeGreaterThan( instances0 );
		expect( entry.instances ).toBeGreaterThan( instances0 );
		for ( const object of objects ) map._disposeObject( { object } );
		expect( entry.instances ).toBeLessThanOrEqual( instances0 );
		map._disposeContent( again );
		map.dispose();

	} );

	it( 'stops at the view distance, and asks for nothing past it', async () => {

		// 20 km up, so a 5 km view reaches nothing: the distance is to the
		// tile's content box, which stands contentHeight above the surface
		const near = createMap( { viewDistance: 5000 } );
		near.update( cityCamera( 20000 ), rendererStub );
		expect( near.stats.selected ).toBe( 0 );
		expect( near.stats.culled ).toBeGreaterThan( 0 );
		// the walk still descends through the big boxes of the coarse levels,
		// but nothing out there is ever asked for
		expect( near.stats.loading ).toBe( 0 );
		expect( [ ...near._records.values() ].every( r => r.state === 'empty' ) ).toBe( true );
		near.dispose();

		// the same view without one selects what is under it
		const far = createMap();
		far.update( cityCamera( 20000 ), rendererStub );
		expect( far.stats.selected ).toBeGreaterThan( 0 );
		far.dispose();

		// and a distance past the ground keeps all of it
		const enough = createMap( { viewDistance: 100000 } );
		enough.update( cityCamera( 20000 ), rendererStub );
		expect( enough.stats.selected ).toBe( far.stats.selected );
		enough.dispose();

	} );

	it( 'asks for the deepest tiles around a camera under the street', () => {

		// a walk's camera at -9 m, 4 m behind and over a character in a
		// station, looking down at it: the tile boxes reach contentDepth under the street, so
		// the tile under the character is the source's deepest one; boxes
		// that start at the street left the camera outside all of them, and
		// a coarse tile without colliders stood in under the character
		const [ mx, my ] = normalizedToMeters( longitudeToNormalized( 2.3522 ), latitudeToNormalized( 48.8566 ) );
		const camera = createCamera( new Vector3( mx, - 9, - my + 4 ), new Vector3( mx, - 12, - my ) );
		const z = 16, x = Math.floor( longitudeToNormalized( 2.3522 ) * 2 ** z ), y = Math.floor( latitudeToNormalized( 48.8566 ) * 2 ** z );
		// the tiles the walk picks to draw, read off its leaves
		const leaves = map => {

			const picked = new Set(), select = map._select.bind( map );
			map._select = ( ...args ) => { const node = select( ...args ); if ( node && node.children === null ) picked.add( map._key( node.record.x, node.record.y, node.record.z ) ); return node; };
			map.update( camera, rendererStub );
			return picked;

		};

		const deep = createMap( { mode: 'planar' } );
		expect( deep.contentDepth ).toBe( 60 );
		expect( leaves( deep ).has( deep._key( x, y, z ) ) ).toBe( true );
		deep.dispose();

		const flat = createMap( { mode: 'planar', contentDepth: 0 } );
		expect( leaves( flat ).has( flat._key( x, y, z ) ) ).toBe( false );
		flat.dispose();

		const globe = createMap();
		expect( globe.contentDepth ).toBe( 0 ); // the globe's selection is as it was
		globe.dispose();

	} );

	it( 'weighs what each tile holds, and what is resident in all', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );
		let total = 0;
		for ( const record of map._records.values() ) {

			if ( ! record.content ) continue;
			expect( record.content.bytes ).toBeGreaterThan( 0 );
			expect( map._contentBytes( record.content ) ).toBe( record.content.bytes );
			total += record.content.bytes;

		}

		expect( total ).toBeGreaterThan( 0 );
		expect( map.stats.residentBytes ).toBe( total + map._cache.bytes );
		map.dispose();

	} );

	it( 'lets go of tiles unused for retainMs, counted in time rather than frames', async () => {

		// retention 0: a tile not drawn this frame is parked this frame
		const quick = createMap( { retainMs: 0 } );
		await settle( quick, cityCamera( 500 ) );
		const held = [ ...quick._records.values() ].filter( r => r.content ).length;
		expect( held ).toBeGreaterThan( 0 );
		await new Promise( resolve => setTimeout( resolve, 5 ) );
		// look somewhere else: nothing of the city is drawn any more
		quick.update( createCamera( latLonToEcef( 48.8566, 3.7, 500, new Vector3() ), latLonToEcef( 48.8566, 3.7, 0, new Vector3() ) ), rendererStub );
		expect( quick._cache.size ).toBe( held );
		expect( quick._cache.bytes ).toBeGreaterThan( 0 );
		expect( [ ...quick._records.values() ].filter( r => r.content ).length ).toBe( 0 );
		quick.dispose();

		// a long retention keeps them, however many frames go by
		const patient = createMap( { retainMs: 600000 } );
		await settle( patient, cityCamera( 500 ) );
		for ( let i = 0; i < 100; i ++ ) patient.update( createCamera( latLonToEcef( 48.8566, 3.7, 500, new Vector3() ), latLonToEcef( 48.8566, 3.7, 0, new Vector3() ) ), rendererStub );
		expect( patient._cache.size ).toBe( 0 );
		expect( [ ...patient._records.values() ].filter( r => r.content ).length ).toBeGreaterThan( 0 );
		patient.dispose();

	} );

	it( 'starts no new load past the memory budget, loads in flight included, and says so', async () => {

		// one byte of budget: the first load of the first frame goes out
		// (nothing resident, nothing in flight), the second is already over
		// budget by the in-flight estimate, so one tile lands, no more
		const map = createMap( { memoryBudget: 1 } );
		map.update( cityCamera( 500 ), rendererStub );
		expect( map.stats.loading ).toBe( 1 );
		expect( map.stats.refused ).toBeGreaterThan( 0 );
		await settle( map, cityCamera( 500 ) );
		const loaded = map.stats.built;
		expect( loaded ).toBe( 1 );
		expect( map.stats.residentBytes ).toBeGreaterThan( 1 );

		// a view that wants other tiles gets none of them
		for ( let i = 0; i < 5; i ++ ) map.update( cityCamera( 4000 ), rendererStub );
		await new Promise( resolve => setTimeout( resolve, 50 ) );
		expect( map.stats.refused ).toBeGreaterThan( 0 );
		expect( map.stats.loading ).toBe( 0 );
		expect( map.stats.built ).toBe( loaded );
		map.dispose();

	} );

	it( 'gives parked content back before refusing a tile in view', async () => {

		// a budget that fits the city once: park it, come back, it is taken
		// from the cache; look elsewhere, the parked tiles make room
		const map = createMap( { retainMs: 0, memoryBudget: 64 * 1048576 } );
		await settle( map, cityCamera( 500 ) );
		const city = map.stats.residentBytes;
		expect( city ).toBeGreaterThan( 0 );
		await new Promise( resolve => setTimeout( resolve, 5 ) );
		const away = createCamera( latLonToEcef( 48.8566, 3.7, 500, new Vector3() ), latLonToEcef( 48.8566, 3.7, 0, new Vector3() ) );
		map.update( away, rendererStub );
		const parked = map._cache.size;
		expect( parked ).toBeGreaterThan( 0 );
		// now the budget is spent by what is parked, and a third place asks
		// for tiles: they evict the parked ones first, and a refusal only
		// ever happens once the cache is empty
		map.memoryBudget = map._cache.bytes + 1;
		const elsewhere = createCamera( latLonToEcef( 48.8566, 5.0, 500, new Vector3() ), latLonToEcef( 48.8566, 5.0, 0, new Vector3() ) );
		map.update( elsewhere, rendererStub );
		expect( map._cache.size ).toBeLessThan( parked );
		if ( map.stats.refused > 0 ) expect( map._cache.size ).toBe( 0 );
		expect( map.stats.loading + map.stats.refused ).toBeGreaterThan( 0 );
		map.dispose();

	} );

	it( 'keeps no more loads in flight than maxLoading', async () => {

		const map = createMap( { maxLoading: 2 } );
		map.update( cityCamera( 500 ), rendererStub );
		expect( map.stats.loading ).toBe( 2 );
		// the rest wait their turn and get it as those land
		await settle( map, cityCamera( 500 ) );
		expect( map.stats.built ).toBeGreaterThan( 2 );
		expect( map.stats.loading ).toBe( 0 );
		map.dispose();

	} );

	it( 'reports what the batches reserve and what the tiles in them occupy', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );

		expect( map.stats.geometryBytes ).toBeGreaterThan( 0 );
		expect( map.stats.batchBytes ).toBeGreaterThanOrEqual( map.stats.geometryBytes );
		// the reserve is room for tiles to come, not a slab per layer
		expect( map.stats.batchBytes ).toBeLessThan( 8 * map.stats.geometryBytes );
		map.dispose();

	} );

	it( 'evaluates camera-kind properties into the materials each frame', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );

		const road = [ ...map._materials.values() ].find( e => e.layer.id === 'road-residential' );
		const buildings = [ ...map._materials.values() ].find( e => e.layer.id === 'building-3d' );
		const nearWidth = road.material.uniforms.propScale.value.x;
		expect( buildings.material.opacity ).toBeCloseTo( 0.9, 6 );
		expect( buildings.material.transparent ).toBe( true );
		expect( road.material.visible ).toBe( true );

		// zooming out shrinks the road and hides the layers below their minzoom
		map.update( cityCamera( 40000 ), rendererStub );
		expect( road.material.uniforms.propScale.value.x ).toBeLessThan( nearWidth );
		expect( map.zoom ).toBeLessThan( 12 );
		expect( road.material.visible ).toBe( false );
		expect( buildings.material.visible ).toBe( false );

		map.dispose();

	} );

	it( 'keeps an empty tile as an object without instances', async () => {

		const map = createMap();
		const built = await map._load( { key: '14/0/0', x: 0, y: 0, z: 14 } );
		expect( built.blocks ).toEqual( [] );
		map._upload( built );
		const object = map._createObject( { content: built } );
		expect( object.instances.length ).toBe( 0 );
		map.dispose();

	} );

	it( 'disposes materials and batches', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );
		const entries = [ ...map._materials.values() ];
		expect( entries.length ).toBeGreaterThan( 0 );
		let disposed = 0;
		for ( const { material, batch } of entries ) {

			material.addEventListener( 'dispose', () => disposed ++ );
			batch.geometry.addEventListener( 'dispose', () => disposed ++ );

		}

		map.dispose();
		expect( disposed ).toBe( 2 * entries.length );
		for ( const { batch } of entries ) expect( batch._matricesTexture ).toBe( null ); // its instance textures too
		expect( map._materials.size ).toBe( 0 );
		expect( map.children.length ).toBe( 0 );

	} );

} );
