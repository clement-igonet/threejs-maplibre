import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import { createGeoJSONVectorSource } from '../demo/geojson-vector-source.js';
import { STATION_STYLE } from '../demo/station-style.js';
import { buildTile } from '../src/build/buildTile.js';
import { appendFloorWithHoles, appendRamp, appendWallRun, featureLevels, stairwell, subtractConvex, STAIR_WIDTH, STAIRWELL_WIDTH } from '../src/build/buildIndoor.js';
import { decodeVectorTile } from '../src/core/decodeVectorTile.js';
import { Style } from '../src/style/Style.js';
import { VectorTileMap } from '../src/three/VectorTileMap.js';
import { latitudeToNormalized, longitudeToNormalized, normalizedToMeters } from '../src/math/WebMercator.js';

// Gare Saint-Lazare, the committed extract, cut into tiles as the demo does
const { layers } = JSON.parse( readFileSync( new URL( '../demo/data/saint-lazare.json', import.meta.url ) ) );
const { source, tile } = createGeoJSONVectorSource( layers, { maxZoom: 16 } );
const style = new Style( STATION_STYLE );
const LAT = 48.8762, LON = 2.3253;

function build( z ) {

	const x = Math.floor( longitudeToNormalized( LON ) * 2 ** z ), y = Math.floor( latitudeToNormalized( LAT ) * 2 ** z );
	return buildTile( decodeVectorTile( tile( z, x, y ) ), style, { sourceId: 'openmaptiles', x, y, z, mode: 'planar' } );

}

