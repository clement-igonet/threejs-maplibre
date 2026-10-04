import { Earcut } from 'three/src/extras/Earcut.js';
import { Color } from '@maplibre/maplibre-gl-style-spec';
import { straightSkeleton } from './straightSkeleton.js';

// Simple 3D Buildings roofs. A fill-extrusion is a footprint pulled up to a
// flat top, which is all MapLibre can draw and all OpenMapTiles carries;
// OSM says more (roof:shape, roof:height, roof:direction, colours,
// materials) and a three.js engine can draw it. This builds, per feature,
// walls up to the eave and a roof from the eave to the top, for the shapes
// OSM2World draws most and the rest as the nearest of them:
//
//   pyramidal, cone     every edge to one apex over the centroid
//   dome, onion         the same in rings, a quarter circle in profile
//   hipped, half_*,     the straight skeleton of the footprint (holes and
//   side_*, round_*     all), each face lifted by its distance from its
//                       wall, as OSM2World, F4Map and kendzi3d do it
//   mansard             the same faces cut at a third of the way in, steep
//                       below the cut and shallow above it
//   gabled, round,      the skeleton with every triangular face stood up
//   cross_*, apse_*,    vertical, its apex moved onto its wall: the ridge
//   saltbox             reaches the walls and the end faces are the gables
//   gambrel             gabled with the mansard's cut
//   skillion            one plane, down towards roof:direction
//   flat, anything else the flat top as before
//
// When the skeleton gives up on a footprint (it does not, on anything in
// the Louvre extract, but a ring can touch itself) the ridged shapes fall
// back to one ridge from the footprint's frame: along the longest wall,
// shortened by the half-width for a hip, out to the walls for a gable,
// which is OSM2World's own "quasi-rectangular" model.
//
// All in tile space, where rings arrive clockwise (positive area, y down);
// every face is wound like appendFill's, reversed from the ring, so it
// faces out. A building=roof, or wall=no, has no walls.

const _v = [ 0, 0, 0 ];
const DEG2RAD = Math.PI / 180;
const CARDINALS = { N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5 };
const RIDGED = new Set( [ 'gabled', 'round', 'hipped', 'mansard', 'gambrel', 'half_hipped', 'side_hipped', 'side_half_hipped', 'round_hipped', 'double_saltbox', 'cross_gabled', 'apse_gabled', 'saltbox' ] );
const GABLED = new Set( [ 'gabled', 'round', 'cross_gabled', 'apse_gabled', 'saltbox', 'double_saltbox' ] );
const POINTED = new Set( [ 'pyramidal', 'cone', 'round_pyramidal' ] );
const DOMED = new Set( [ 'dome', 'onion' ] );
const CUT = new Set( [ 'mansard', 'gambrel' ] ); // two slopes, the steep one below
const CUT_AT = 0.35, CUT_HEIGHT = 0.75; // the cut a third of the way in, three quarters of the way up
const WHOLE_BUILDING = { pyramid: 'pyramidal', pyramidal: 'pyramidal', cone: 'cone', conical: 'cone', dome: 'dome', sphere: 'dome' };

