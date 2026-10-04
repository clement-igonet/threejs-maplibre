import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createGeoJSONVectorSource } from '../demo/geojson-vector-source.js';
import { STATION_STYLE } from '../demo/station-style.js';
import { buildTile } from '../src/build/buildTile.js';
import { appendWallRun, featureLevels } from '../src/build/buildIndoor.js';
import { decodeVectorTile } from '../src/core/decodeVectorTile.js';
import { Style } from '../src/style/Style.js';
import { VectorTileMap } from '../src/three/VectorTileMap.js';
import { latitudeToNormalized, longitudeToNormalized } from '../src/math/WebMercator.js';

// Gare Saint-Lazare, the committed extract, cut into tiles as the demo does
const { layers } = JSON.parse( readFileSync( new URL( '../demo/data/saint-lazare.json', import.meta.url ) ) );
const { source, tile } = createGeoJSONVectorSource( layers, { maxZoom: 16 } );
const style = new Style( STATION_STYLE );
const LAT = 48.8762, LON = 2.3253;

function build( z ) {

	const x = Math.floor( longitudeToNormalized( LON ) * 2 ** z ), y = Math.floor( latitudeToNormalized( LAT ) * 2 ** z );
	return buildTile( decodeVectorTile( tile( z, x, y ) ), style, { sourceId: 'openmaptiles', x, y, z, mode: 'planar' } );

}

const ys = block => { const out = []; for ( let i = 1; i < block.positions.length; i += 3 ) out.push( block.positions[ i ] ); return out; };

describe( 'indoor', () => {

	it( 'reads a feature\'s levels from the extract\'s list', () => {

		expect( featureLevels( { levels: '-1;0;1' } ) ).toEqual( [ - 1, 0, 1 ] );
		expect( featureLevels( { levels: '-2.5' } ) ).toEqual( [ - 2.5 ] );
		expect( featureLevels( {} ) ).toEqual( [] );

	} );

	it( 'draws a wall run on both sides, open or closed', () => {

		const projection = { project( x, y, h, out ) { out[ 0 ] = x; out[ 1 ] = h; out[ 2 ] = y; return out; } };
		const out = { positions: [], colors: [], indices: [], vertexCount: 0 };
		expect( appendWallRun( out, [ 0, 0, 10, 0, 10, 10 ], projection, [ 255, 255, 255, 255 ], 3, 5.5 ) ).toBe( 8 ); // 2 edges, 2 quads each
		expect( appendWallRun( out, [ 0, 0, 10, 0, 10, 10 ], projection, [ 255, 255, 255, 255 ], 3, 5.5, true ) ).toBe( 12 ); // 3 edges closed
		expect( Math.min( ...ys( out ) ) ).toBe( 3 );
		expect( Math.max( ...ys( out ) ) ).toBe( 5.5 );

	} );

	it( 'builds the station one block per level, floors and walls at their level\'s height', () => {

		const built = build( 16 );
		const floors = built.blocks.filter( b => b.id === 'indoor-floor' );
		const walls = built.blocks.filter( b => b.id === 'indoor-wall' );
		expect( floors.length ).toBeGreaterThan( 5 );
		expect( walls.length ).toBeGreaterThan( 5 );
		for ( const b of floors ) expect( typeof b.level ).toBe( 'number' );
		const ground = floors.find( b => b.level === 0 ), basement = floors.find( b => b.level === - 1 );
		expect( ground ).toBeDefined();
		expect( basement ).toBeDefined();
		// a slab at level n sits at 3n, 15 cm thick
		expect( Math.min( ...ys( ground ) ) ).toBeCloseTo( 0, 6 );
		expect( Math.max( ...ys( ground ) ) ).toBeCloseTo( 0.15, 6 );
		expect( Math.min( ...ys( basement ) ) ).toBeCloseTo( - 3, 6 );
		const wall0 = walls.find( b => b.level === 0 );
		expect( Math.max( ...ys( wall0 ) ) ).toBeCloseTo( 2.5, 6 );
		// the level outline is not a floor, the buildings are not levelled
		expect( built.blocks.find( b => b.id === 'building' && b.level !== undefined ) ).toBeUndefined();

	} );

	it( 'shows one level or all, and pulls them apart', () => {

		const map = new VectorTileMap( source, style, { mode: 'planar', sourceId: 'openmaptiles', workers: 0 } );
		const block = ( index, level ) => ( { index, type: 'fill-extrusion', level, positions: new Float32Array( 0 ), indices: new Uint16Array( 0 ) } );
		const layer = style.layers.findIndex( l => l.id === 'indoor-floor' );
		const a = map._entry( block( layer, 0 ) ), b = map._entry( block( layer, - 1 ) ), c = map._entry( { index: style.layers.findIndex( l => l.id === 'building' ), type: 'fill', positions: new Float32Array( 0 ), indices: new Uint16Array( 0 ) } );
		expect( map.levels ).toEqual( [ - 1, 0 ] );
		expect( a.batch.visible && b.batch.visible ).toBe( true );
		map.setLevel( 0 );
		expect( a.batch.visible ).toBe( true );
		expect( b.batch.visible ).toBe( false );
		expect( c.batch.visible ).toBe( true ); // no level: always shown
		map.setLevel( null );
		expect( b.batch.visible ).toBe( true );
		map.explode( 12 );
		expect( a.batch.position.y ).toBeCloseTo( 0, 9 );
		expect( b.batch.position.y ).toBeCloseTo( - 12, 9 );
		map.explode( 0 );
		expect( b.batch.position.y ).toBeCloseTo( 0, 9 );
		map.dispose();

	} );

} );
