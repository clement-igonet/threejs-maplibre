import { describe, expect, it } from 'vitest';
import { Group, Mesh, PerspectiveCamera, Vector3 } from 'three';
import { VectorTileMap } from '../src/three/VectorTileMap.js';
import { VectorLineMaterial } from '../src/three/VectorLineMaterial.js';
import { Style } from '../src/style/Style.js';
import { latLonToEcef } from '../src/math/Ellipsoid.js';
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

	it( 'builds the selected tiles into groups of meshes in style order', async () => {

		const map = createMap();
		const camera = cityCamera( 500 );
		await settle( map, camera );

		expect( map.stats.rendered ).toBeGreaterThan( 0 );
		expect( map.stats.built ).toBeGreaterThan( 0 );

		let meshes = 0;
		for ( const record of map._records.values() ) {

			if ( record.state !== 'ready' || ! record.object ) continue;
			expect( record.object ).toBeInstanceOf( Group );
			expect( record.content.uploaded ).toBe( true );
			let last = - 1;
			for ( const mesh of record.object.children ) {

				expect( mesh ).toBeInstanceOf( Mesh );
				expect( mesh.renderOrder ).toBeGreaterThanOrEqual( last );
				last = mesh.renderOrder;
				expect( mesh.geometry.boundingSphere ).not.toBeNull();
				meshes ++;

			}

		}

		expect( meshes ).toBeGreaterThan( 0 );
		map.dispose();

	} );

	it( 'shares one material per style layer and block type', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );

		const materials = new Set();
		for ( const record of map._records.values() ) {

			if ( ! record.object ) continue;
			for ( const mesh of record.object.children ) materials.add( mesh.material );

		}

		expect( materials.size ).toBe( map._materials.size );
		expect( materials.size ).toBeLessThanOrEqual( 5 ); // park, water, two roads, buildings

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

	it( 'keeps an empty tile as an empty group', async () => {

		const map = createMap();
		const built = await map._load( { key: '14/0/0', x: 0, y: 0, z: 14 } );
		expect( built.blocks ).toEqual( [] );
		map._upload( built );
		const group = map._createObject( { content: built } );
		expect( group.children.length ).toBe( 0 );
		map.dispose();

	} );

	it( 'disposes materials and geometries', async () => {

		const map = createMap();
		await settle( map, cityCamera( 500 ) );
		const materials = [ ...map._materials.values() ].map( e => e.material );
		expect( materials.length ).toBeGreaterThan( 0 );
		let disposed = 0;
		for ( const material of materials ) material.addEventListener( 'dispose', () => disposed ++ );
		map.dispose();
		expect( disposed ).toBe( materials.length );
		expect( map._materials.size ).toBe( 0 );

	} );

} );