// What the tags say about the roof, or null when they say nothing this
// builder draws. height is the building's top (fill-extrusion-height).
// The rules are OSM2World's (LevelAndHeightData, RoofWithRidge): roof:height,
// else roof:angle over the half-width, else roof:levels at the level height
// (2.5 m there), else the footprint decides in appendRoofedExtrusion.
export function roofFromTags( tags, height, levelHeight = 2.5 ) {

	let shape = tags[ 'roof:shape' ];
	// a building that is all roof, tagged as such rather than as a roof over
	// no walls: building=pyramid (66 in OSM) and building:shape (2 000, most
	// of them cylinders, which are a footprint and not a roof); F4Map reads
	// building:shape as a roof shape too
	let whole = false;
	if ( ! shape ) {

		const alias = WHOLE_BUILDING[ tags[ 'building:shape' ] ] ?? WHOLE_BUILDING[ tags.building ];
		if ( alias ) { shape = alias; whole = true; }

	}

	if ( ! shape || shape === 'flat' ) return null;
	if ( ! ( RIDGED.has( shape ) || POINTED.has( shape ) || DOMED.has( shape ) || shape === 'skillion' ) ) return null;

	let roofHeight = parseMeters( tags[ 'roof:height' ] );
	if ( roofHeight === undefined && whole ) roofHeight = height;
	if ( roofHeight === undefined ) {

		const levels = parseFloat( tags[ 'roof:levels' ] );
		if ( Number.isFinite( levels ) && levels > 0 ) roofHeight = levels * levelHeight;

	}

	let angle = parseFloat( tags[ 'roof:angle' ] );
	if ( ! ( angle >= 0 && angle < 90 ) ) angle = null;

	// a direction, and how far it may be snapped to a wall (OSM2World's
	// Roof.snapDirection): a compass point is a rough word, an integer a
	// rough number, a decimal a measured one
	const raw = tags[ 'roof:direction' ];
	let direction = parseFloat( raw ), tolerance = 10;
	if ( Number.isFinite( direction ) ) {

		if ( String( raw ).includes( '.' ) ) tolerance = 0.5;

	} else {

		direction = CARDINALS[ String( raw ).toUpperCase() ];
		tolerance = 45;

	}

	if ( ! Number.isFinite( direction ) ) direction = null;

	return {
		shape,
		height: roofHeight === undefined ? null : Math.min( roofHeight, height ), // null: from the angle or the footprint
		angle,
		direction,
		tolerance,
		orientation: tags[ 'roof:orientation' ] === 'across' ? 'across' : 'along',
		walls: hasWalls( tags ),
	};

}

// A building=roof (a canopy, a courtyard's glass roof) or wall=no stands on
// nothing: its roof is drawn, its walls are not.
export function hasWalls( tags ) {

	return tags.building !== 'roof' && tags.wall !== 'no';

}

// Wall and roof colours from the tags, as the style's colour when untagged;
// glass makes both translucent.
export function roofColours( tags, rgba ) {

	const wall = parseColour( tags[ 'building:colour' ] ?? tags[ 'building:facade:colour' ], rgba );
	const roof = parseColour( tags[ 'roof:colour' ], wall );
	const glass = tags[ 'building:material' ] === 'glass' || tags[ 'roof:material' ] === 'glass';
	if ( glass ) {

		// a glass building is translucent all over; a glass roof on a stone
		// building keeps its walls
		const tint = [ 200, 230, 255, 110 ];
		return { wall: tags[ 'building:material' ] === 'glass' ? tint : wall, roof: tint, glass: true };

	}

	return { wall, roof, glass: false };

}

function parseColour( value, fallback ) {

	if ( value === undefined ) return fallback;
	const color = Color.parse( String( value ) );
	if ( ! color ) return fallback;
	const [ r, g, b, a ] = color.rgb;
	return [ Math.round( srgbToLinear( r ) * 255 ), Math.round( srgbToLinear( g ) * 255 ), Math.round( srgbToLinear( b ) * 255 ), Math.round( a * 255 ) ];

}

function srgbToLinear( c ) {

	return c < 0.04045 ? c * 0.0773993808 : Math.pow( c * 0.9478672986 + 0.0521327014, 2.4 );

}

function parseMeters( value ) {

	if ( value === undefined || value === null ) return undefined;
	const n = parseFloat( String( value ).replace( ',', '.' ) );
	return Number.isFinite( n ) ? n : undefined;

}

