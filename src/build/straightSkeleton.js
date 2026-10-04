// Straight skeleton of a footprint, for roofs. Shrink the outline inwards at
// unit speed, every edge staying parallel to itself: the paths the corners
// trace are the skeleton, and the region each edge sweeps before it vanishes
// is one face. Lift every skeleton vertex by the time it was reached and the
// faces become the planes of a hipped roof; cut the lift at a height and
// the same faces give a mansard, scale it and they give any pitch. That is
// why OSM2World, F4Map and kendzi3d all draw roofs from this one shape.
//
// The algorithm is Felkel and Obdrzalek (1998), the way kendzi's Java port
// (and the C# and TypeScript ports after it) handle it: every ring is a
// circular list of active vertices (a LAV), each with the bisector it moves
// along; the events are edge events, where two neighbouring bisectors meet
// and the edge between them is gone, and split events, where a reflex
// vertex runs into an edge across the polygon and cuts its list in two. A
// priority queue hands them out by time. Events at the same time and point
// are taken together: an orthogonal footprint has many of them (a square
// collapses to one point from four sides at once) and taking them one by one
// leaves zero-length edges that throw the next step off. Each contour edge
// keeps a chain of face nodes, pushed on either end as vertices are created
// to its left or right, and closed when its last two vertices meet, so faces
// come out as closed polygons with no second pass.
//
// Three things are done differently from kendzi, each for a footprint it
// lost: a vertex's split candidates are queued for every edge and judged
// against the edge's current piece when they come up, instead of being
// filtered by the edge's original wedge, which the piece outgrows once an
// end of it is replaced; events due at the time being processed are taken
// in the same pass instead of dropped, since a vertex between parallel
// edges moves infinitely fast and is at its next event at once; and two
// neighbours left at one point are merged, as their bisectors never meet.
//
// Input rings are flat arrays [ x0, y0, x1, y1, ... ] without the closing
// vertex, rings[ 0 ] the exterior, the rest holes, in any winding and any
// frame (y up or y down: winding is decided by signed area, so the interior
// is always to the left of each edge as the shoelace formula sees it). The
// result is null when the input is not a polygon (fewer than 3 vertices, a
// ring touching itself or another) or when the sweep fails, which the
// caller answers with a simpler roof, else { faces, maxTime } with one face
// per contour edge in contour order: { ring, edge, points } where points[ 0 ]
// and points[ 1 ] are the edge's endpoints at time 0 and the rest the
// skeleton vertices of the face in order, each [ x, y, t ].
//
// No three.js, no DOM: this runs in the tile worker.

const EDGE = 0, SPLIT = 1;
const MULTI_EDGE = 3, MULTI_SPLIT = 4, PICK = 5;
const CHAIN_EDGE = 0, CHAIN_SPLIT = 1, CHAIN_SINGLE = 2;
const ANGLE_EPS = 1e-9; // for dot and cross products of unit vectors

export function straightSkeleton( rings, options = {} ) {

	try {

		return build( rings, options );

	} catch ( error ) {

		return null;

	}

}

function build( rings, options ) {

	const tolerance = options.tolerance ?? 1e-6;
	const polygon = prepare( rings, tolerance );
	if ( polygon === null ) return null;

	const pts = polygon.flat();
	const span = i => pts.reduce( ( m, p ) => Math.max( m, p[ i ] ), - Infinity ) - pts.reduce( ( m, p ) => Math.min( m, p[ i ] ), Infinity );
	const diagonal = Math.hypot( span( 0 ), span( 1 ) );
	if ( ! ( diagonal > 0 ) ) return null;
	const eps = ( options.epsilon ?? 1e-9 ) * diagonal;
	const maxIterations = Math.max( 1000, 10 * pts.length * pts.length );

	const S = { eps, queue: [], lavs: new Set(), edges: [], faces: [] };
	for ( let r = 0; r < polygon.length; r ++ ) initSlav( S, polygon[ r ], r );
	initEvents( S );

	// Each pass takes everything due at the next time, one cluster of events
	// at a time. What a cluster creates may be due at the same time again (a
	// corridor between parallel edges closes all at once, and the vertex it
	// leaves is already at its next event), so the queue is read again
	// before every cluster and the time drained before moving on.
	let iterations = 0;
	while ( S.queue.length > 0 ) {

		let pending = loadLevelEvents( S, null );
		if ( pending.length === 0 ) continue;
		const level = pending[ 0 ].t;
		for ( ;; ) {

			for ( const event of loadLevelEvents( S, level ) ) pending.push( event );
			pending = pending.filter( event => ! isObsolete( event ) );
			if ( pending.length === 0 ) break;
			if ( ++ iterations > maxIterations ) return null;
			const event = nextCluster( S, pending );
			if ( event.kind === MULTI_SPLIT ) multiSplitEvent( S, event );
			else if ( event.kind === PICK ) pickChain( event.chain, event.x, event.y, event.t );
			else multiEdgeEvent( S, event );
			mergeCoincident( S );
			processTwoNodeLavs( S );

		}

		for ( const lav of S.lavs ) if ( lav.size === 0 ) S.lavs.delete( lav );

	}

	return collectFaces( S, polygon );

}

