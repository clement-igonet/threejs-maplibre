import { describe, expect, it } from 'vitest';
import { clipPolyline, clipRing } from '../src/build/clip.js';
import { createTileProjection } from '../src/build/TileProjection.js';
import { appendExtrusion, appendFill } from '../src/build/buildPolygons.js';
import { appendLine } from '../src/build/buildLines.js';
import { buildTile, builtTileTransferables } from '../src/build/buildTile.js';
import { decodeVectorTile } from '../src/core/decodeVectorTile.js';
import { Style } from '../src/style/Style.js';
import { stubVectorTile } from '../demo/stub-vector-tiles.js';
import { STUB_STYLE } from '../demo/stub-style.js';
import { latitudeToNormalized, longitudeToNormalized } from '../src/math/WebMercator.js';

const EXTENT = 4096;
const Z = 14;
const X = Math.floor( longitudeToNormalized( 2.3522 ) * 2 ** Z );
const Y = Math.floor( latitudeToNormalized( 48.8566 ) * 2 ** Z );

// a square in MVT winding: clockwise in y-down tile space
const square = ( x0, y0, x1, y1 ) => [ x0, y0, x1, y0, x1, y1, x0, y1, x0, y0 ];

function newOut() {

	return { positions: [], colors: [], indices: [], normals: [], extrudes: [], sides: [], props: [], vertexCount: 0 };

}

describe( 'clip', () => {

	it( 'keeps a ring inside the square and closes it', () => {

		const ring = clipRing( square( 10, 10, 20, 20 ), 0, EXTENT );
		expect( ring.slice( 0, 2 ) ).toEqual( ring.slice( - 2 ) );
		expect( ring.length ).toBe( 10 );

	} );

	it( 'cuts a ring crossing the tile edge and drops one outside', () => {

		const ring = clipRing( square( - 100, 100, 100, 200 ), 0, EXTENT );
		for ( let i = 0; i < ring.length; i += 2 ) expect( ring[ i ] ).toBeGreaterThanOrEqual( 0 );
		expect( Math.min( ...ring.filter( ( _, i ) => i % 2 === 0 ) ) ).toBe( 0 );
		expect( clipRing( square( - 200, 100, - 100, 200 ), 0, EXTENT ) ).toBeNull();

	} );

	it( 'splits a polyline into runs that remember the cutting edge', () => {

		// enters from the left, leaves through the top
		const runs = clipPolyline( [ - 50, 100, 100, 100, 100, - 50 ], 0, EXTENT );
		expect( runs.length ).toBe( 1 );
		expect( runs[ 0 ].points ).toEqual( [ 0, 100, 100, 100, 100, 0 ] );
		expect( runs[ 0 ].startEdge ).toBe( 'y' );
		expect( runs[ 0 ].endEdge ).toBe( 'x' );

		// out, in, out again gives two runs
		const two = clipPolyline( [ - 50, 10, 50, 10, 50, - 50, 150, - 50, 150, 10, 250, 10 ], 0, EXTENT );
		expect( two.length ).toBe( 2 );
		expect( two[ 0 ].startEdge ).toBe( 'y' );
		expect( two[ 0 ].endEdge ).toBe( 'x' );
		expect( two[ 1 ].startEdge ).toBe( 'x' );
		expect( two[ 1 ].endEdge ).toBeNull();

		expect( clipPolyline( [ - 50, - 50, - 10, - 10 ], 0, EXTENT ) ).toEqual( [] );

	} );

} );

