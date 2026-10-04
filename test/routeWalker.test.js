import { describe, expect, it } from 'vitest';
import { RouteWalker } from '../src/indoor/RouteWalker.js';

describe( 'RouteWalker', () => {

	// 14 m flat (10 s), a 6 m stair up one level, 7 m flat (5 s); the route
	// says 45 s in all, so the stair takes the other 30
	const route = { seconds: 45, path: [ { x: 0, y: 0, level: 0 }, { x: 14, y: 0, level: 0 }, { x: 14, y: 6, level: 1 }, { x: 21, y: 6, level: 1 } ] };

	it( 'walks the flat at walking speed and the stairs at the route\'s pace', () => {

		const w = new RouteWalker( route );
		expect( w.seconds ).toBe( 45 );
		expect( w.at( 5 ) ).toMatchObject( { x: 7, y: 0, level: 0, done: false } );
		expect( w.at( 5 ).heading ).toBeCloseTo( 0, 9 ); // east
		const mid = w.at( 25 ); // halfway up the stair
		expect( mid.x ).toBeCloseTo( 14, 9 );
		expect( mid.y ).toBeCloseTo( 3, 9 );
		expect( mid.level ).toBeCloseTo( 0.5, 9 );
		expect( mid.heading ).toBeCloseTo( Math.PI / 2, 9 ); // north
		expect( w.at( 42.5 ) ).toMatchObject( { x: 17.5, y: 6, level: 1 } );

	} );

	it( 'stops at the end', () => {

		const w = new RouteWalker( route );
		expect( w.at( 1000 ) ).toMatchObject( { x: 21, y: 6, level: 1, done: true } );
		const single = new RouteWalker( { seconds: 0, path: [ { x: 3, y: 4, level: 2 } ] } );
		expect( single.at( 0 ) ).toMatchObject( { x: 3, y: 4, level: 2, done: true } );

	} );

} );