// Pre-pass for OSM input: drop repeated and near-collinear vertices, wind
// the exterior positive and the holes negative, refuse what is not a simple
// polygon. Returns the rings as arrays of [ x, y ], each flagged when it
// had to be reversed so the faces can be handed back in the caller's order.
function prepare( rings, tolerance ) {

	if ( ! Array.isArray( rings ) || rings.length === 0 ) return null;
	const polygon = [];
	const seen = new Set();

	for ( let r = 0; r < rings.length; r ++ ) {

		const ring = cleanRing( rings[ r ], tolerance );
		if ( ring === null ) return null;
		const area = signedArea( ring );
		if ( Math.abs( area ) <= tolerance * tolerance ) return null;
		ring.reversed = ( r === 0 ) === ( area < 0 );
		if ( ring.reversed ) ring.reverse();

		// a vertex shared with itself or another ring: the outline touches,
		// which the sweep cannot tell from an intersection
		for ( const p of ring ) {

			const key = Math.round( p[ 0 ] / tolerance ) + ',' + Math.round( p[ 1 ] / tolerance );
			if ( seen.has( key ) ) return null;
			seen.add( key );

		}

		polygon.push( ring );

	}

	return polygon;

}

function cleanRing( flat, tolerance ) {

	if ( ! Array.isArray( flat ) ) return null;
	const pts = [];
	for ( let i = 0; i + 1 < flat.length; i += 2 ) {

		const x = flat[ i ], y = flat[ i + 1 ];
		if ( ! Number.isFinite( x ) || ! Number.isFinite( y ) ) return null;
		pts.push( [ x, y ] );

	}

	// removing one vertex can make its neighbours collinear, so go round
	// again until nothing moves
	let changed = true;
	while ( changed && pts.length >= 3 ) {

		changed = false;
		const n = pts.length;
		for ( let i = 0; i < n; i ++ ) {

			const a = pts[ ( i + n - 1 ) % n ], b = pts[ i ], c = pts[ ( i + 1 ) % n ];
			const abx = b[ 0 ] - a[ 0 ], aby = b[ 1 ] - a[ 1 ];
			const bcx = c[ 0 ] - b[ 0 ], bcy = c[ 1 ] - b[ 1 ];
			const acx = c[ 0 ] - a[ 0 ], acy = c[ 1 ] - a[ 1 ];
			const ab = Math.hypot( abx, aby ), bc = Math.hypot( bcx, bcy ), ac = Math.hypot( acx, acy );
			const cross = Math.abs( abx * bcy - aby * bcx );
			if ( ab <= tolerance || ac <= tolerance || cross <= 1e-9 * ab * bc || cross <= tolerance * ac ) {

				pts.splice( i, 1 );
				changed = true;
				break;

			}

		}

	}

	return pts.length < 3 ? null : pts;

}

function signedArea( pts ) {

	let area = 0;
	for ( let i = 0, j = pts.length - 1; i < pts.length; j = i ++ ) area += pts[ j ][ 0 ] * pts[ i ][ 1 ] - pts[ i ][ 0 ] * pts[ j ][ 1 ];
	return area / 2;

}

// Geometry. A ray is { ax, ay, ux, uy } with a unit direction; an edge
// carries its line as { a, b, c } normalised so a * x + b * y + c is the
// signed distance, positive on the left of the edge, which is the interior.

function makeRay( ax, ay, ux, uy ) {

	const length = Math.hypot( ux, uy );
	return { ax, ay, ux: ux / length, uy: uy / length };

}

// Where two rays meet, or null when they do not. Collinear rays facing each
// other meet halfway, which is what two wavefront vertices on one line do.
function rayRayHit( r1, r2, eps ) {

	const wx = r1.ax - r2.ax, wy = r1.ay - r2.ay;
	const d = r1.ux * r2.uy - r1.uy * r2.ux;
	if ( Math.abs( d ) < ANGLE_EPS ) {

		if ( Math.abs( r1.ux * wy - r1.uy * wx ) > eps ) return null;
		if ( r1.ux * wx + r1.uy * wy >= 0 || r2.ux * wx + r2.uy * wy <= 0 ) return null;
		return [ ( r1.ax + r2.ax ) / 2, ( r1.ay + r2.ay ) / 2 ];

	}

	const s = ( r2.ux * wy - r2.uy * wx ) / d;
	const t = ( r1.ux * wy - r1.uy * wx ) / d;
	if ( s < - eps || t < - eps ) return null;
	return [ r1.ax + s * r1.ux, r1.ay + s * r1.uy ];

}

// Which side of a ray a point is on: negative to the left, positive to the
// right, within eps on it.
function side( ray, x, y ) {

	return ray.uy * ( x - ray.ax ) - ray.ux * ( y - ray.ay );

}

