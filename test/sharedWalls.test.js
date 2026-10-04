import { describe, expect, it } from 'vitest';
import { appendExtrusion, uncovered } from '../src/build/buildPolygons.js';

// tile space to a y-up world, 1 unit a meter
const projection = { project( x, y, h, out ) { out[ 0 ] = x; out[ 1 ] = h; out[ 2 ] = y; return out; } };
const white = [ 255, 255, 255, 255 ];
const newOut = () => ( { positions: [], colors: [], indices: [], vertexCount: 0 } );

// two 10 x 10 boxes side by side sharing the edge x = 10, the left one
// clockwise in tile space as MVT rings come
const left = [ [ 0, 0, 10, 0, 10, 10, 0, 10 ] ];
const right = [ [ 10, 0, 20, 0, 20, 10, 10, 10 ] ];
function edgesOf( polygon, span, edges ) {

	for ( const ring of polygon ) {

		const n = ring.length / 2;
		for ( let i = 0; i < n; i ++ ) { const j = ( i + 1 ) % n; const key = `${ ring[ 2 * i ] },${ ring[ 2 * i + 1 ] },${ ring[ 2 * j ] },${ ring[ 2 * j + 1 ] }`; ( edges.get( key ) ?? edges.set( key, [] ).get( key ) ).push( span ); }

	}

}

// the faces of the wall on x = 10, as [ minY, maxY ] in height
function wallOnShared( out ) {

	const spans = [];
	for ( let i = 0; i < out.indices.length; i += 3 ) {

		const vs = [ 0, 1, 2 ].map( k => out.indices[ i + k ] );
		if ( vs.every( v => Math.abs( out.positions[ 3 * v ] - 10 ) < 1e-9 ) ) spans.push( vs.map( v => out.positions[ 3 * v + 1 ] ) );

	}

	return spans;

}

describe( 'shared walls', () => {

	it( 'takes covered spans out of a wall', () => {

		expect( uncovered( 0, 18, [ [ 0, 18 ] ] ) ).toEqual( [] );
		expect( uncovered( 0, 18, [ [ 0, 10 ] ] ) ).toEqual( [ [ 10, 18 ] ] );
		expect( uncovered( 0, 18, [ [ 3, 6 ] ] ) ).toEqual( [ [ 0, 3 ], [ 6, 18 ] ] );
		expect( uncovered( 0, 18, null ) ).toEqual( [ [ 0, 18 ] ] );

	} );

	it( 'draws no partition between two parts of one height, and the upper wall over a lower neighbour', () => {

		for ( const [ leftHeight, rightHeight ] of [ [ 18, 18 ], [ 18, 10 ] ] ) {

			const edges = new Map();
			edgesOf( left, [ 0, leftHeight ], edges );
			edgesOf( right, [ 0, rightHeight ], edges );
			const covered = ( ax, ay, bx, by ) => edges.get( `${ bx },${ by },${ ax },${ ay }` ) ?? null;
			const out = newOut();
			appendExtrusion( out, left, projection, white, 0, leftHeight, white, null, covered );
			appendExtrusion( out, right, projection, white, 0, rightHeight, white, null, covered );
			const shared = wallOnShared( out ).filter( ys => ys.some( y => y > 1e-9 ) && Math.max( ...ys ) - Math.min( ...ys ) > 1e-9 ); // wall faces, not the roofs' edges
			if ( leftHeight === rightHeight ) {

				expect( shared ).toEqual( [] );

			} else {

				// only the left part's wall above the right one's roof
				expect( shared.length ).toBe( 2 );
				for ( const ys of shared ) expect( Math.min( ...ys ) ).toBeCloseTo( 10, 9 );

			}

		}

	} );

} );
