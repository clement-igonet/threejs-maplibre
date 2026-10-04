import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { straightSkeleton } from '../src/build/straightSkeleton.js';

const footprints = JSON.parse( readFileSync( new URL( './fixtures/footprints.json', import.meta.url ) ) );

const flat = pts => pts.flat();
const ringArea = pts => {

	let area = 0;
	for ( let i = 0, j = pts.length - 1; i < pts.length; j = i ++ ) area += pts[ j ][ 0 ] * pts[ i ][ 1 ] - pts[ i ][ 0 ] * pts[ j ][ 1 ];
	return area / 2;

};
const polygonArea = rings => rings.reduce( ( sum, ring, i ) => sum + ( i === 0 ? 1 : - 1 ) * Math.abs( ringArea( ring ) ), 0 );
const facesArea = faces => faces.reduce( ( sum, face ) => sum + Math.abs( ringArea( face.points ) ), 0 );
const times = faces => faces.flatMap( face => face.points.map( p => p[ 2 ] ) );
const near = ( a, b, eps = 1e-6 ) => Math.abs( a - b ) < eps;
const hasPoint = ( face, x, y, t ) => face.points.some( p => near( p[ 0 ], x ) && near( p[ 1 ], y ) && near( p[ 2 ], t ) );

// faces tile the footprint: every t finite and non-negative, every face a
// polygon, the areas adding up, the first two points the contour edge
function checkTiling( result, rings, relative = 1e-6 ) {

	expect( result ).not.toBeNull();
	const count = rings.reduce( ( n, ring ) => n + ring.length / 2, 0 );
	expect( result.faces.length ).toBe( count );
	for ( const face of result.faces ) {

		expect( face.points.length ).toBeGreaterThanOrEqual( 3 );
		expect( face.points[ 0 ][ 2 ] ).toBe( 0 );
		expect( face.points[ 1 ][ 2 ] ).toBe( 0 );

	}

	for ( const t of times( result.faces ) ) {

		expect( Number.isFinite( t ) ).toBe( true );
		expect( t ).toBeGreaterThanOrEqual( 0 );

	}

	const expected = polygonArea( rings.map( ring => toPoints( ring ) ) );
	expect( Math.abs( facesArea( result.faces ) - expected ) ).toBeLessThan( relative * expected );
	expect( result.maxTime ).toBe( Math.max( ...times( result.faces ) ) );

}

function toPoints( flatRing ) {

	const pts = [];
	for ( let i = 0; i < flatRing.length; i += 2 ) pts.push( [ flatRing[ i ], flatRing[ i + 1 ] ] );
	return pts;

}

// a small deterministic PRNG (mulberry32)
function prng( seed ) {

	return () => {

		seed |= 0; seed = seed + 0x6D2B79F5 | 0;
		let t = Math.imul( seed ^ seed >>> 15, 1 | seed );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;

	};

}

