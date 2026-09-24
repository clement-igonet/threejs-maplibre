import { clipPolyline } from './clip.js';

// Line geometry for one feature: a triangle strip of vertex pairs along the
// polyline, extruded in the vertex shader by a screen-space half width. Each
// vertex carries the direction to extrude along ("extrude", in local space,
// tangent to the ground) and which side it sits on, so one geometry serves
// every zoom: the width comes from a uniform or a baked per-vertex value.
//
// Joins: miter up to line-miter-limit, then bevel (round joins fall back to
// bevel). Caps: butt (round and square fall back to butt). A run cut by the
// tile edge is extruded along that edge so the neighbour tile's half meets it
// without a notch.

const _a = [ 0, 0, 0 ];
const _b = [ 0, 0, 0 ];

// Runs of feature f inside the tile: [ { points, startEdge, endEdge } ]
export function featureLines( layer, f, extent ) {

	const runs = [];
	for ( let r = layer.featureStart[ f ]; r < layer.featureStart[ f + 1 ]; r ++ ) {

		const start = layer.ringStart[ r ];
		const end = layer.ringStart[ r + 1 ];
		if ( end - start < 2 ) continue;
		const points = Array.from( layer.positions.subarray( 2 * start, 2 * end ) );
		for ( const run of clipPolyline( points, 0, extent ) ) runs.push( run );

	}

	return runs;

}

function normalize( v ) {

	const len = Math.hypot( v[ 0 ], v[ 1 ], v[ 2 ] );
	if ( len > 0 ) {

		v[ 0 ] /= len; v[ 1 ] /= len; v[ 2 ] /= len;

	}

	return v;

}

function cross( a, b ) {

	return [
		a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ],
		a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ],
		a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ],
	];

}

function dot( a, b ) {

	return a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ];

}

// Extrude vector along a tile edge at a clipped endpoint: the vector along
// the edge whose projection on the line normal is one half width.
function edgeExtrude( projection, px, py, edge, normal, miterLimit ) {

	const d = edge === 'x' ? [ 1, 0 ] : [ 0, 1 ];
	projection.project( px, py, 0, _a );
	projection.project( px + d[ 0 ], py + d[ 1 ], 0, _b );
	const along = normalize( [ _b[ 0 ] - _a[ 0 ], _b[ 1 ] - _a[ 1 ], _b[ 2 ] - _a[ 2 ] ] );
	let cos = dot( along, normal );
	if ( cos < 0 ) {

		along[ 0 ] = - along[ 0 ]; along[ 1 ] = - along[ 1 ]; along[ 2 ] = - along[ 2 ];
		cos = - cos;

	}

	// nearly parallel to the edge: a butt end is the best we can do
	if ( cos < 1 / miterLimit ) return normal;
	return [ along[ 0 ] / cos, along[ 1 ] / cos, along[ 2 ] / cos ];

}

// Appends one clipped run. out is { positions, extrudes, sides, props,
// colors, indices, vertexCount } with plain arrays; props is the baked
// [ width, gap, offset ] triple; gapSigns is [ 0 ] for a plain line or
// [ - 1, 1 ] for the two strips of a gapped line.
export function appendLine( out, run, projection, rgba, props, { join = 'miter', miterLimit = 2, gapSigns = [ 0 ] } = {} ) {

	const { points, startEdge, endEdge } = run;

	// project, dropping repeated points
	const P = [];
	const U = [];
	const T = [];
	for ( let i = 0; i < points.length; i += 2 ) {

		const px = points[ i ], py = points[ i + 1 ];
		if ( T.length && T[ T.length - 1 ][ 0 ] === px && T[ T.length - 1 ][ 1 ] === py ) continue;
		T.push( [ px, py ] );
		P.push( projection.project( px, py, 0, [ 0, 0, 0 ] ) );
		U.push( projection.up( px, py, [ 0, 0, 0 ] ) );

	}

	const count = P.length;
	if ( count < 2 ) return 0;

	// per-vertex extrude vectors, one or two per point
	const vertices = []; // [ pointIndex, extrude ]
	for ( let i = 0; i < count; i ++ ) {

		let dirIn = null, dirOut = null;
		if ( i > 0 ) dirIn = normalize( [ P[ i ][ 0 ] - P[ i - 1 ][ 0 ], P[ i ][ 1 ] - P[ i - 1 ][ 1 ], P[ i ][ 2 ] - P[ i - 1 ][ 2 ] ] );
		if ( i < count - 1 ) dirOut = normalize( [ P[ i + 1 ][ 0 ] - P[ i ][ 0 ], P[ i + 1 ][ 1 ] - P[ i ][ 1 ], P[ i + 1 ][ 2 ] - P[ i ][ 2 ] ] );
		const nIn = dirIn ? normalize( cross( U[ i ], dirIn ) ) : null;
		const nOut = dirOut ? normalize( cross( U[ i ], dirOut ) ) : null;

		if ( i === 0 ) {

			const extrude = startEdge ? edgeExtrude( projection, T[ i ][ 0 ], T[ i ][ 1 ], startEdge, nOut, miterLimit ) : nOut;
			vertices.push( [ i, extrude ] );
			continue;

		}

		if ( i === count - 1 ) {

			const extrude = endEdge ? edgeExtrude( projection, T[ i ][ 0 ], T[ i ][ 1 ], endEdge, nIn, miterLimit ) : nIn;
			vertices.push( [ i, extrude ] );
			continue;

		}

		const miter = normalize( [ nIn[ 0 ] + nOut[ 0 ], nIn[ 1 ] + nOut[ 1 ], nIn[ 2 ] + nOut[ 2 ] ] );
		const cos = dot( miter, nIn );
		const miterLength = cos > 1e-6 ? 1 / cos : Infinity;

		if ( join === 'miter' && miterLength <= miterLimit ) {

			vertices.push( [ i, [ miter[ 0 ] * miterLength, miter[ 1 ] * miterLength, miter[ 2 ] * miterLength ] ] );

		} else {

			// bevel: end the incoming segment, start the outgoing one
			vertices.push( [ i, nIn ], [ i, nOut ] );

		}

	}

	let triangles = 0;
	for ( const gap of gapSigns ) {

		const base = out.vertexCount;
		for ( const [ i, extrude ] of vertices ) {

			for ( const side of [ 1, - 1 ] ) {

				out.positions.push( P[ i ][ 0 ], P[ i ][ 1 ], P[ i ][ 2 ] );
				out.extrudes.push( extrude[ 0 ], extrude[ 1 ], extrude[ 2 ] );
				out.sides.push( side, gap );
				out.props.push( props[ 0 ], props[ 1 ], props[ 2 ] );
				out.colors.push( rgba[ 0 ], rgba[ 1 ], rgba[ 2 ], rgba[ 3 ] );

			}

		}

		out.vertexCount += 2 * vertices.length;
		for ( let k = 0; k < vertices.length - 1; k ++ ) {

			const v = base + 2 * k;
			out.indices.push( v, v + 1, v + 2, v + 1, v + 3, v + 2 );
			triangles += 2;

		}

	}

	return triangles;

}