describe( 'TileProjection', () => {

	it( 'places the tile center at the origin in both modes', () => {

		for ( const mode of [ 'planar', 'globe' ] ) {

			const projection = createTileProjection( X, Y, Z, EXTENT, mode );
			const p = projection.project( EXTENT / 2, EXTENT / 2, 0, [ 0, 0, 0 ] );
			expect( Math.hypot( ...p ) ).toBeLessThan( 1e-3 );
			const up = projection.up( 0, 0, [ 0, 0, 0 ] );
			expect( Math.hypot( ...up ) ).toBeCloseTo( 1, 6 );

		}

	} );

	it( 'maps tile x east, tile y south and height up in planar mode', () => {

		const projection = createTileProjection( X, Y, Z, EXTENT, 'planar' );
		const east = projection.project( EXTENT, EXTENT / 2, 0, [ 0, 0, 0 ] );
		const south = projection.project( EXTENT / 2, EXTENT, 0, [ 0, 0, 0 ] );
		const high = projection.project( EXTENT / 2, EXTENT / 2, 10, [ 0, 0, 0 ] );
		expect( east[ 0 ] ).toBeGreaterThan( 0 );
		expect( south[ 2 ] ).toBeGreaterThan( 0 );
		expect( high[ 1 ] ).toBeCloseTo( 10, 6 );
		// a z14 tile is about 2.4 km wide in Mercator meters
		expect( east[ 0 ] ).toBeCloseTo( 40075016.686 / 2 ** Z / 2, 0 );

	} );

	it( 'lifts along the geodetic normal on the globe', () => {

		const projection = createTileProjection( X, Y, Z, EXTENT, 'globe' );
		const ground = projection.project( 100, 100, 0, [ 0, 0, 0 ] );
		const high = projection.project( 100, 100, 10, [ 0, 0, 0 ] );
		const up = projection.up( 100, 100, [ 0, 0, 0 ] );
		const d = [ high[ 0 ] - ground[ 0 ], high[ 1 ] - ground[ 1 ], high[ 2 ] - ground[ 2 ] ];
		expect( Math.hypot( ...d ) ).toBeCloseTo( 10, 3 );
		expect( d[ 0 ] * up[ 0 ] + d[ 1 ] * up[ 1 ] + d[ 2 ] * up[ 2 ] ).toBeCloseTo( 10, 3 );

	} );

} );

// normal of the triangle ( a, b, c ) from the positions array
function triangleNormal( positions, a, b, c ) {

	const p = i => positions.slice( 3 * i, 3 * i + 3 );
	const [ ax, ay, az ] = p( a ), [ bx, by, bz ] = p( b ), [ cx, cy, cz ] = p( c );
	const ux = bx - ax, uy = by - ay, uz = bz - az;
	const vx = cx - ax, vy = cy - ay, vz = cz - az;
	const n = [ uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx ];
	const len = Math.hypot( ...n );
	return n.map( c => c / len );

}

describe( 'buildPolygons', () => {

	const projection = createTileProjection( X, Y, Z, EXTENT, 'planar' );
	const ring = square( 1000, 1000, 2000, 2000 ).slice( 0, 8 ); // open ring
	const hole = [ 1400, 1400, 1400, 1600, 1600, 1600, 1600, 1400 ]; // counter clockwise

	it( 'triangulates a fill facing up, holes included', () => {

		const out = newOut();
		const triangles = appendFill( out, [ ring, hole ], projection, [ 10, 20, 30, 255 ] );
		expect( triangles ).toBe( 8 );
		expect( out.vertexCount ).toBe( 8 );
		expect( out.colors.slice( 0, 4 ) ).toEqual( [ 10, 20, 30, 255 ] );
		for ( let i = 0; i < out.indices.length; i += 3 ) {

			const n = triangleNormal( out.positions, out.indices[ i ], out.indices[ i + 1 ], out.indices[ i + 2 ] );
			expect( n[ 1 ] ).toBeCloseTo( 1, 6 );

		}

	} );

	it( 'extrudes walls with outward normals and a roof at the height', () => {

		const out = newOut();
		const triangles = appendExtrusion( out, [ ring ], projection, [ 255, 255, 255, 255 ], 0, 30 );
		expect( triangles ).toBe( 2 + 4 * 2 );
		expect( out.normals.length ).toBe( out.positions.length );

		// roof vertices at 30 m with an up normal
		for ( let v = 0; v < 4; v ++ ) {

			expect( out.positions[ 3 * v + 1 ] ).toBeCloseTo( 30, 6 );
			expect( out.normals[ 3 * v + 1 ] ).toBeCloseTo( 1, 6 );

		}

		// each wall's stored normal matches its triangle winding and points
		// away from the footprint center
		const center = projection.project( 1500, 1500, 0, [ 0, 0, 0 ] );
		for ( let wall = 0; wall < 4; wall ++ ) {

			const base = 4 + 4 * wall;
			const stored = out.normals.slice( 3 * base, 3 * base + 3 );
			const i = 6 + 6 * wall;
			const wound = triangleNormal( out.positions, out.indices[ i ], out.indices[ i + 1 ], out.indices[ i + 2 ] );
			for ( let k = 0; k < 3; k ++ ) expect( wound[ k ] ).toBeCloseTo( stored[ k ], 6 );
			const p = out.positions.slice( 3 * base, 3 * base + 3 );
			const outward = ( p[ 0 ] - center[ 0 ] ) * stored[ 0 ] + ( p[ 2 ] - center[ 2 ] ) * stored[ 2 ];
			expect( outward ).toBeGreaterThan( 0 );

		}

		expect( appendExtrusion( newOut(), [ ring ], projection, [ 0, 0, 0, 0 ], 10, 10 ) ).toBe( 0 );

	} );

} );

