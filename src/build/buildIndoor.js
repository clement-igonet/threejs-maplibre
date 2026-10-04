// Simple Indoor Tagging as geometry: a floor is the room's, corridor's or
// area's footprint as a thin slab at its level, a wall is a vertical run
// along an indoor=wall way or around a room, drawn on both sides so it
// reads from inside the room as well as from the corridor. A feature on
// several levels (level=0;1, repeat_on) is built once per level, each in
// the block of that level, so a map can show one level, or all of them
// pulled apart.
//
// Heights: a level is levelHeight tall (3 m unless the style says
// otherwise), level n starting n * levelHeight above the ground level 0,
// below it for negative levels, a slab 15 cm thick, walls half a meter
// short of the next floor so the eye gets over them from above. OSM2World
// sizes levels from indoor=level outlines' height=* when tagged; the Paris
// stations tag none, so that waits for data that does.

import { Earcut } from 'three/src/extras/Earcut.js';
import { appendExtrusion, wallPieces } from './buildPolygons.js';

const _v = [ 0, 0, 0 ];
export const FLOOR_THICKNESS = 0.15;

// The levels a feature is on, from the extract's levels list.
export function featureLevels( properties ) {

	const list = properties.levels;
	if ( list === undefined || list === null || list === '' ) return [];
	return String( list ).split( ';' ).map( Number ).filter( Number.isFinite );

}

export function appendFloor( out, polygon, projection, rgba, base ) {

	return appendExtrusion( out, polygon, projection, rgba, base, base + FLOOR_THICKNESS );

}

// A floor with holes cut in it: where a staircase or an escalator comes up
// through it. OSM maps the floor above a stairwell as one area, hole and
// all, so the hole is the engine's to make, or a ramp climbs into the
// slab. holes are convex quads, [ [ x, y ] x 4 ] in tile units. The floor
// is triangulated as usual, every triangle has the quads taken out of it
// (a triangle minus a convex quad is a few convex pieces, one per edge of
// the quad the triangle reaches past), and each piece is drawn as the
// slab's top and underside; the slab's thin edges are left out there.
export function appendFloorWithHoles( out, polygon, projection, rgba, base, holes ) {

	const vertices = [], ringStarts = [];
	for ( let r = 0; r < polygon.length; r ++ ) {

		if ( r > 0 ) ringStarts.push( vertices.length / 2 );
		for ( let i = 0; i < polygon[ r ].length; i ++ ) vertices.push( polygon[ r ][ i ] );

	}

	const indices = Earcut.triangulate( vertices, ringStarts, 2 );
	const top = base + FLOOR_THICKNESS;
	let triangles = 0;
	for ( let i = 0; i < indices.length; i += 3 ) {

		let pieces = [ [ 0, 1, 2 ].map( k => [ vertices[ 2 * indices[ i + k ] ], vertices[ 2 * indices[ i + k ] + 1 ] ] ) ];
		if ( Math.abs( polygonArea( pieces[ 0 ] ) ) <= 1e-9 ) continue;
		for ( const quad of holes ) pieces = pieces.flatMap( piece => subtractConvex( piece, quad ) );
		for ( const piece of pieces ) {

			// a fan, reversed for the top as appendFill does, so it faces up
			const start = out.vertexCount;
			for ( const [ x, y ] of piece ) push( out, projection, x, y, top, rgba );
			for ( const [ x, y ] of piece ) push( out, projection, x, y, base, rgba );
			const n = piece.length;
			for ( let k = 1; k < n - 1; k ++ ) {

				out.indices.push( start, start + k + 1, start + k );
				out.indices.push( start + n, start + n + k, start + n + k + 1 );
				triangles += 2;

			}

		}

	}

	return triangles;

}

// A flat surface with holes, at one height: the street over a staircase
// going down to the Métro, which OSM maps as an unbroken pavement.
export function appendFillWithHoles( out, polygon, projection, rgba, height, holes ) {

	const vertices = [], ringStarts = [];
	for ( let r = 0; r < polygon.length; r ++ ) {

		if ( r > 0 ) ringStarts.push( vertices.length / 2 );
		for ( let i = 0; i < polygon[ r ].length; i ++ ) vertices.push( polygon[ r ][ i ] );

	}

	const indices = Earcut.triangulate( vertices, ringStarts, 2 );
	let triangles = 0;
	for ( let i = 0; i < indices.length; i += 3 ) {

		let pieces = [ [ 0, 1, 2 ].map( k => [ vertices[ 2 * indices[ i + k ] ], vertices[ 2 * indices[ i + k ] + 1 ] ] ) ];
		if ( Math.abs( polygonArea( pieces[ 0 ] ) ) <= 1e-9 ) continue;
		for ( const quad of holes ) pieces = pieces.flatMap( piece => subtractConvex( piece, quad ) );
		for ( const piece of pieces ) {

			const start = out.vertexCount;
			for ( const [ x, y ] of piece ) push( out, projection, x, y, height, rgba );
			for ( let k = 1; k < piece.length - 1; k ++ ) {

				out.indices.push( start, start + k + 1, start + k );
				triangles ++;

			}

		}

	}

	return triangles;

}