// Appends walls from base to the eave and the roof above, in the shape
// asked. out is { positions, colors, indices, vertexCount }. Returns the
// triangle count. The projection's scale (tile units per meter) is what
// turns the footprint's extent into a roof height when the tags give none.
export function appendRoofedExtrusion( out, polygon, projection, colours, base, height, roof, unitsPerMeter ) {

	const ring = polygon[ 0 ];
	const count = ring.length / 2;
	if ( count < 3 || height <= base ) return 0;

	// the footprint's frame: centroid, long axis u (or the one the tags
	// give), its normal n, half extents E along u and D along n
	const c = centroid( ring );
	let u = longestEdgeDirection( ring );
	if ( roof.direction !== null ) {

		// roof:direction faces the slope; for a ridge, the ridge is across it.
		// Snapped to the nearest wall when within tolerance, as OSM2World
		// does: a roof is square to its walls more often than a mapper's
		// compass reading is right
		const snapped = snapToWalls( ring, roof.direction, roof.tolerance ?? 10 );
		const dir = [ Math.sin( snapped * DEG2RAD ), - Math.cos( snapped * DEG2RAD ) ]; // north is -y in tile space
		u = roof.shape === 'skillion' ? dir : [ - dir[ 1 ], dir[ 0 ] ];

	} else if ( roof.shape === 'skillion' ) {

		u = [ - u[ 1 ], u[ 0 ] ]; // down the short way

	}

	if ( roof.orientation === 'across' && roof.direction === null && roof.shape !== 'skillion' ) u = [ - u[ 1 ], u[ 0 ] ];
	const n = [ - u[ 1 ], u[ 0 ] ];
	let E = 0, D = 0, smin = Infinity, smax = - Infinity;
	for ( let i = 0; i < count; i ++ ) {

		const px = ring[ 2 * i ] - c[ 0 ], py = ring[ 2 * i + 1 ] - c[ 1 ];
		const e = px * u[ 0 ] + py * u[ 1 ], d = px * n[ 0 ] + py * n[ 1 ];
		E = Math.max( E, Math.abs( e ) );
		D = Math.max( D, Math.abs( d ) );
		smin = Math.min( smin, e );
		smax = Math.max( smax, e );

	}

	// no roof:height: roof:angle over the distance to the ridge (the whole
	// length for a skillion), else OSM2World's defaults, a dome's radius or
	// 5 m, within the building
	let roofHeight = roof.height;
	if ( roofHeight === null ) {

		if ( roof.angle !== null ) {

			const run = ( roof.shape === 'skillion' ? smax - smin : D ) / unitsPerMeter;
			roofHeight = Math.tan( roof.angle * DEG2RAD ) * run;

		} else {

			roofHeight = DOMED.has( roof.shape ) ? Math.min( E, D ) / unitsPerMeter : 5;

		}

		roofHeight = Math.min( roofHeight, height - base );

	}

	const eave = Math.max( base, height - roofHeight );
	const top = height;
	let triangles = 0;

	if ( roof.shape === 'skillion' ) {

		const span = smax - smin;
		const zOf = ( x, y ) => {

			const s = ( x - c[ 0 ] ) * u[ 0 ] + ( y - c[ 1 ] ) * u[ 1 ];
			return span > 0 ? eave + ( top - eave ) * ( smax - s ) / span : top;

		};

		if ( roof.walls !== false ) triangles += appendWalls( out, polygon, projection, colours.wall, base, zOf );
		triangles += appendLiftedFill( out, polygon, projection, colours.roof, zOf );
		return triangles;

	}

	if ( roof.walls !== false ) triangles += appendWalls( out, polygon, projection, colours.wall, base, () => eave );
	const roofRGBA = colours.roof;

	if ( POINTED.has( roof.shape ) || ( RIDGED.has( roof.shape ) && E === 0 ) ) {

		triangles += appendRidge( out, ring, projection, roofRGBA, eave, top, c, u, 0 );

	} else if ( DOMED.has( roof.shape ) ) {

		triangles += appendDome( out, ring, projection, roofRGBA, eave, top, c );

	} else {

		// a tagged direction or orientation asks for one ridge where the
		// mapper put it, which the skeleton cannot take (F4Map falls back
		// to its bounding box then too); untagged, the skeleton decides
		const tagged = roof.direction !== null || roof.orientation === 'across';
		const skeleton = tagged ? 0 : appendSkeletonRoof( out, polygon, projection, roofRGBA, eave, top, roof.shape );
		if ( skeleton > 0 ) {

			triangles += skeleton;

		} else {

			const L = GABLED.has( roof.shape ) ? E : Math.max( 0, E - D );
			triangles += appendRidge( out, ring, projection, roofRGBA, eave, top, c, u, L );

		}

	}

	return triangles;

}