// The inward bisector of two edge directions, the way kendzi builds it: the
// sum of the two inward normals, except near a hairpin where that sum
// vanishes and the difference of the directions is the same line.
function bisectorVector( n1x, n1y, n2x, n2y ) {

	if ( n1x * n2x + n1y * n2y > 0 ) return [ - n1y - n2y, n1x + n2x ];
	let x = n2x - n1x, y = n2y - n1y;
	if ( - n1y * n2x + n1x * n2y < 0 ) { x = - x; y = - y; }
	return [ x, y ];

}

function bisectorAt( x, y, e1, e2 ) {

	const v = bisectorVector( e1.nx, e1.ny, e2.nx, e2.ny );
	return makeRay( x, y, v[ 0 ], v[ 1 ] );

}

function distance2( ax, ay, bx, by ) {

	return ( ax - bx ) * ( ax - bx ) + ( ay - by ) * ( ay - by );

}

// Structures. A vertex sits on a LAV (a circular list, { first, size }) and
// carries the bisector it travels on, the contour edges on each side and
// the face nodes it was linked into on each side. A face is a path of
// nodes, grown at either end, that belongs to one contour edge (or to none
// while a split is being assembled, until it is merged into one that does).

function makeVertex( x, y, t, bis, prevEdge, nextEdge ) {

	return { x, y, t, bis, prevEdge, nextEdge, left: null, right: null, processed: false, prev: null, next: null, lav: null };

}

function lavInsertBefore( node, v ) {

	if ( v.lav !== null ) throw new Error( 'vertex already in a lav' );
	const lav = node.lav;
	v.lav = lav;
	v.prev = node.prev;
	v.next = node;
	node.prev.next = v;
	node.prev = v;
	lav.size ++;

}

function lavAppend( lav, v ) {

	if ( lav.first === null ) {

		if ( v.lav !== null ) throw new Error( 'vertex already in a lav' );
		lav.first = v;
		v.lav = lav;
		v.next = v;
		v.prev = v;
		lav.size = 1;

	} else {

		lavInsertBefore( lav.first, v );

	}

}

function lavRemove( v ) {

	if ( v === null || v.lav === null ) return;
	const lav = v.lav;
	v.lav = null;
	if ( lav.size === 1 ) {

		lav.first = null;

	} else {

		if ( lav.first === v ) lav.first = v.next;
		v.prev.next = v.next;
		v.next.prev = v.prev;

	}

	v.prev = null;
	v.next = null;
	lav.size --;

}

function lavVertices( lav ) {

	const out = [];
	let v = lav.first;
	for ( let i = 0; i < lav.size; i ++ ) {

		out.push( v );
		v = v.next;

	}

	return out;

}

function makeFaceQueue( edge ) {

	return { edge, closed: false, nodes: [], a: null };

}

function faceIsEnd( node ) {

	const nodes = node.q.nodes;
	return node === nodes[ 0 ] || node === nodes[ nodes.length - 1 ];

}

// A new node for v on the end of the face that `node` ends, after the last
// node or before the first one, whichever `node` is.
function facePush( node, v ) {

	const q = node.q, nodes = q.nodes;
	if ( q.closed ) throw new Error( 'face is closed' );
	const fresh = { v, q };
	if ( node === nodes[ nodes.length - 1 ] ) nodes.push( fresh );
	else if ( node === nodes[ 0 ] ) nodes.unshift( fresh );
	else throw new Error( 'not an end of the face' );
	return fresh;

}

// Two face ends that meet: the same face closes; an edge face and a loose
// one merge into the edge face, the loose one's nodes going onto the edge
// face's end from the meeting node inwards.
function faceConnect( first, second ) {

	const q1 = first.q, q2 = second.q;
	if ( ! faceIsEnd( first ) || ! faceIsEnd( second ) ) throw new Error( 'faces meet off their ends' );
	if ( q1 === q2 ) {

		if ( q1.edge === null ) throw new Error( 'closing a face with no edge' );
		q1.closed = true;
		return;

	}

	if ( q1.edge !== null && q2.edge !== null ) throw new Error( 'two edge faces meet' );
	const [ node, other ] = q1.edge !== null ? [ first, second ] : [ second, first ];
	const q = node.q, loose = other.q, seq = loose.nodes;
	if ( q.closed ) throw new Error( 'face is closed' );
	if ( other === seq[ seq.length - 1 ] ) seq.reverse();
	for ( const x of seq ) x.q = q;
	if ( node === q.nodes[ q.nodes.length - 1 ] ) q.nodes.push( ...seq );
	else q.nodes.unshift( ...seq.reverse() );
	loose.nodes = [];
	loose.closed = true;

}

function looseFaceNode( v ) {

	const q = makeFaceQueue( null );
	const node = { v, q };
	q.nodes.push( node );
	return node;

}

// A binary heap of events by time.

function heapPush( heap, item ) {

	let n = heap.length;
	heap.push( item );
	while ( n > 0 ) {

		const p = ( n - 1 ) >> 1;
		if ( heap[ n ].t >= heap[ p ].t ) break;
		const tmp = heap[ n ]; heap[ n ] = heap[ p ]; heap[ p ] = tmp;
		n = p;

	}

}

