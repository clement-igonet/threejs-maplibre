// Clipping in tile space. Tiles carry a buffer of geometry past their edges
// so lines and polygons can be built without seams, but drawing that buffer
// would overlap the neighbour tile. Polygons and lines are therefore clipped
// to the exact tile square before they are built; line endpoints created by
// the clip remember which edge cut them, so the line builder can end them
// along the tile edge and the two halves of a road meet without a notch.

// Sutherland-Hodgman on a flat closed ring [ x0, y0, x1, y1, ... ]. Returns a
// flat closed ring, or null when nothing is left.
export function clipRing( ring, min, max ) {

	let input = ring;
	for ( let edge = 0; edge < 4; edge ++ ) {

		const axis = edge & 1; // 0: x, 1: y
		const bound = edge < 2 ? min : max;
		const keepBelow = edge >= 2; // max edges keep values <= bound
		const output = [];
		const count = input.length / 2;
		if ( count === 0 ) return null;

		for ( let i = 0; i < count; i ++ ) {

			const j = ( i + 1 ) % count;
			const ax = input[ 2 * i ], ay = input[ 2 * i + 1 ];
			const bx = input[ 2 * j ], by = input[ 2 * j + 1 ];
			const a = axis === 0 ? ax : ay;
			const b = axis === 0 ? bx : by;
			const aIn = keepBelow ? a <= bound : a >= bound;
			const bIn = keepBelow ? b <= bound : b >= bound;

			if ( aIn ) output.push( ax, ay );
			if ( aIn !== bIn ) {

				const t = ( bound - a ) / ( b - a );
				output.push( ax + t * ( bx - ax ), ay + t * ( by - ay ) );

			}

		}

		input = output;

	}

	if ( input.length < 6 ) return null;
	// close the ring
	if ( input[ 0 ] !== input[ input.length - 2 ] || input[ 1 ] !== input[ input.length - 1 ] ) input.push( input[ 0 ], input[ 1 ] );
	return input;

}

// Clips a flat polyline to the square; returns runs of
// { points, startEdge, endEdge } where the edge fields are null or the
// direction of the tile edge that cut the run ( 'x' along x, 'y' along y ).
export function clipPolyline( points, min, max ) {

	const runs = [];
	let run = null;
	let runStartEdge = null;

	const inside = ( x, y ) => x >= min && x <= max && y >= min && y <= max;
	const count = points.length / 2;

	for ( let i = 0; i < count - 1; i ++ ) {

		let ax = points[ 2 * i ], ay = points[ 2 * i + 1 ];
		let bx = points[ 2 * i + 2 ], by = points[ 2 * i + 3 ];
		const aIn = inside( ax, ay );
		const bIn = inside( bx, by );

		if ( aIn && bIn ) {

			if ( ! run ) run = [ ax, ay ], runStartEdge = null;
			run.push( bx, by );
			continue;

		}

		// Liang-Barsky parametric clip of the segment
		const dx = bx - ax, dy = by - ay;
		let t0 = 0, t1 = 1;
		let edge0 = null, edge1 = null;
		const tests = [ [ - dx, ax - min, 'y' ], [ dx, max - ax, 'y' ], [ - dy, ay - min, 'x' ], [ dy, max - ay, 'x' ] ];
		let visible = true;
		for ( const [ p, q, edge ] of tests ) {

			if ( p === 0 ) {

				if ( q < 0 ) visible = false;
				continue;

			}

			const t = q / p;
			if ( p < 0 ) {

				if ( t > t1 ) visible = false;
				else if ( t > t0 ) t0 = t, edge0 = edge;

			} else {

				if ( t < t0 ) visible = false;
				else if ( t < t1 ) t1 = t, edge1 = edge;

			}

		}

		if ( ! visible ) {

			if ( run ) runs.push( { points: run, startEdge: runStartEdge, endEdge: null } ), run = null;
			continue;

		}

		const cx = ax + t0 * dx, cy = ay + t0 * dy;
		const ex = ax + t1 * dx, ey = ay + t1 * dy;

		if ( ! aIn ) {

			// the run starts on a tile edge
			if ( run ) runs.push( { points: run, startEdge: runStartEdge, endEdge: null } );
			run = [ cx, cy ];
			runStartEdge = edge0;

		} else if ( ! run ) {

			run = [ ax, ay ];
			runStartEdge = null;

		}

		if ( ! bIn ) {

			run.push( ex, ey );
			runs.push( { points: run, startEdge: runStartEdge, endEdge: edge1 } );
			run = null;

		} else {

			run.push( bx, by );

		}

	}

	if ( run ) runs.push( { points: run, startEdge: runStartEdge, endEdge: null } );
	return runs.filter( r => r.points.length >= 4 );

}
