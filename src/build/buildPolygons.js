import { Earcut } from 'three/src/extras/Earcut.js';
import { clipRing } from './clip.js';

// Fill and fill-extrusion geometry for one feature. Rings arrive in MVT
// winding (exterior clockwise in tile space, so positive shoelace area with
// y down; holes counter clockwise), are clipped to the tile square and
// grouped into polygons: an exterior ring followed by its holes. Earcut
// triangulates in tile space; the vertices are then projected to local space.

const _v = [ 0, 0, 0 ];
const _u = [ 0, 0, 0 ];

function signedArea( ring ) {

	let area = 0;
	const count = ring.length / 2;
	for ( let i = 0, j = count - 1; i < count; j = i ++ ) {

		area += ring[ 2 * j ] * ring[ 2 * i + 1 ] - ring[ 2 * i ] * ring[ 2 * j + 1 ];

	}

	return area / 2;

}

// Polygons of feature f, clipped to 0..extent: [ [ exterior, hole, ... ], ... ]
// with flat open rings (no repeated closing vertex).
export function featurePolygons( layer, f, extent ) {

	const polygons = [];
	let polygon = null;

	for ( let r = layer.featureStart[ f ]; r < layer.featureStart[ f + 1 ]; r ++ ) {

		const start = layer.ringStart[ r ];
		const end = layer.ringStart[ r + 1 ];
		if ( end - start < 3 ) continue;

		const raw = Array.from( layer.positions.subarray( 2 * start, 2 * end ) );
		const rawArea = signedArea( raw );
		if ( rawArea === 0 ) continue;

		const ring = clipRing( raw, 0, extent );
		if ( ring === null ) {

			// a clipped-away exterior takes its holes with it
			if ( rawArea > 0 ) polygon = null;
			continue;

		}

		ring.length -= 2; // open the ring for Earcut

		if ( rawArea > 0 ) {

			polygon = [ ring ];
			polygons.push( polygon );

		} else if ( polygon ) {

			polygon.push( ring );

		}

	}

	return polygons;

}

// Flat vertex list and hole offsets in the shape Earcut takes.
function flatten( polygon ) {

	const vertices = [];
	const holes = [];
	for ( let r = 0; r < polygon.length; r ++ ) {

		if ( r > 0 ) holes.push( vertices.length / 2 );
		for ( let i = 0; i < polygon[ r ].length; i ++ ) vertices.push( polygon[ r ][ i ] );

	}

	return { vertices, holes };

}

// Appends the polygon as a flat surface at the given height. out is
// { positions, colors, indices, vertexCount } with plain arrays.
export function appendFill( out, polygon, projection, rgba, height = 0 ) {

	const { vertices, holes } = flatten( polygon );
	const indices = Earcut.triangulate( vertices, holes, 2 );
	if ( indices.length === 0 ) return 0;

	const base = out.vertexCount;
	for ( let i = 0; i < vertices.length; i += 2 ) {

		projection.project( vertices[ i ], vertices[ i + 1 ], height, _v );
		out.positions.push( _v[ 0 ], _v[ 1 ], _v[ 2 ] );
		out.colors.push( rgba[ 0 ], rgba[ 1 ], rgba[ 2 ], rgba[ 3 ] );

	}

	out.vertexCount += vertices.length / 2;
	// Earcut keeps the ring's clockwise winding; reversed, the surface faces up
	for ( let i = 0; i < indices.length; i += 3 ) {

		out.indices.push( base + indices[ i + 2 ], base + indices[ i + 1 ], base + indices[ i ] );

	}

	return indices.length / 3;

}

// Appends a roof at "height" and one wall quad per ring edge between "base"
// and "height", with outward normals. out also carries a normals array.
export function appendExtrusion( out, polygon, projection, rgba, base, height ) {

	if ( height <= base ) return 0;

	let triangles = 0;

	// roof: flat, lit from above
	const roofStart = out.vertexCount;
	triangles += appendFill( out, polygon, projection, rgba, height );
	projection.up( polygon[ 0 ][ 0 ], polygon[ 0 ][ 1 ], _u );
	for ( let v = roofStart; v < out.vertexCount; v ++ ) out.normals.push( _u[ 0 ], _u[ 1 ], _u[ 2 ] );

	// walls
	for ( const ring of polygon ) {

		const count = ring.length / 2;
		for ( let i = 0; i < count; i ++ ) {

			const j = ( i + 1 ) % count;
			const ax = ring[ 2 * i ], ay = ring[ 2 * i + 1 ];
			const bx = ring[ 2 * j ], by = ring[ 2 * j + 1 ];
			if ( ax === bx && ay === by ) continue;

			const start = out.vertexCount;
			projection.project( ax, ay, base, _v );
			const a0 = [ _v[ 0 ], _v[ 1 ], _v[ 2 ] ];
			projection.project( ax, ay, height, _v );
			const a1 = [ _v[ 0 ], _v[ 1 ], _v[ 2 ] ];
			projection.project( bx, by, base, _v );
			const b0 = [ _v[ 0 ], _v[ 1 ], _v[ 2 ] ];
			projection.project( bx, by, height, _v );
			const b1 = [ _v[ 0 ], _v[ 1 ], _v[ 2 ] ];

			// outward normal: up x edge, for clockwise-from-above exteriors
			projection.up( ax, ay, _u );
			const ex = b0[ 0 ] - a0[ 0 ], ey = b0[ 1 ] - a0[ 1 ], ez = b0[ 2 ] - a0[ 2 ];
			let nx = _u[ 1 ] * ez - _u[ 2 ] * ey;
			let ny = _u[ 2 ] * ex - _u[ 0 ] * ez;
			let nz = _u[ 0 ] * ey - _u[ 1 ] * ex;
			const len = Math.hypot( nx, ny, nz ) || 1;
			nx /= len; ny /= len; nz /= len;

			for ( const p of [ a0, b0, b1, a1 ] ) {

				out.positions.push( p[ 0 ], p[ 1 ], p[ 2 ] );
				out.normals.push( nx, ny, nz );
				out.colors.push( rgba[ 0 ], rgba[ 1 ], rgba[ 2 ], rgba[ 3 ] );

			}

			out.vertexCount += 4;
			out.indices.push( start, start + 2, start + 1, start, start + 3, start + 2 );
			triangles += 2;

		}

	}

	return triangles;

}