describe( 'buildLines', () => {

	const projection = createTileProjection( X, Y, Z, EXTENT, 'planar' );

	it( 'builds a strip of vertex pairs with unit normals as extrudes', () => {

		const out = newOut();
		const run = { points: [ 100, 100, 500, 100 ], startEdge: null, endEdge: null };
		const triangles = appendLine( out, run, projection, [ 1, 2, 3, 4 ], [ 2, 0, 0 ] );
		expect( triangles ).toBe( 2 );
		expect( out.vertexCount ).toBe( 4 );
		expect( out.sides ).toEqual( [ 1, 0, - 1, 0, 1, 0, - 1, 0 ] );
		expect( out.props.slice( 0, 3 ) ).toEqual( [ 2, 0, 0 ] );
		// the line runs east; its extrude is horizontal and perpendicular
		const e = out.extrudes.slice( 0, 3 );
		expect( Math.hypot( ...e ) ).toBeCloseTo( 1, 6 );
		expect( Math.abs( e[ 0 ] ) ).toBeLessThan( 1e-6 );
		expect( Math.abs( e[ 1 ] ) ).toBeLessThan( 1e-6 );

	} );

	it( 'miters a corner within the limit and bevels past it', () => {

		const corner = { points: [ 100, 100, 500, 100, 500, 500 ], startEdge: null, endEdge: null };
		const mitered = newOut();
		appendLine( mitered, corner, projection, [ 0, 0, 0, 0 ], [ 1, 0, 0 ], { join: 'miter', miterLimit: 2 } );
		expect( mitered.vertexCount ).toBe( 6 );
		expect( Math.hypot( ...mitered.extrudes.slice( 6, 9 ) ) ).toBeCloseTo( Math.SQRT2, 6 );

		const beveled = newOut();
		appendLine( beveled, corner, projection, [ 0, 0, 0, 0 ], [ 1, 0, 0 ], { join: 'bevel' } );
		expect( beveled.vertexCount ).toBe( 8 );

		const sharp = { points: [ 100, 100, 500, 100, 100, 120 ], startEdge: null, endEdge: null };
		const limited = newOut();
		appendLine( limited, sharp, projection, [ 0, 0, 0, 0 ], [ 1, 0, 0 ], { join: 'miter', miterLimit: 2 } );
		expect( limited.vertexCount ).toBe( 8 );

	} );

	it( 'ends a run cut by the tile edge along that edge', () => {

		const out = newOut();
		// a diagonal leaving through the top edge ( y = 0 ), which runs along x
		const run = { points: [ 100, 400, 500, 0 ], startEdge: null, endEdge: 'x' };
		appendLine( out, run, projection, [ 0, 0, 0, 0 ], [ 1, 0, 0 ] );
		const e = out.extrudes.slice( 6, 9 );
		expect( Math.abs( e[ 2 ] ) ).toBeLessThan( 1e-6 ); // along the edge: no south component
		expect( Math.hypot( ...e ) ).toBeCloseTo( Math.SQRT2, 6 ); // one half width across the line

	} );

	it( 'emits two strips for a gapped line', () => {

		const out = newOut();
		const run = { points: [ 100, 100, 500, 100 ], startEdge: null, endEdge: null };
		const triangles = appendLine( out, run, projection, [ 0, 0, 0, 0 ], [ 1, 1, 0 ], { gapSigns: [ - 1, 1 ] } );
		expect( triangles ).toBe( 4 );
		expect( out.sides.filter( ( _, i ) => i % 2 === 1 ) ).toEqual( [ - 1, - 1, - 1, - 1, 1, 1, 1, 1 ] );

	} );

} );