function heapPop( heap ) {

	const top = heap[ 0 ];
	const last = heap.pop();
	if ( heap.length === 0 ) return top;
	heap[ 0 ] = last;
	let p = 0;
	for ( ;; ) {

		let c = 2 * p + 1;
		if ( c >= heap.length ) break;
		if ( c + 1 < heap.length && heap[ c + 1 ].t < heap[ c ].t ) c ++;
		if ( heap[ p ].t <= heap[ c ].t ) break;
		const tmp = heap[ p ]; heap[ p ] = heap[ c ]; heap[ c ] = tmp;
		p = c;

	}

	return top;

}

// Set-up: one LAV per ring, one edge per side with its bisectors, one face
// per edge seeded with the edge's two endpoints.
function initSlav( S, pts, ring ) {

	const n = pts.length;
	const edges = [];
	for ( let i = 0; i < n; i ++ ) {

		const b = pts[ i ], e = pts[ ( i + 1 ) % n ];
		const length = Math.hypot( e[ 0 ] - b[ 0 ], e[ 1 ] - b[ 1 ] );
		const nx = ( e[ 0 ] - b[ 0 ] ) / length, ny = ( e[ 1 ] - b[ 1 ] ) / length;
		edges.push( { ring, index: i, bx: b[ 0 ], by: b[ 1 ], ex: e[ 0 ], ey: e[ 1 ], nx, ny, a: - ny, b: nx, c: ny * b[ 0 ] - nx * b[ 1 ], bisPrev: null, bisNext: null } );

	}

	for ( let i = 0; i < n; i ++ ) {

		const edge = edges[ i ], next = edges[ ( i + 1 ) % n ];
		const bis = bisectorAt( edge.ex, edge.ey, edge, next );
		edge.bisNext = bis;
		next.bisPrev = bis;
		S.edges.push( edge );

	}

	const lav = { first: null, size: 0 };
	S.lavs.add( lav );
	for ( let i = 0; i < n; i ++ ) {

		const edge = edges[ i ], next = edges[ ( i + 1 ) % n ];
		lavAppend( lav, makeVertex( edge.ex, edge.ey, 0, edge.bisNext, edge, next ) );

	}

	for ( const v of lavVertices( lav ) ) {

		const q = makeFaceQueue( v.nextEdge );
		S.faces.push( q );
		q.a = v.right = { v, q };
		q.nodes.push( v.right );
		v.next.left = facePush( v.right, v.next );

	}

}

function initEvents( S ) {

	for ( const lav of S.lavs ) {

		for ( const v of lavVertices( lav ) ) {

			computeSplitEvents( S, v );
			const p = intersectBisectors( S, v, v.next );
			if ( p !== null ) heapPush( S.queue, edgeEvent( p, v, v.next ) );

		}

	}

}

function edgeEvent( p, prev, next ) {

	const edge = prev.nextEdge;
	return { kind: EDGE, x: p[ 0 ], y: p[ 1 ], t: Math.abs( edge.a * p[ 0 ] + edge.b * p[ 1 ] + edge.c ), prev, next, parent: null, opposite: null };

}

function isObsolete( event ) {

	if ( event.kind === EDGE ) return event.prev.processed || event.next.processed || event.prev.next !== event.next;
	return event.parent.processed;

}

// Where the bisectors of two neighbours meet, unless they meet where one of
// them already is.
function intersectBisectors( S, prev, next ) {

	const p = rayRayHit( prev.bis, next.bis, S.eps );
	if ( p === null ) return null;
	if ( distance2( p[ 0 ], p[ 1 ], prev.x, prev.y ) <= S.eps * S.eps ) return null;
	if ( distance2( p[ 0 ], p[ 1 ], next.x, next.y ) <= S.eps * S.eps ) return null;
	return p;

}

// Events of a new vertex: the nearer of its two edge events (both when they
// tie), and where it will meet every other edge's wavefront: the point on
// its bisector as far from that edge's line as from its own. Whether that
// edge's wavefront still reaches there at that time is only known when the
// event comes up, so every candidate is queued and judged then. Reflex
// vertices are the usual splitters, but a convex one can be run into as
// well, by the wavefront of a nearly parallel edge closing a corridor.
function computeEvents( S, v ) {

	computeCloserEdgeEvent( S, v );
	computeSplitEvents( S, v );

}

function computeCloserEdgeEvent( S, v ) {

	const p1 = intersectBisectors( S, v, v.next );
	const p2 = intersectBisectors( S, v.prev, v );
	if ( p1 === null && p2 === null ) return;
	const d1 = p1 !== null ? distance2( v.x, v.y, p1[ 0 ], p1[ 1 ] ) : Infinity;
	const d2 = p2 !== null ? distance2( v.x, v.y, p2[ 0 ], p2[ 1 ] ) : Infinity;
	if ( d1 - S.eps < d2 ) heapPush( S.queue, edgeEvent( p1, v, v.next ) );
	if ( d2 - S.eps < d1 ) heapPush( S.queue, edgeEvent( p2, v.prev, v ) );

}