// The roof from the footprint's straight skeleton: one facet per wall
// (holes included), its vertices lifted from the eave by their distance
// from the wall, the farthest to the top. Gabled: a triangular face is an
// end of the ridge, so its apex is moved onto its own wall, which stands
// the face up vertical and carries the ridge out to the wall in the faces
// next to it. Mansard and gambrel: each facet is cut where the slope
// changes, so both parts stay planar. Returns 0 when the skeleton fails.
function appendSkeletonRoof( out, polygon, projection, rgba, eave, top, shape ) {

	const skeleton = straightSkeleton( polygon );
	if ( skeleton === null || skeleton.maxTime <= 0 ) return 0;
	const T = skeleton.maxTime;
	let faces = skeleton.faces.map( f => f.points );

	if ( GABLED.has( shape ) ) {

		// the ridge's ends, each the apex of a triangle, moved onto the wall
		const moved = new Map();
		for ( const points of faces ) {

			if ( points.length !== 3 ) continue;
			const [ a, b, r ] = points;
			const foot = closestOnSegment( r, a, b );
			moved.set( r[ 0 ] + ',' + r[ 1 ], foot );

		}

		if ( moved.size > 0 ) faces = faces.map( points => points.map( p => {

			const foot = moved.get( p[ 0 ] + ',' + p[ 1 ] );
			return foot ? [ foot[ 0 ], foot[ 1 ], p[ 2 ] ] : p;

		} ) );

	}

	const H = top - eave;
	const cut = CUT.has( shape );
	const lift = t => {

		const s = t / T;
		if ( ! cut ) return eave + H * s;
		return eave + H * ( s <= CUT_AT ? CUT_HEIGHT * s / CUT_AT : CUT_HEIGHT + ( 1 - CUT_HEIGHT ) * ( s - CUT_AT ) / ( 1 - CUT_AT ) );

	};

	let triangles = 0;
	for ( const points of faces ) {

		const pieces = cut ? splitAtTime( points, CUT_AT * T ) : [ points ];
		for ( const piece of pieces ) triangles += appendFacet( out, piece, projection, rgba, lift );

	}

	return triangles;

}

// A face polygon [ x, y, t ] lifted and triangulated. Flat faces, so Earcut
// in the plane is enough; wound like appendFill's, reversed from the ring.
function appendFacet( out, points, projection, rgba, lift ) {

	if ( points.length < 3 ) return 0;
	const flat = [];
	for ( const p of points ) flat.push( p[ 0 ], p[ 1 ] );
	const indices = Earcut.triangulate( flat, [], 2 );
	if ( indices.length === 0 ) return 0;
	const start = out.vertexCount;
	for ( const p of points ) pushVertex( out, projection, p[ 0 ], p[ 1 ], lift( p[ 2 ] ), rgba );
	for ( let i = 0; i < indices.length; i += 3 ) out.indices.push( start + indices[ i + 2 ], start + indices[ i + 1 ], start + indices[ i ] );
	return indices.length / 3;

}

// The face in two: the part below the time and the part above it, cut
// along the line where t equals the threshold (t is linear over a face).
function splitAtTime( points, t0 ) {

	const below = [], above = [];
	const n = points.length;
	for ( let i = 0; i < n; i ++ ) {

		const p = points[ i ], q = points[ ( i + 1 ) % n ];
		const pBelow = p[ 2 ] <= t0, qBelow = q[ 2 ] <= t0;
		( pBelow ? below : above ).push( p );
		if ( pBelow === qBelow || p[ 2 ] === q[ 2 ] ) continue;
		const k = ( t0 - p[ 2 ] ) / ( q[ 2 ] - p[ 2 ] );
		const m = [ p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * k, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * k, t0 ];
		below.push( m );
		above.push( m );

	}

	return [ below, above ].filter( piece => piece.length >= 3 );

}

function closestOnSegment( p, a, b ) {

	const dx = b[ 0 ] - a[ 0 ], dy = b[ 1 ] - a[ 1 ];
	const len = dx * dx + dy * dy;
	const k = len === 0 ? 0 : Math.max( 0, Math.min( 1, ( ( p[ 0 ] - a[ 0 ] ) * dx + ( p[ 1 ] - a[ 1 ] ) * dy ) / len ) );
	return [ a[ 0 ] + dx * k, a[ 1 ] + dy * k ];

}