const toLocal = ( lat, lon ) => { const [ mx, my ] = normalizedToMeters( longitudeToNormalized( lon ), latitudeToNormalized( lat ) ); return [ mx, - my ]; };
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

	it( 'cuts a wall where a door is, at a vertex or along an edge', () => {

		const projection = { project( x, y, h, out ) { out[ 0 ] = x; out[ 1 ] = h; out[ 2 ] = y; return out; } };
		const white = [ 255, 255, 255, 255 ];
		const square = [ 0, 0, 10, 0, 10, 10, 0, 10 ];
		const whole = { positions: [], colors: [], indices: [], vertexCount: 0 };
		appendWallRun( whole, square, projection, white, 0, 2.5, true );
		// a door at the vertex (10, 0): both edges meeting there lose 0.6
		const atVertex = { positions: [], colors: [], indices: [], vertexCount: 0 };
		expect( appendWallRun( atVertex, square, projection, white, 0, 2.5, true, [ [ 10, 0, 0.6 ] ] ) ).toBe( 16 ); // still 4 pieces
		const xs = []; for ( let i = 0; i < atVertex.positions.length; i += 3 ) xs.push( atVertex.positions[ i ] );
		expect( Math.max( ...xs.filter( ( x, i ) => atVertex.positions[ 3 * i + 2 ] === 0 ) ) ).toBeCloseTo( 9.4, 9 ); // the south wall stops short of the corner
		// a door in the middle of the south wall: that edge becomes two pieces
		const mid = { positions: [], colors: [], indices: [], vertexCount: 0 };
		expect( appendWallRun( mid, square, projection, white, 0, 2.5, true, [ [ 5, 0, 0.6 ] ] ) ).toBe( 20 );
		// a door off the wall cuts nothing
		const off = { positions: [], colors: [], indices: [], vertexCount: 0 };
		expect( appendWallRun( off, square, projection, white, 0, 2.5, true, [ [ 5, 3, 0.6 ] ] ) ).toBe( 16 );

	} );

	it( 'ramps a staircase from one level to the next', () => {

		const projection = { project( x, y, h, out ) { out[ 0 ] = x; out[ 1 ] = h; out[ 2 ] = y; return out; } };
		const out = { positions: [], colors: [], indices: [], vertexCount: 0 };
		expect( appendRamp( out, [ 0, 0, 6, 0, 12, 0 ], projection, [ 255, 255, 255, 255 ], 1.5, 0, 3 ) ).toBe( 8 );
		const y = ys( out );
		expect( Math.min( ...y ) ).toBe( 0 );
		expect( Math.max( ...y ) ).toBe( 3 );
		expect( y[ 2 ] ).toBeCloseTo( 1.5, 9 ); // the middle cross-section halfway up

	} );

	it( 'builds the station\'s stairs into both levels they join, and its lifts as shafts', () => {

		const built = build( 16 );
		const steps = built.blocks.filter( b => b.id === 'indoor-steps' );
		expect( steps.length ).toBeGreaterThan( 3 );
		const ground = steps.find( b => b.level === 0 );
		expect( ground ).toBeDefined();
		const y = ys( ground );
		expect( Math.min( ...y ) ).toBeLessThan( 0 ); // a staircase down from the hall
		expect( Math.max( ...y ) ).toBeGreaterThan( 0 ); // and one up
		const lifts = built.blocks.filter( b => b.id === 'indoor-lift' );
		expect( lifts.length ).toBeGreaterThan( 0 );
		// every staircase has its balustrades, in a block of their own that a
		// character meets as a wall from any side
		const steps0 = steps.filter( b => b.level === 0 && b.indoor === 'steps' ), rails0 = steps.filter( b => b.level === 0 && b.indoor === 'rail' );
		expect( steps0.length ).toBe( 1 );
		expect( rails0.length ).toBe( 1 );
		expect( rails0[ 0 ].triangles ).toBe( 2 * steps0[ 0 ].triangles ); // two walls of as many quads as the ramp
		const ry = ys( rails0[ 0 ] );
		expect( Math.max( ...ry ) - Math.max( ...y ) ).toBeCloseTo( 1.1, 6 );
		// the hole above a staircase is 10 cm wider than the stairs and no
		// more, so nothing beside the rails is open to the floor below
		expect( STAIRWELL_WIDTH - STAIR_WIDTH ).toBeCloseTo( 0.1, 9 );

	} );

	it( 'cuts a stairwell out of a floor: the area left is the floor minus the hole', () => {

		const projection = { project( x, y, h, out ) { out[ 0 ] = x; out[ 1 ] = h; out[ 2 ] = y; return out; } };
		const out = { positions: [], colors: [], indices: [], vertexCount: 0 };
		const square = [ [ 0, 0, 20, 0, 20, 20, 0, 20 ] ]; // 400
		const holes = stairwell( [ 5, 10, 15, 10 ], 2 ); // a 10 x 2 strip across the middle: 20
		appendFloorWithHoles( out, square, projection, [ 255, 255, 255, 255 ], 3, holes );
		// the top faces' area
		let area = 0;
		for ( let i = 0; i < out.indices.length; i += 3 ) {

			const [ a, b, c ] = [ 0, 1, 2 ].map( k => out.indices[ i + k ] );
			if ( out.positions[ 3 * a + 1 ] !== 3.15 ) continue;
			const ax = out.positions[ 3 * a ], az = out.positions[ 3 * a + 2 ], bx = out.positions[ 3 * b ], bz = out.positions[ 3 * b + 2 ], cx = out.positions[ 3 * c ], cz = out.positions[ 3 * c + 2 ];
			area += Math.abs( ( bx - ax ) * ( cz - az ) - ( cx - ax ) * ( bz - az ) ) / 2;

		}

		expect( area ).toBeCloseTo( 380, 6 );
		// a convex piece entirely inside the hole disappears, one clear of it stays whole
		expect( subtractConvex( [ [ 6, 9.5 ], [ 7, 9.5 ], [ 7, 10.5 ] ], holes[ 0 ] ) ).toEqual( [] );
		expect( subtractConvex( [ [ 0, 0 ], [ 2, 0 ], [ 2, 2 ] ], holes[ 0 ] ) ).toEqual( [ [ [ 0, 0 ], [ 2, 0 ], [ 2, 2 ] ] ] );

	} );

	it( 'opens the station\'s floors over their stairs and escalators', () => {

		const built = build( 16 );
		const one = built.blocks.find( b => b.id === 'indoor-floor' && b.level === 1 );
		expect( one ).toBeDefined();
		// over the top of the escalators that come up from the hall, level 1
		// has a hole: no floor triangle covers the middle of the escalator
		const [ ax, az ] = toLocal( 48.876162, 2.32514 ), [ bx, bz ] = toLocal( 48.876143, 2.324984 );
		const mx = ( ax + bx ) / 2 - built.center.x, mz = ( az + bz ) / 2 - built.center.z;
		let covered = false;
		for ( let i = 0; i < one.indices.length; i += 3 ) {

			const p = [ 0, 1, 2 ].map( k => [ one.positions[ 3 * one.indices[ i + k ] ], one.positions[ 3 * one.indices[ i + k ] + 2 ] ] );
			const s = ( u, v, w ) => ( v[ 0 ] - u[ 0 ] ) * ( w[ 1 ] - u[ 1 ] ) - ( w[ 0 ] - u[ 0 ] ) * ( v[ 1 ] - u[ 1 ] );
			if ( Math.abs( s( p[ 0 ], p[ 1 ], p[ 2 ] ) ) < 1e-9 ) continue; // a sliver covers nothing
			const d1 = s( p[ 0 ], p[ 1 ], [ mx, mz ] ), d2 = s( p[ 1 ], p[ 2 ], [ mx, mz ] ), d3 = s( p[ 2 ], p[ 0 ], [ mx, mz ] );
			if ( ( d1 >= 0 && d2 >= 0 && d3 >= 0 ) || ( d1 <= 0 && d2 <= 0 && d3 <= 0 ) ) covered = true;

		}

		expect( covered ).toBe( false );

	} );

} );