function computeSplitEvents( S, v ) {

	const own = v.prevEdge;
	const bis = v.bis;
	const ownDistance = own.a * v.x + own.b * v.y + own.c;
	const ownRate = own.a * bis.ux + own.b * bis.uy;
	for ( const edge of S.edges ) {

		if ( edge === own || edge === v.nextEdge ) continue;
		const rate = edge.a * bis.ux + edge.b * bis.uy;
		if ( Math.abs( rate - ownRate ) < ANGLE_EPS ) continue;
		const s = ( ownDistance - ( edge.a * v.x + edge.b * v.y + edge.c ) ) / ( rate - ownRate );
		if ( s < S.eps ) continue;
		const x = v.x + s * bis.ux, y = v.y + s * bis.uy;
		const t = edge.a * x + edge.b * y + edge.c;
		if ( t < v.t - S.eps ) continue;
		heapPush( S.queue, { kind: SPLIT, x, y, t, prev: null, next: null, parent: v, opposite: edge } );

	}

}

// Taking events off the queue. Everything at the next time is one level;
// within it, events sharing a vertex or a point are one cluster, and a
// cluster is turned into chains: an edge chain where consecutive edges
// vanish together (closed when a whole LAV does), a split chain for each
// vertex arriving there on its own.

function loadLevelEvents( S, level ) {

	const out = [];
	while ( S.queue.length > 0 ) {

		if ( level !== null && S.queue[ 0 ].t > level + S.eps ) break;
		const event = heapPop( S.queue );
		if ( isObsolete( event ) ) continue;
		// a split whose edge has no wavefront piece passing here any more
		// (the LAV was cut since the candidate was computed) is dropped now,
		// before it can be clustered with real events of the same vertex
		if ( event.kind === SPLIT && findOppositeEdgePiece( S, event.opposite, event.x, event.y ) === null ) continue;
		if ( level === null ) level = event.t;
		out.push( event );

	}

	return out;

}

function eventVertices( event ) {

	return event.kind === EDGE ? [ event.prev, event.next ] : [ event.parent ];

}

// The cluster of the first pending event: every pending event sharing a
// vertex with one already in the cluster, or at the same point.
function nextCluster( S, pending ) {

	const event = pending.shift();
	const group = new Set( eventVertices( event ) );
	const cluster = [ event ];
	for ( let j = 0; j < pending.length; j ++ ) {

		const test = pending[ j ];
		const shared = eventVertices( test ).some( v => group.has( v ) );
		if ( shared || distance2( event.x, event.y, test.x, test.y ) < S.eps * S.eps ) {

			pending.splice( j --, 1 );
			cluster.push( test );
			for ( const v of eventVertices( test ) ) group.add( v );

		}

	}

	const { x, y, t } = event;
	const chains = createChains( cluster );
	if ( chains.length === 1 && chains[ 0 ].kind === CHAIN_EDGE ) return { kind: chains[ 0 ].closed ? PICK : MULTI_EDGE, x, y, t, chain: chains[ 0 ] };
	return { kind: MULTI_SPLIT, x, y, t, chains };

}

function createChains( cluster ) {

	const edgeCluster = [], splits = new Map();
	for ( const event of cluster ) {

		if ( event.kind === EDGE ) {

			// the same pair can be queued twice when a vertex's events are
			// recomputed
			if ( ! edgeCluster.some( e => e.prev === event.prev && e.next === event.next ) ) edgeCluster.push( event );

		} else {

			// one chain per reflex vertex, however many edges it meets here
			const chain = splits.get( event.parent );
			if ( chain === undefined ) splits.set( event.parent, { kind: CHAIN_SPLIT, event, opposites: [ event.opposite ] } );
			else if ( ! chain.opposites.includes( event.opposite ) ) chain.opposites.push( event.opposite );

		}

	}

	const chains = [];
	while ( edgeCluster.length > 0 ) chains.push( createEdgeChain( edgeCluster ) );
	const edgeChains = chains.slice();
	for ( const chain of splits.values() ) {

		if ( ! edgeChains.some( c => chainHasVertex( c, chain.event.parent ) ) ) chains.push( chain );

	}

	return chains;

}

function createEdgeChain( edgeCluster ) {

	const events = [ edgeCluster.shift() ];
	for ( let grown = true; grown; ) {

		grown = false;
		const begin = events[ 0 ].prev, end = events[ events.length - 1 ].next;
		for ( let i = 0; i < edgeCluster.length; i ++ ) {

			const e = edgeCluster[ i ];
			if ( e.prev === end ) { edgeCluster.splice( i, 1 ); events.push( e ); grown = true; break; }
			if ( e.next === begin ) { edgeCluster.splice( i, 1 ); events.unshift( e ); grown = true; break; }

		}

	}

	return { kind: CHAIN_EDGE, events, closed: events[ 0 ].prev === events[ events.length - 1 ].next };

}