// One face per edge of the ring up to the ridge, a segment of half-length L
// along u through the centroid at the top: a point for a pyramid, out to the
// walls for a gable (where the end faces come out vertical, the gables
// themselves), shortened for a hip.
function appendRidge( out, ring, projection, rgba, eave, top, c, u, L ) {

	const count = ring.length / 2;
	let triangles = 0;
	const ridgePoint = ( x, y ) => {

		const e = Math.max( - L, Math.min( L, ( x - c[ 0 ] ) * u[ 0 ] + ( y - c[ 1 ] ) * u[ 1 ] ) );
		return [ c[ 0 ] + u[ 0 ] * e, c[ 1 ] + u[ 1 ] * e ];

	};

	for ( let i = 0; i < count; i ++ ) {

		const j = ( i + 1 ) % count;
		const ax = ring[ 2 * i ], ay = ring[ 2 * i + 1 ];
		const bx = ring[ 2 * j ], by = ring[ 2 * j + 1 ];
		if ( ax === bx && ay === by ) continue;
		const ra = ridgePoint( ax, ay ), rb = ridgePoint( bx, by );
		const start = out.vertexCount;
		pushVertex( out, projection, ax, ay, eave, rgba );
		pushVertex( out, projection, bx, by, eave, rgba );
		pushVertex( out, projection, rb[ 0 ], rb[ 1 ], top, rgba );
		out.indices.push( start + 2, start + 1, start );
		triangles ++;
		if ( ra[ 0 ] !== rb[ 0 ] || ra[ 1 ] !== rb[ 1 ] ) {

			pushVertex( out, projection, ra[ 0 ], ra[ 1 ], top, rgba );
			out.indices.push( start + 3, start + 2, start );
			triangles ++;

		}

	}

	return triangles;

}

// Rings of the footprint shrunk towards the centroid and lifted on a
// quarter circle, the last one a point.
function appendDome( out, ring, projection, rgba, eave, top, c, steps = 6 ) {

	const count = ring.length / 2;
	let triangles = 0;
	const at = ( i, k ) => {

		const t = k / steps;
		const s = Math.cos( t * Math.PI / 2 );
		return [ c[ 0 ] + ( ring[ 2 * i ] - c[ 0 ] ) * s, c[ 1 ] + ( ring[ 2 * i + 1 ] - c[ 1 ] ) * s, eave + ( top - eave ) * Math.sin( t * Math.PI / 2 ) ];

	};

	for ( let k = 1; k <= steps; k ++ ) {

		for ( let i = 0; i < count; i ++ ) {

			const j = ( i + 1 ) % count;
			const a0 = at( i, k - 1 ), b0 = at( j, k - 1 ), a1 = at( i, k ), b1 = at( j, k );
			const start = out.vertexCount;
			pushVertex( out, projection, a0[ 0 ], a0[ 1 ], a0[ 2 ], rgba );
			pushVertex( out, projection, b0[ 0 ], b0[ 1 ], b0[ 2 ], rgba );
			pushVertex( out, projection, b1[ 0 ], b1[ 1 ], b1[ 2 ], rgba );
			out.indices.push( start + 2, start + 1, start );
			triangles ++;
			if ( k < steps ) {

				pushVertex( out, projection, a1[ 0 ], a1[ 1 ], a1[ 2 ], rgba );
				out.indices.push( start + 3, start + 2, start );
				triangles ++;

			}

		}

	}

	return triangles;

}

// Wall quads from base to a top that may differ per vertex.
function appendWalls( out, polygon, projection, rgba, base, topOf ) {

	let triangles = 0;
	for ( const ring of polygon ) {

		const count = ring.length / 2;
		for ( let i = 0; i < count; i ++ ) {

			const j = ( i + 1 ) % count;
			const ax = ring[ 2 * i ], ay = ring[ 2 * i + 1 ];
			const bx = ring[ 2 * j ], by = ring[ 2 * j + 1 ];
			if ( ax === bx && ay === by ) continue;
			const start = out.vertexCount;
			pushVertex( out, projection, ax, ay, base, rgba );
			pushVertex( out, projection, bx, by, base, rgba );
			pushVertex( out, projection, bx, by, topOf( bx, by ), rgba );
			pushVertex( out, projection, ax, ay, topOf( ax, ay ), rgba );
			out.indices.push( start, start + 2, start + 1, start, start + 3, start + 2 );
			triangles += 2;

		}

	}

	return triangles;

}