describe( 'straightSkeleton', () => {

	it( 'collapses a square to its centre', () => {

		const square = [ [ 0, 0, 10, 0, 10, 10, 0, 10 ] ];
		const result = straightSkeleton( square );
		checkTiling( result, square );
		expect( result.faces.length ).toBe( 4 );
		expect( near( result.maxTime, 5 ) ).toBe( true );
		result.faces.forEach( ( face, i ) => {

			expect( face ).toMatchObject( { ring: 0, edge: i } );
			expect( face.points.length ).toBe( 3 );
			expect( hasPoint( face, 5, 5, 5 ) ).toBe( true );

		} );

	} );

	it( 'gives a rectangle a ridge, two trapezoids and two triangles', () => {

		const rect = [ [ 0, 0, 20, 0, 20, 10, 0, 10 ] ];
		const result = straightSkeleton( rect );
		checkTiling( result, rect );
		expect( result.faces.length ).toBe( 4 );
		expect( near( result.maxTime, 5 ) ).toBe( true );
		const sizes = result.faces.map( face => face.points.length );
		expect( sizes ).toEqual( [ 4, 3, 4, 3 ] );
		for ( const face of result.faces ) {

			expect( hasPoint( face, 5, 5, 5 ) || hasPoint( face, 15, 5, 5 ) ).toBe( true );

		}

		expect( hasPoint( result.faces[ 0 ], 5, 5, 5 ) && hasPoint( result.faces[ 0 ], 15, 5, 5 ) ).toBe( true );

	} );

	it( 'reads the rectangle the same clockwise and in a y-down frame', () => {

		const ccw = straightSkeleton( [ [ 0, 0, 20, 0, 20, 10, 0, 10 ] ] );
		const cw = straightSkeleton( [ [ 0, 10, 20, 10, 20, 0, 0, 0 ] ] );
		const down = straightSkeleton( [ [ 0, 0, 20, 0, 20, - 10, 0, - 10 ] ] );
		for ( const result of [ cw, down ] ) {

			expect( result ).not.toBeNull();
			expect( result.faces.length ).toBe( 4 );
			expect( near( result.maxTime, 5 ) ).toBe( true );
			expect( result.faces.map( face => face.points.length ).sort() ).toEqual( [ 3, 3, 4, 4 ] );

		}

		checkTiling( cw, [ [ 0, 10, 20, 10, 20, 0, 0, 0 ] ] );
		checkTiling( down, [ [ 0, 0, 20, 0, 20, - 10, 0, - 10 ] ] );
		expect( cw.faces[ 0 ].points[ 0 ] ).toEqual( [ 0, 10, 0 ] ); // contour order kept
		expect( cw.faces[ 0 ].points[ 1 ] ).toEqual( [ 20, 10, 0 ] );
		const ridge = result => result.faces.flatMap( face => face.points.filter( p => p[ 2 ] > 0 ) ).map( p => p[ 0 ] + ',' + Math.abs( p[ 1 ] ) );
		expect( new Set( ridge( ccw ) ) ).toEqual( new Set( ridge( down ) ) );

	} );

	it( 'splits an L-shape at its reflex vertex', () => {

		const L = [ [ 0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20 ] ];
		const result = straightSkeleton( L );
		checkTiling( result, L );
		expect( result.faces.length ).toBe( 6 );
		expect( near( result.maxTime, 5 ) ).toBe( true );
		// the reflex vertex (10, 10) reaches the opposite corner (5, 5) at t = 5
		// and the two arms keep a ridge each
		const reflex = result.faces.filter( face => hasPoint( face, 5, 5, 5 ) );
		expect( reflex.length ).toBeGreaterThanOrEqual( 4 );
		expect( result.faces.some( face => hasPoint( face, 15, 5, 5 ) ) ).toBe( true );
		expect( result.faces.some( face => hasPoint( face, 5, 15, 5 ) ) ).toBe( true );

	} );

	it( 'handles a square with a square hole', () => {

		const rings = [ [ 0, 0, 30, 0, 30, 30, 0, 30 ], [ 10, 10, 10, 20, 20, 20, 20, 10 ] ];
		const result = straightSkeleton( rings );
		checkTiling( result, rings );
		expect( result.faces.length ).toBe( 8 );
		expect( result.maxTime ).toBeLessThanOrEqual( 5 + 1e-9 );
		expect( near( result.maxTime, 5 ) ).toBe( true );
		expect( result.faces.filter( face => face.ring === 1 ).length ).toBe( 4 );

	} );

	it( 'skeletons the real footprints', () => {

		for ( const key of [ 'marsan', 'barreau', 'chatelet', 'bourse', 'marly' ] ) {

			const ring = flat( footprints[ key ].meters );
			const start = performance.now();
			const result = straightSkeleton( [ ring ] );
			const elapsed = performance.now() - start;
			expect( result, key ).not.toBeNull();
			// the pre-pass may drop near-collinear vertices: one face per kept edge
			const kept = result.faces.length;
			expect( kept ).toBeLessThanOrEqual( ring.length / 2 );
			expect( kept ).toBeGreaterThanOrEqual( 3 );
			for ( const face of result.faces ) expect( face.points.length, key ).toBeGreaterThanOrEqual( 3 );
			for ( const t of times( result.faces ) ) expect( Number.isFinite( t ) && t >= 0, key ).toBe( true );
			const expected = Math.abs( ringArea( footprints[ key ].meters ) );
			expect( Math.abs( facesArea( result.faces ) - expected ) / expected, key ).toBeLessThan( 0.005 );
			if ( key === 'marly' ) {

				expect( ring.length / 2 ).toBe( 179 );
				expect( elapsed ).toBeLessThan( 200 );

			}

		}

	} );

	it( 'survives random stars and staircases', () => {

		const random = prng( 1234 );
		const cases = [];
		for ( let i = 0; i < 300; i ++ ) {

			const n = 5 + Math.floor( random() * 36 );
			const ring = [];
			for ( let k = 0; k < n; k ++ ) {

				const angle = 2 * Math.PI * k / n + random() * 0.5 * Math.PI / n;
				const radius = 5 + random() * 45;
				ring.push( radius * Math.cos( angle ), radius * Math.sin( angle ) );

			}

			cases.push( ring );

		}

		for ( let i = 0; i < 50; i ++ ) {

			// a staircase: up the steps along the diagonal, back along the axes
			const steps = 2 + Math.floor( random() * 6 );
			const ring = [ 0, 0 ];
			let x = 0, y = 0;
			for ( let s = 0; s < steps; s ++ ) {

				x += 2 + Math.floor( random() * 8 );
				ring.push( x, y );
				y += 2 + Math.floor( random() * 8 );
				ring.push( x, y );

			}

			ring.push( 0, y );
			cases.push( ring );

		}

		let ok = 0;
		for ( const ring of cases ) {

			const result = straightSkeleton( [ ring ] );
			if ( result === null ) continue;
			ok ++;
			const expected = Math.abs( ringArea( toPoints( ring ) ) );
			expect( Math.abs( facesArea( result.faces ) - expected ) / expected ).toBeLessThan( 0.005 );
			for ( const t of times( result.faces ) ) expect( Number.isFinite( t ) && t >= 0 ).toBe( true );

		}

		expect( ok / cases.length ).toBeGreaterThanOrEqual( 0.99 );

	} );

	it( 'cleans degenerate input and refuses what is not a polygon', () => {

		// duplicates and collinear points go, the square stays a square
		const dirty = [ [ 0, 0, 0, 0, 5, 0, 10, 0, 10, 0.0000001, 10, 10, 5, 10, 0, 10, 0, 5, 0, 0 ] ];
		const result = straightSkeleton( dirty );
		expect( result ).not.toBeNull();
		expect( result.faces.length ).toBe( 4 );
		expect( near( result.maxTime, 5 ) ).toBe( true );

		expect( straightSkeleton( [ [ 0, 0, 10, 0 ] ] ) ).toBeNull();
		expect( straightSkeleton( [ [ 0, 0, 10, 0, 10, 0, 10, 0 ] ] ) ).toBeNull();
		expect( straightSkeleton( [ [ 0, 0, 10, 0, 20, 0 ] ] ) ).toBeNull(); // no area
		expect( straightSkeleton( [] ) ).toBeNull();
		expect( straightSkeleton( [ [ 0, 0, 10, 0, 5, 5, 10, 10, 0, 10, 5, 5 ] ] ) ).toBeNull(); // a bow tie, touching itself at (5, 5)
		expect( straightSkeleton( [ [ 0, 0, 30, 0, 30, 30, 0, 30 ], [ 0, 0, 10, 20, 20, 20 ] ] ) ).toBeNull(); // hole touches the exterior

	} );

} );
