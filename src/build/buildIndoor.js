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
// the run is a ring, from base to top, both faces drawn.
export function appendWallRun( out, points, projection, rgba, base, top, closed = false ) {

	const count = points.length / 2;
	if ( count < 2 || top <= base ) return 0;
	let triangles = 0;
	const edges = closed ? count : count - 1;
	for ( let i = 0; i < edges; i ++ ) {

		const j = ( i + 1 ) % count;
		const ax = points[ 2 * i ], ay = points[ 2 * i + 1 ];
		const bx = points[ 2 * j ], by = points[ 2 * j + 1 ];
		if ( ax === bx && ay === by ) continue;
		const start = out.vertexCount;
		push( out, projection, ax, ay, base, rgba );
		push( out, projection, bx, by, base, rgba );
		push( out, projection, bx, by, top, rgba );
		push( out, projection, ax, ay, top, rgba );
		// one quad each way: the far side is the other side of the wall
		out.indices.push( start, start + 2, start + 1, start, start + 3, start + 2 );
		out.indices.push( start, start + 1, start + 2, start, start + 2, start + 3 );
		triangles += 4;

	}

	return triangles;

}

function push( out, projection, x, y, height, rgba ) {

	projection.project( x, y, height, _v );
	out.positions.push( _v[ 0 ], _v[ 1 ], _v[ 2 ] );
	out.colors.push( rgba[ 0 ], rgba[ 1 ], rgba[ 2 ], rgba[ 3 ] );
	out.vertexCount ++;

}