// The polygon triangulated flat, each vertex lifted to its own height.
function appendLiftedFill( out, polygon, projection, rgba, zOf ) {

	const vertices = [], holes = [];
	for ( let r = 0; r < polygon.length; r ++ ) {

		if ( r > 0 ) holes.push( vertices.length / 2 );
		for ( let i = 0; i < polygon[ r ].length; i ++ ) vertices.push( polygon[ r ][ i ] );

	}

	const indices = Earcut.triangulate( vertices, holes, 2 );
	if ( indices.length === 0 ) return 0;
	const start = out.vertexCount;
	for ( let i = 0; i < vertices.length; i += 2 ) pushVertex( out, projection, vertices[ i ], vertices[ i + 1 ], zOf( vertices[ i ], vertices[ i + 1 ] ), rgba );
	for ( let i = 0; i < indices.length; i += 3 ) out.indices.push( start + indices[ i + 2 ], start + indices[ i + 1 ], start + indices[ i ] );
	return indices.length / 3;

}

function pushVertex( out, projection, x, y, height, rgba ) {

	projection.project( x, y, height, _v );
	out.positions.push( _v[ 0 ], _v[ 1 ], _v[ 2 ] );
	out.colors.push( rgba[ 0 ], rgba[ 1 ], rgba[ 2 ], rgba[ 3 ] );
	out.vertexCount ++;

}

// The direction (degrees clockwise from north) moved to the nearest wall's
// direction, or its normal, when one is within tolerance.
function snapToWalls( ring, direction, tolerance ) {

	const count = ring.length / 2;
	let best = direction, bestOff = Infinity;
	for ( let i = 0; i < count; i ++ ) {

		const j = ( i + 1 ) % count;
		const dx = ring[ 2 * j ] - ring[ 2 * i ], dy = ring[ 2 * j + 1 ] - ring[ 2 * i + 1 ];
		if ( dx === 0 && dy === 0 ) continue;
		const wall = Math.atan2( dx, - dy ) / DEG2RAD; // clockwise from north, north being -y
		for ( let k = 0; k < 4; k ++ ) {

			const candidate = wall + 90 * k;
			const off = Math.abs( ( ( candidate - direction ) % 360 + 540 ) % 360 - 180 );
			if ( off < bestOff ) { bestOff = off; best = candidate; }

		}

	}

	return bestOff <= tolerance ? best : direction;

}

function centroid( ring ) {

	const count = ring.length / 2;
	let area = 0, cx = 0, cy = 0;
	for ( let i = 0, j = count - 1; i < count; j = i ++ ) {

		const cross = ring[ 2 * j ] * ring[ 2 * i + 1 ] - ring[ 2 * i ] * ring[ 2 * j + 1 ];
		area += cross;
		cx += ( ring[ 2 * j ] + ring[ 2 * i ] ) * cross;
		cy += ( ring[ 2 * j + 1 ] + ring[ 2 * i + 1 ] ) * cross;

	}

	if ( area === 0 ) return [ ring[ 0 ], ring[ 1 ] ];
	return [ cx / ( 3 * area ), cy / ( 3 * area ) ];

}

function longestEdgeDirection( ring ) {

	const count = ring.length / 2;
	let best = 0, ux = 1, uy = 0;
	for ( let i = 0; i < count; i ++ ) {

		const j = ( i + 1 ) % count;
		const dx = ring[ 2 * j ] - ring[ 2 * i ], dy = ring[ 2 * j + 1 ] - ring[ 2 * i + 1 ];
		const len = dx * dx + dy * dy;
		if ( len > best ) {

			best = len;
			ux = dx;
			uy = dy;

		}

	}

	const len = Math.sqrt( best ) || 1;
	return [ ux / len, uy / len ];

}