function chainHasVertex( chain, v ) {

	if ( chain.kind === CHAIN_EDGE ) return chain.events.some( e => e.prev === v || e.next === v );
	if ( chain.kind === CHAIN_SPLIT ) return chain.event.parent === v;
	return false;

}

// A chain's ends: the edges on either side of what it takes out of the
// LAV, and the vertices that stay beyond them. For a split chain that is
// the parent's neighbours, for an edge chain the neighbours of its first
// and last vertex, for an opposite edge the two vertices carrying it. They
// are read when asked for, since the LAVs move under a multi split event.
function chainEnds( c ) {

	if ( c.kind === CHAIN_EDGE ) {

		const first = c.events[ 0 ].prev, last = c.events[ c.events.length - 1 ].next;
		return { prevEdge: first.prevEdge, nextEdge: last.nextEdge, prevVertex: first.prev, nextVertex: last.next };

	}

	if ( c.kind === CHAIN_SPLIT ) {

		const parent = c.event.parent;
		return { prevEdge: parent.prevEdge, nextEdge: parent.nextEdge, prevVertex: parent.prev, nextVertex: parent.next };

	}

	return { prevEdge: c.edge, nextEdge: c.edge, prevVertex: c.prevVertex, nextVertex: c.nextVertex };

}

// Event handlers.

// Consecutive edges vanish: their vertices leave the LAV for one new vertex
// between the outer edges, and each vanished edge's face closes on it.
function multiEdgeEvent( S, event ) {

	const events = event.chain.events;
	const prevV = events[ 0 ].prev, nextV = events[ events.length - 1 ].next;
	if ( ! prevV.processed && ! nextV.processed ) collapse( S, events, prevV, nextV, event.x, event.y, event.t );

}

// The vertices from prevV to nextV leave the LAV for one new vertex at the
// point, between prevV's previous edge and nextV's next edge.
function collapse( S, events, prevV, nextV, x, y, t ) {

	prevV.processed = true;
	nextV.processed = true;
	const v = makeVertex( x, y, t, bisectorAt( x, y, prevV.prevEdge, nextV.nextEdge ), prevV.prevEdge, nextV.nextEdge );
	correctBisector( v.bis, nextV.next, prevV.prev, nextV.nextEdge, prevV.prevEdge );
	v.left = facePush( prevV.left, v );
	v.right = facePush( nextV.right, v );
	lavInsertBefore( prevV, v );
	addMultiBackFaces( events, v );
	computeEvents( S, v );
	return v;

}

function addMultiBackFaces( events, v ) {

	for ( const e of events ) {

		e.prev.processed = true;
		lavRemove( e.prev );
		e.next.processed = true;
		lavRemove( e.next );
		faceConnect( facePush( e.prev.right, v ), e.next.left );

	}

}

// A whole LAV collapses to a point.
function pickChain( chain, x, y, t ) {

	const v = makeVertex( x, y, t, null, null, null );
	v.processed = true;
	addMultiBackFaces( chain.events, v );

}

// Reflex vertices (and vanishing edges) arrive at one point from several
// sides, splitting the LAVs they are on. Each edge hit from across joins as
// a chain of its own; sorted around the point, every pair of consecutive
// chains yields one new vertex between the first's next edge and the
// second's previous edge, taking over the LAV part between them. What the
// chains were made of leaves the LAV at the end.
function multiSplitEvent( S, event ) {

	let chains = event.chains;
	const cx = event.x, cy = event.y;
	for ( const chain of chains ) if ( chain.kind === CHAIN_EDGE && chain.closed ) pickChain( chain, cx, cy, event.t );
	chains = chains.filter( chain => ! ( chain.kind === CHAIN_EDGE && chain.closed ) );
	chains = createOppositeEdgeChains( S, chains, cx, cy );
	if ( chains.length === 0 ) return;

	// in the order their wavefronts come into the point, counterclockwise
	const incoming = c => { const e = chainEnds( c ).prevEdge; return Math.atan2( - e.ny, - e.nx ); };
	const outgoing = c => { const e = chainEnds( c ).nextEdge; return Math.atan2( e.ny, e.nx ); };
	chains.sort( ( p, q ) => ( incoming( p ) - incoming( q ) ) || ( outgoing( p ) - outgoing( q ) ) );

	let lastFaceNode = null;
	const n = chains.length;
	for ( let i = 0; i < n; i ++ ) {

		const begin = chains[ i ], end = chains[ ( i + 1 ) % n ];
		const { nextEdge, nextVertex: beginNext } = chainEnds( begin );
		const { prevEdge, prevVertex: endPrev } = chainEnds( end );
		const v = makeVertex( cx, cy, event.t, bisectorAt( cx, cy, prevEdge, nextEdge ), prevEdge, nextEdge );
		if ( beginNext.prevEdge !== nextEdge || endPrev.nextEdge !== prevEdge ) throw new Error( 'chain ends out of step' );
		correctBisector( v.bis, beginNext, endPrev, nextEdge, prevEdge );

		if ( beginNext.lav !== null && beginNext.lav === endPrev.lav ) {

			const part = cutLavPart( beginNext, endPrev );
			const lav = { first: null, size: 0 };
			S.lavs.add( lav );
			lavAppend( lav, v );
			for ( const w of part ) lavAppend( lav, w );

		} else {

			mergeBeforeBaseVertex( beginNext, endPrev );
			lavInsertBefore( endPrev.next, v );

		}

		computeEvents( S, v );
		lastFaceNode = addSplitFaces( lastFaceNode, begin, end, v );

	}

	for ( const chain of chains ) {

		if ( chain.kind === CHAIN_SPLIT ) {

			lavRemove( chain.event.parent );
			chain.event.parent.processed = true;

		} else if ( chain.kind === CHAIN_EDGE ) {

			pickChain( chain, cx, cy, event.t );

		}

	}

}

