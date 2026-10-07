import { Earcut } from 'three/src/extras/Earcut.js';
import { clipRing } from './clip.js';

// Fill and fill-extrusion geometry for one feature. Rings arrive in MVT
// winding (exterior clockwise in tile space, so positive shoelace area with
// y down; holes counter clockwise), are clipped to the tile square and
// grouped into polygons: an exterior ring followed by its holes. Earcut
// triangulates in tile space; the vertices are then projected to local space.

const _v = [ 0, 0, 0 ];

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
// and "height", wound so the outward face is the front one. No normals are
// stored: the faces are flat, so the material shades them from the
// derivatives of the view position (flatShading).
// covered( ax, ay, bx, by ), when given, says what of the wall a-b another
// building already stands against, as [ [ base, height ], ... ]: two parts
// of one building, side by side, share a wall, and drawing both makes a
// partition through the inside of the building. Only the spans no
// neighbour covers are drawn: above a lower neighbour, below a raised one.
export function appendExtrusion( out, polygon, projection, rgba, base, height, roofRGBA = rgba, openings = null, covered = null ) {

	if ( height <= base ) return 0;

	let triangles = 0;

	// roof: flat, lit from above
	triangles += appendFill( out, polygon, projection, roofRGBA, height );

	// walls, each edge in one quad, or in pieces around its entrances: the
	// door's height cut out, the wall above it kept
	for ( const ring of polygon ) {

		const count = ring.length / 2;
		for ( let i = 0; i < count; i ++ ) {

			const j = ( i + 1 ) % count;
			const ax = ring[ 2 * i ], ay = ring[ 2 * i + 1 ];
			const bx = ring[ 2 * j ], by = ring[ 2 * j + 1 ];
			if ( ax === bx && ay === by ) continue;

			const spans = covered ? uncovered( base, height, covered( ax, ay, bx, by ) ) : [ [ base, height ] ];
			for ( const [ z0, z1 ] of spans ) {

				const cut = openings && z0 === base ? wallPieces( ax, ay, bx, by, openings ) : null;
				if ( cut === null ) {

					triangles += appendWallQuad( out, projection, rgba, ax, ay, bx, by, z0, z1 );
					continue;

				}

				const doorTop = Math.min( z1, z0 + cut.height );
				for ( const [ s0, s1 ] of cut.pieces ) triangles += appendWallQuad( out, projection, rgba, ax + ( bx - ax ) * s0, ay + ( by - ay ) * s0, ax + ( bx - ax ) * s1, ay + ( by - ay ) * s1, z0, doorTop );
				if ( doorTop < z1 ) triangles += appendWallQuad( out, projection, rgba, ax, ay, bx, by, doorTop, z1 );

			}

		}

	}

	return triangles;

}

// [ base, height ] less the spans in cover, as the spans left.
export function uncovered( base, height, cover ) {

	let spans = [ [ base, height ] ];
	if ( ! cover ) return spans;
	for ( const [ c0, c1 ] of cover ) {

		const next = [];
		for ( const [ z0, z1 ] of spans ) {

			if ( c1 <= z0 || c0 >= z1 ) { next.push( [ z0, z1 ] ); continue; }
			if ( c0 > z0 ) next.push( [ z0, c0 ] );
			if ( c1 < z1 ) next.push( [ c1, z1 ] );

		}

		spans = next;

	}

	return spans.filter( ( [ z0, z1 ] ) => z1 - z0 > 1e-3 );

}

function appendWallQuad( out, projection, rgba, ax, ay, bx, by, base, height ) {

	const start = out.vertexCount;
	projection.project( ax, ay, base, _v );
	const a0 = [ _v[ 0 ], _v[ 1 ], _v[ 2 ] ];
	projection.project( ax, ay, height, _v );
	const a1 = [ _v[ 0 ], _v[ 1 ], _v[ 2 ] ];
	projection.project( bx, by, base, _v );
	const b0 = [ _v[ 0 ], _v[ 1 ], _v[ 2 ] ];
	projection.project( bx, by, height, _v );
	const b1 = [ _v[ 0 ], _v[ 1 ], _v[ 2 ] ];

	for ( const p of [ a0, b0, b1, a1 ] ) {

		out.positions.push( p[ 0 ], p[ 1 ], p[ 2 ] );
		out.colors.push( rgba[ 0 ], rgba[ 1 ], rgba[ 2 ], rgba[ 3 ] );

	}

	out.vertexCount += 4;
	out.indices.push( start, start + 2, start + 1, start, start + 3, start + 2 );
	return 2;

}

// The parts of the edge a-b left once the openings on it are cut out, as
// [ s0, s1 ] fractions along it, with the openings' height; null when no
// opening lies on the edge. An opening is [ x, y, halfWidth, height ] in
// the ring's units, height in the projection's.
export function wallPieces( ax, ay, bx, by, openings ) {

	const dx = bx - ax, dy = by - ay;
	const len2 = dx * dx + dy * dy;
	const len = Math.sqrt( len2 );
	const cuts = [];
	let height = 0;
	for ( const [ ox, oy, half, h ] of openings ) {

		// a door within its half width past either end still cuts the edge:
		// a room's walls stand 5 cm inside its ring, and the mitre at a
		// corner moves the wall's end a little along the edge, past the
		// door the mapper put on the corner
		const t = ( ( ox - ax ) * dx + ( oy - ay ) * dy ) / len2;
		const slack = half / len;
		if ( t < - slack || t > 1 + slack ) continue;
		const tc = Math.min( Math.max( t, 0 ), 1 );
		const px = ax + dx * tc - ox, py = ay + dy * tc - oy;
		if ( px * px + py * py > half * half * 0.25 ) continue; // not on this edge
		cuts.push( [ Math.max( 0, t - half / len ), Math.min( 1, t + half / len ) ] );
		height = Math.max( height, h ?? Infinity );

	}

	if ( cuts.length === 0 ) return null;
	cuts.sort( ( p, q ) => p[ 0 ] - q[ 0 ] );
	const pieces = [];
	let s = 0;
	for ( const [ c0, c1 ] of cuts ) {

		if ( c0 > s + 1e-9 ) pieces.push( [ s, c0 ] );
		s = Math.max( s, c1 );

	}

	if ( s < 1 - 1e-9 ) pieces.push( [ s, 1 ] );
	return { pieces, height };

}
