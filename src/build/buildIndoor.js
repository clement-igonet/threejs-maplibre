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

import { appendExtrusion } from './buildPolygons.js';

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
		for ( const [ s0, s1 ] of pieces( ax, ay, bx, by, openings ) ) {

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

// The parts of the edge a-b left once the openings on it are cut out, as
// [ s0, s1 ] fractions along it.
function pieces( ax, ay, bx, by, openings ) {

	if ( ! openings || openings.length === 0 ) return [ [ 0, 1 ] ];
	const dx = bx - ax, dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const len = Math.sqrt( len2 );
	const cuts = [];
	for ( const [ ox, oy, half ] of openings ) {

		const t = ( ( ox - ax ) * dx + ( oy - ay ) * dy ) / len2;
		if ( t < - 1e-6 || t > 1 + 1e-6 ) continue;
		const px = ax + dx * t - ox, py = ay + dy * t - oy;
		if ( px * px + py * py > half * half * 0.25 ) continue; // not on this edge
		cuts.push( [ Math.max( 0, t - half / len ), Math.min( 1, t + half / len ) ] );

	}

	if ( cuts.length === 0 ) return [ [ 0, 1 ] ];
	cuts.sort( ( p, q ) => p[ 0 ] - q[ 0 ] );
	const out = [];
	let s = 0;
	for ( const [ c0, c1 ] of cuts ) {

		if ( c0 > s + 1e-9 ) out.push( [ s, c0 ] );
		s = Math.max( s, c1 );

	}

	if ( s < 1 - 1e-9 ) out.push( [ s, 1 ] );
	return out;

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