// Near a hairpin the bisector's sign is unreliable; take it from where the
// neighbours are.
function correctBisector( bis, beginNext, endPrev, beginEdge, endEdge ) {

	if ( beginEdge.nx * endEdge.nx + beginEdge.ny * endEdge.ny < - 0.97 ) {

		const r1 = makeRay( 0, 0, bis.ax - endPrev.x, bis.ay - endPrev.y );
		const r2 = makeRay( 0, 0, beginNext.x - bis.ax, beginNext.y - bis.ay );
		const guess = bisectorVector( r1.ux, r1.uy, r2.ux, r2.uy );
		if ( bis.ux * guess[ 0 ] + bis.uy * guess[ 1 ] < 0 ) { bis.ux = - bis.ux; bis.uy = - bis.uy; }

	}

}

function cutLavPart( start, end ) {

	const out = [];
	const size = start.lav.size;
	let next = start;
	for ( let i = 0; i < size; i ++ ) {

		const current = next;
		next = current.next;
		lavRemove( current );
		out.push( current );
		if ( current === end ) return out;

	}

	throw new Error( 'end vertex not on the start vertex lav' );

}

function mergeBeforeBaseVertex( base, merged ) {

	const size = merged.lav.size;
	for ( let i = 0; i < size; i ++ ) {

		const next = merged.next;
		lavRemove( next );
		lavInsertBefore( base, next );

	}

}

// Face links of a split vertex. Against a chain with vertices of its own
// the new vertex continues the outermost one's face; against an opposite
// edge it starts a loose node, shared by the two new vertices that edge's
// face will reach, merged into the edge's face when they do.
function addSplitFaces( lastFaceNode, begin, end, v ) {

	if ( begin.kind === CHAIN_SINGLE ) lastFaceNode = shareLoose( v, 'right', lastFaceNode );
	else v.right = facePush( ( begin.kind === CHAIN_SPLIT ? begin.event.parent : begin.events[ begin.events.length - 1 ].next ).right, v );
	if ( end.kind === CHAIN_SINGLE ) lastFaceNode = shareLoose( v, 'left', lastFaceNode );
	else v.left = facePush( ( end.kind === CHAIN_SPLIT ? end.event.parent : end.events[ 0 ].prev ).left, v );
	return lastFaceNode;

}

function shareLoose( v, key, lastFaceNode ) {

	if ( lastFaceNode !== null ) { v[ key ] = lastFaceNode; return null; }
	v[ key ] = looseFaceNode( v );
	return v[ key ];

}

// For every edge hit from across, the piece of it still on a LAV whose
// wavefront passes through the point now (the piece between the bisectors
// of the two vertices carrying it) joins the event: as a chain of its own,
// or, when the point is on one of those bisectors, as that vertex, which is
// arriving here too. A split none of whose edges has such a piece is
// stale, from before the LAV was cut, and dropped; the parent's later
// candidates are still queued. A vertex already in the cluster is not
// added twice.
function createOppositeEdgeChains( S, chains, cx, cy ) {

	const seen = new Set(), out = chains.slice();
	for ( const chain of chains ) {

		if ( chain.kind !== CHAIN_SPLIT || chain.opposites === undefined ) continue;
		let reached = 0;
		for ( const edge of chain.opposites ) {

			if ( seen.has( edge ) ) { reached ++; continue; }
			seen.add( edge );
			const piece = findOppositeEdgePiece( S, edge, cx, cy );
			if ( piece === null ) continue;
			reached ++;
			const begin = piece.prev, end = piece;
			let partner = null;
			if ( side( begin.bis, cx, cy ) < S.eps ) partner = begin;
			else if ( side( end.bis, cx, cy ) > - S.eps ) partner = end;
			if ( partner === null ) out.push( { kind: CHAIN_SINGLE, edge, nextVertex: end, prevVertex: begin } );
			else if ( ! out.some( c => chainHasVertex( c, partner ) ) ) out.push( { kind: CHAIN_SPLIT, event: { kind: SPLIT, x: cx, y: cy, t: 0, prev: null, next: null, parent: partner, opposite: null } } );

		}

		if ( reached === 0 ) out.splice( out.indexOf( chain ), 1 );

	}

	return out;

}