describe( 'buildTile', () => {

	const style = new Style( STUB_STYLE );
	const tile = decodeVectorTile( stubVectorTile( Z, X, Y ) );
	const sourceId = 'openmaptiles';

	it( 'builds one block per drawn layer with typed arrays', () => {

		const built = buildTile( tile, style, { sourceId, x: X, y: Y, z: Z, mode: 'globe' } );
		const byId = Object.fromEntries( built.blocks.map( b => [ b.id, b ] ) );

		expect( Object.keys( byId ).sort() ).toEqual( [ 'building-3d', 'park', 'road-major', 'road-residential', 'water' ] );
		expect( byId[ 'building-3d' ].type ).toBe( 'fill-extrusion' );
		expect( byId[ 'building-3d' ].normals.length ).toBe( byId[ 'building-3d' ].positions.length );
		expect( byId[ 'road-major' ].type ).toBe( 'line' );
		expect( byId[ 'road-major' ].extrudes.length ).toBe( byId[ 'road-major' ].positions.length );
		expect( byId[ 'road-major' ].sides.length / 2 ).toBe( byId[ 'road-major' ].vertices );
		expect( byId.park.colors.length / 4 ).toBe( byId.park.vertices );

		for ( const block of built.blocks ) {

			expect( block.positions ).toBeInstanceOf( Float32Array );
			expect( block.colors ).toBeInstanceOf( Uint8Array );
			expect( block.indices.length ).toBe( 3 * block.triangles );
			expect( block.features ).toBeGreaterThan( 0 );
			expect( block.index ).toBe( style.layers.findIndex( l => l.id === block.id ) );
			// positions are relative to the tile center
			expect( Math.abs( block.positions[ 0 ] ) ).toBeLessThan( 5000 );

		}

		expect( built.stats.features ).toBeGreaterThan( 50 );
		expect( built.stats.triangles ).toBeGreaterThan( 100 );
		expect( built.center ).not.toBeNull();
		expect( builtTileTransferables( built ).length ).toBeGreaterThan( 3 * built.blocks.length );

	} );

	it( 'bakes source-kind colors and leaves camera-kind ones white', () => {

		const built = buildTile( tile, style, { sourceId, x: X, y: Y, z: Z, mode: 'planar' } );
		const byId = Object.fromEntries( built.blocks.map( b => [ b.id, b ] ) );

		// constant colors are carried by the material: vertices stay white
		expect( Array.from( byId[ 'road-residential' ].colors.slice( 0, 4 ) ) ).toEqual( [ 255, 255, 255, 255 ] );
		expect( Array.from( byId[ 'building-3d' ].colors.slice( 0, 4 ) ) ).toEqual( [ 255, 255, 255, 255 ] );
		// a color matched on a feature property is baked, in linear RGB
		const c = byId[ 'road-major' ].colors;
		expect( c[ 0 ] !== 255 || c[ 1 ] !== 255 || c[ 2 ] !== 255 ).toBe( true );
		expect( c[ 3 ] ).toBe( 255 );
		// the park opacity is a constant too, so the fill is baked opaque
		expect( byId.park.colors[ 3 ] ).toBe( 255 );

	} );

	it( 'returns no blocks and a null center for an empty tile', () => {

		const empty = { layers: {} };
		const built = buildTile( empty, style, { sourceId, x: 0, y: 0, z: 0 } );
		expect( built.blocks ).toEqual( [] );
		expect( built.center ).toBeNull();

	} );

	it( 'builds a layer outside its zoom range, evaluated at the nearest zoom in range', () => {

		// the map decides per frame whether the block is drawn
		const z = 10;
		const coarse = buildTile( tile, style, { sourceId, x: X >> 4, y: Y >> 4, z, mode: 'planar' } );
		expect( coarse.blocks.find( b => b.id === 'building-3d' ) ).toBeDefined(); // minzoom 13
		// the residential road width is a zoom interpolation from 1 px at z12:
		// a uniform, so the baked value stays 1 whatever the tile zoom
		expect( coarse.blocks.find( b => b.id === 'road-residential' ).props[ 0 ] ).toBe( 1 );

	} );

	it( 'leaves out a fill drawn with a pattern instead of painting it black', () => {

		// Liberty's road_area_pattern: pedestrian areas over the park polygons here
		const patterned = new Style( {
			...STUB_STYLE,
			layers: [ ...STUB_STYLE.layers, { id: 'plaza', type: 'fill', source: sourceId, 'source-layer': 'park', paint: { 'fill-pattern': 'pedestrian_polygon' } } ],
		} );
		const built = buildTile( tile, patterned, { sourceId, x: X, y: Y, z: Z, mode: 'planar' } );
		expect( built.blocks.map( b => b.id ) ).not.toContain( 'plaza' );
		expect( built.blocks.map( b => b.id ) ).toContain( 'park' );

	} );

} );