// The parts of a convex polygon outside a convex quad, as convex polygons.
export function subtractConvex( polygon, quad ) {

	let minX = Infinity, minY = Infinity, maxX = - Infinity, maxY = - Infinity;
	for ( const [ x, y ] of quad ) { minX = Math.min( minX, x ); maxX = Math.max( maxX, x ); minY = Math.min( minY, y ); maxY = Math.max( maxY, y ); }
	let inBox = false;
	for ( const [ x, y ] of polygon ) if ( x >= minX && x <= maxX && y >= minY && y <= maxY ) inBox = true;
	if ( ! inBox ) {

		// no vertex in the quad's box: either clear of it, or crossing it
		let pMinX = Infinity, pMinY = Infinity, pMaxX = - Infinity, pMaxY = - Infinity;
		for ( const [ x, y ] of polygon ) { pMinX = Math.min( pMinX, x ); pMaxX = Math.max( pMaxX, x ); pMinY = Math.min( pMinY, y ); pMaxY = Math.max( pMaxY, y ); }
		if ( pMaxX < minX || pMinX > maxX || pMaxY < minY || pMinY > maxY ) return [ polygon ];

	}

	// the quad's winding decides which side of an edge is inside
	let area = 0;
	for ( let i = 0; i < quad.length; i ++ ) { const [ ax, ay ] = quad[ i ], [ bx, by ] = quad[ ( i + 1 ) % quad.length ]; area += ax * by - bx * ay; }
	const inside = area > 0 ? 1 : - 1;
	const pieces = [];
	let rest = polygon;
	for ( let i = 0; i < quad.length && rest.length >= 3; i ++ ) {

		const a = quad[ i ], b = quad[ ( i + 1 ) % quad.length ];
		const outside = clipHalfPlane( rest, a, b, - inside );
		if ( outside.length >= 3 ) pieces.push( outside );
		rest = clipHalfPlane( rest, a, b, inside );

	}

	// what is left in rest is inside the quad: the hole. A vertex on a
	// quad's edge comes out twice; a piece along an edge has no area
	return pieces.map( dedupe ).filter( piece => piece.length >= 3 && Math.abs( polygonArea( piece ) ) > 1e-6 );

}

function dedupe( piece ) {

	const out = [];
	for ( const p of piece ) {

		const q = out[ out.length - 1 ];
		if ( ! q || Math.abs( q[ 0 ] - p[ 0 ] ) > 1e-9 || Math.abs( q[ 1 ] - p[ 1 ] ) > 1e-9 ) out.push( p );

	}

	while ( out.length > 1 && Math.abs( out[ 0 ][ 0 ] - out[ out.length - 1 ][ 0 ] ) <= 1e-9 && Math.abs( out[ 0 ][ 1 ] - out[ out.length - 1 ][ 1 ] ) <= 1e-9 ) out.pop();
	return out;

}

function polygonArea( piece ) {

	let a = 0;
	for ( let i = 0; i < piece.length; i ++ ) { const [ ax, ay ] = piece[ i ], [ bx, by ] = piece[ ( i + 1 ) % piece.length ]; a += ax * by - bx * ay; }
	return a / 2;

}

// Sutherland and Hodgman against one half-plane: the points p with
// side * cross( b - a, p - a ) >= 0.
function clipHalfPlane( polygon, a, b, side ) {

	const out = [];
	const ex = b[ 0 ] - a[ 0 ], ey = b[ 1 ] - a[ 1 ];
	const s = p => side * ( ex * ( p[ 1 ] - a[ 1 ] ) - ey * ( p[ 0 ] - a[ 0 ] ) );
	for ( let i = 0; i < polygon.length; i ++ ) {

		const p = polygon[ i ], q = polygon[ ( i + 1 ) % polygon.length ];
		const sp = s( p ), sq = s( q );
		if ( sp >= 0 ) out.push( p );
		if ( ( sp >= 0 ) !== ( sq >= 0 ) ) {

			const t = sp / ( sp - sq );
			out.push( [ p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * t, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * t ] );

		}

	}

	return out;

}

// The holes a run of points makes: a quad per segment, the run's width
// across (tile units), for subtractConvex.
export function stairwell( points, width ) {

	const quads = [];
	for ( let i = 0; i + 3 < points.length; i += 2 ) {

		const ax = points[ i ], ay = points[ i + 1 ], bx = points[ i + 2 ], by = points[ i + 3 ];
		const len = Math.hypot( bx - ax, by - ay );
		if ( len === 0 ) continue;
		const nx = - ( by - ay ) / len * width / 2, ny = ( bx - ax ) / len * width / 2;
		quads.push( [ [ ax + nx, ay + ny ], [ bx + nx, by + ny ], [ bx - nx, by - ny ], [ ax - nx, ay - ny ] ] );

	}

	return quads;

}