function findOppositeEdgePiece( S, edge, cx, cy ) {

	for ( const lav of S.lavs ) {

		if ( lav.size < 2 ) continue;
		for ( const v of lavVertices( lav ) ) {

			if ( v.prevEdge === edge ) {

				if ( pieceReaches( v.prev, v, edge, cx, cy, S.eps ) ) return v;
				break;

			}

		}

	}

	return null;

}

// Whether the piece of an edge carried by two LAV vertices passes through
// a point when its wavefront gets there: between the paths of its two ends.
// When those paths run along the edge (a corridor between parallel edges
// closing all at once) the point must lie between the ends themselves.
function pieceReaches( begin, end, edge, x, y, eps ) {

	if ( side( begin.bis, x, y ) < - eps || side( end.bis, x, y ) > eps ) return false;
	const along = edge.nx * x + edge.ny * y;
	if ( Math.abs( begin.bis.ux * edge.ny - begin.bis.uy * edge.nx ) < ANGLE_EPS && along < edge.nx * begin.x + edge.ny * begin.y - eps ) return false;
	if ( Math.abs( end.bis.ux * edge.ny - end.bis.uy * edge.nx ) < ANGLE_EPS && along > edge.nx * end.x + edge.ny * end.y + eps ) return false;
	return true;

}

// Two neighbours at the same point carry a piece of zero length, left by a
// multi split where several wavefronts met at once (a corridor between
// parallel edges closing onto a corner). Their bisectors never meet again,
// so the edge event that would take the piece out is applied here instead.
function mergeCoincident( S ) {

	const eps2 = S.eps * S.eps;
	for ( const lav of S.lavs ) {

		let v = lav.first, guard = lav.size;
		while ( lav.size > 2 && guard -- > 0 ) {

			const w = v.next;
			if ( distance2( v.x, v.y, w.x, w.y ) > eps2 ) { v = w; continue; }
			v = collapse( S, [ { prev: v, next: w } ], v, w, v.x, v.y, Math.max( v.t, w.t ) );
			guard = lav.size;

		}

	}

}

// A LAV down to two vertices is a collapsed edge pair: both faces close.
// One down to a single vertex is an edge whose two ends met in a multi
// split (a corridor closing all at once): its face closes on that vertex.
function processTwoNodeLavs( S ) {

	for ( const lav of S.lavs ) {

		if ( lav.size !== 1 && lav.size !== 2 ) continue;
		const first = lav.first, last = first.next;
		faceConnect( first.left, last.right );
		if ( lav.size === 2 ) faceConnect( first.right, last.left );
		first.processed = true;
		last.processed = true;
		lavRemove( first );
		lavRemove( last );

	}

}

// Output: each face read round from the edge's start vertex.
function collectFaces( S, polygon ) {

	const offsets = [];
	let total = 0;
	for ( const ring of polygon ) { offsets.push( total ); total += ring.length; }
	const faces = new Array( total ).fill( null );
	let maxTime = 0;

	for ( const q of S.faces ) {

		const nodes = q.nodes, ia = nodes.indexOf( q.a );
		if ( ! q.closed || nodes.length < 3 || ia < 0 ) return null;
		const path = nodes.slice( ia ).concat( nodes.slice( 0, ia ) ).map( node => [ node.v.x, node.v.y, node.v.t ] );

		// split vertices are linked in twice at times, once per side
		const unique = [];
		for ( const p of path ) {

			const last = unique.length > 0 ? unique[ unique.length - 1 ] : null;
			const first = unique.length > 0 ? unique[ 0 ] : null;
			if ( last !== null && distance2( p[ 0 ], p[ 1 ], last[ 0 ], last[ 1 ] ) <= S.eps * S.eps ) continue;
			if ( first !== null && unique.length > 2 && distance2( p[ 0 ], p[ 1 ], first[ 0 ], first[ 1 ] ) <= S.eps * S.eps ) continue;
			if ( ! Number.isFinite( p[ 0 ] ) || ! Number.isFinite( p[ 1 ] ) || ! Number.isFinite( p[ 2 ] ) ) return null;
			if ( p[ 2 ] > maxTime ) maxTime = p[ 2 ];
			unique.push( p );

		}

		if ( unique.length < 3 ) return null;
		// a ring that was reversed is handed back in the caller's order: its
		// edge j is the caller's edge n - 2 - j, and the face is read the
		// other way round from that edge's far end
		const ring = polygon[ q.edge.ring ];
		let edge = q.edge.index, points = unique;
		if ( ring.reversed ) {

			edge = ( 2 * ring.length - 2 - edge ) % ring.length;
			points = [ unique[ 1 ], unique[ 0 ], ...unique.slice( 2 ).reverse() ];

		}

		faces[ offsets[ q.edge.ring ] + edge ] = { ring: q.edge.ring, edge, points };

	}

	if ( faces.some( face => face === null ) ) return null;
	return { faces, maxTime };

}