// A wall along a run of points (flat [ x0, y0, x1, y1, ... ]), closed when
// the run is a ring, from base to top, both faces drawn. Openings are the
// doors on this level, [ x, y, halfWidth ] in the run's units: a wall edge
// is cut where a door lies on it, at a vertex (where the mapper usually
// puts it, so both edges meeting there lose half a door) or along it.
export function appendWallRun( out, points, projection, rgba, base, top, closed = false, openings = null ) {

	const count = points.length / 2;
	if ( count < 2 || top <= base ) return 0;
	let triangles = 0;
	const edges = closed ? count : count - 1;
	for ( let i = 0; i < edges; i ++ ) {

		const j = ( i + 1 ) % count;
		const ax = points[ 2 * i ], ay = points[ 2 * i + 1 ];
		const bx = points[ 2 * j ], by = points[ 2 * j + 1 ];
		if ( ax === bx && ay === by ) continue;
		const cut = openings ? wallPieces( ax, ay, bx, by, openings ) : null;
		for ( const [ s0, s1 ] of cut ? cut.pieces : [ [ 0, 1 ] ] ) {

			const start = out.vertexCount;
			const x0 = ax + ( bx - ax ) * s0, y0 = ay + ( by - ay ) * s0;
			const x1 = ax + ( bx - ax ) * s1, y1 = ay + ( by - ay ) * s1;
			push( out, projection, x0, y0, base, rgba );
			push( out, projection, x1, y1, base, rgba );
			push( out, projection, x1, y1, top, rgba );
			push( out, projection, x0, y0, top, rgba );
			// one quad each way: the far side is the other side of the wall
			out.indices.push( start, start + 2, start + 1, start, start + 3, start + 2 );
			out.indices.push( start, start + 1, start + 2, start, start + 2, start + 3 );
			triangles += 4;

		}

	}

	return triangles;

}

// A ramp along a run of points, a strip of the given width (run units)
// rising from z0 at the first point to z1 at the last, both faces drawn:
// a staircase or an escalator between two levels, drawn as the slope it
// climbs rather than its steps.
export function appendRamp( out, points, projection, rgba, width, z0, z1 ) {

	const count = points.length / 2;
	if ( count < 2 ) return 0;
	const lengths = [ 0 ];
	for ( let i = 1; i < count; i ++ ) lengths.push( lengths[ i - 1 ] + Math.hypot( points[ 2 * i ] - points[ 2 * i - 2 ], points[ 2 * i + 1 ] - points[ 2 * i - 1 ] ) );
	const total = lengths[ count - 1 ];
	if ( total === 0 ) return 0;
	const start = out.vertexCount;
	for ( let i = 0; i < count; i ++ ) {

		// the side direction: the mean of the normals of the two segments at
		// this vertex
		let nx = 0, ny = 0;
		if ( i > 0 ) { const dx = points[ 2 * i ] - points[ 2 * i - 2 ], dy = points[ 2 * i + 1 ] - points[ 2 * i - 1 ], l = Math.hypot( dx, dy ) || 1; nx += - dy / l; ny += dx / l; }
		if ( i < count - 1 ) { const dx = points[ 2 * i + 2 ] - points[ 2 * i ], dy = points[ 2 * i + 3 ] - points[ 2 * i + 1 ], l = Math.hypot( dx, dy ) || 1; nx += - dy / l; ny += dx / l; }
		const l = Math.hypot( nx, ny ) || 1;
		nx = nx / l * width / 2;
		ny = ny / l * width / 2;
		const z = z0 + ( z1 - z0 ) * lengths[ i ] / total;
		push( out, projection, points[ 2 * i ] - nx, points[ 2 * i + 1 ] - ny, z, rgba );
		push( out, projection, points[ 2 * i ] + nx, points[ 2 * i + 1 ] + ny, z, rgba );

	}

	let triangles = 0;
	for ( let i = 0; i < count - 1; i ++ ) {

		const a = start + 2 * i, b = a + 1, c = a + 2, d = a + 3;
		out.indices.push( a, c, b, b, c, d );
		out.indices.push( a, b, c, b, d, c );
		triangles += 4;

	}

	return triangles;

}

// A lift shaft: four walls of a square of the given side (run units)
// around a point, from the lowest level served to the top of the highest.
export function appendShaft( out, x, y, projection, rgba, side, z0, z1 ) {

	const h = side / 2;
	const ring = [ x - h, y - h, x + h, y - h, x + h, y + h, x - h, y + h ];
	return appendWallRun( out, ring, projection, rgba, z0, z1, true );

}

function push( out, projection, x, y, height, rgba ) {

	projection.project( x, y, height, _v );
	out.positions.push( _v[ 0 ], _v[ 1 ], _v[ 2 ] );
	out.colors.push( rgba[ 0 ], rgba[ 1 ], rgba[ 2 ], rgba[ 3 ] );
	out.vertexCount ++;

}
