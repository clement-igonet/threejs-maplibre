import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { appendRoofedExtrusion, hasWalls, roofColours, roofFromTags } from '../src/build/buildRoofs.js';

const FIXTURES = JSON.parse( readFileSync( new URL( './fixtures/footprints.json', import.meta.url ) ) );

// tile space straight to a y-up world: x east, z south, 1 unit a meter
const projection = { project( x, y, h, out, o = 0 ) { out[ o ] = x; out[ o + 1 ] = h; out[ o + 2 ] = y; return out; } };
const WALL = [ 200, 200, 200, 255 ], ROOF = [ 100, 50, 50, 255 ];
const colours = { wall: WALL, roof: ROOF, glass: false };
const newOut = () => ( { positions: [], colors: [], indices: [], vertexCount: 0 } );
// a 20 x 10 rectangle, clockwise in tile space (y down), centred on (10, 5)
const RECT = [ [ 0, 0, 20, 0, 20, 10, 0, 10 ] ];
const tops = out => { const ys = []; for ( let i = 1; i < out.positions.length; i += 3 ) ys.push( out.positions[ i ] ); return ys; };
const at = ( out, height ) => { const pts = []; for ( let i = 0; i < out.positions.length; i += 3 ) if ( Math.abs( out.positions[ i + 1 ] - height ) < 1e-9 ) pts.push( [ out.positions[ i ], out.positions[ i + 2 ] ] ); return pts; };

describe( 'roofFromTags', () => {

	it( 'reads shape, height, levels, direction and orientation', () => {

		expect( roofFromTags( { 'roof:shape': 'pyramidal', 'roof:height': '21.65' }, 21.65 ) ).toMatchObject( { shape: 'pyramidal', height: 21.65, angle: null, direction: null, orientation: 'along' } );
		expect( roofFromTags( { 'roof:shape': 'gabled', 'roof:levels': '2', 'roof:direction': 'NE', 'roof:orientation': 'across' }, 20 ) ).toMatchObject( { shape: 'gabled', height: 5, direction: 45, tolerance: 45, orientation: 'across' } );
		expect( roofFromTags( { 'roof:shape': 'skillion', 'roof:direction': '298' }, 20 ) ).toMatchObject( { direction: 298, tolerance: 10 } );
		expect( roofFromTags( { 'roof:shape': 'skillion', 'roof:direction': '297.5' }, 20 ).tolerance ).toBe( 0.5 );
		expect( roofFromTags( { 'roof:shape': 'gabled', 'roof:angle': '30' }, 20 ) ).toMatchObject( { height: null, angle: 30 } );
		expect( roofFromTags( { 'roof:shape': 'hipped' }, 20 ).height ).toBeNull(); // the default, in appendRoofedExtrusion
		expect( roofFromTags( { 'roof:shape': 'flat' }, 20 ) ).toBeNull();
		expect( roofFromTags( { 'roof:shape': 'many' }, 20 ) ).toBeNull();
		expect( roofFromTags( {}, 20 ) ).toBeNull();
		// a roof taller than the building is the building
		expect( roofFromTags( { 'roof:shape': 'dome', 'roof:height': '50' }, 20 ).height ).toBe( 20 );
		// a building that is all roof, said the other way round
		expect( roofFromTags( { building: 'pyramid' }, 30 ) ).toMatchObject( { shape: 'pyramidal', height: 30 } );
		expect( roofFromTags( { 'building:shape': 'dome' }, 12 ) ).toMatchObject( { shape: 'dome', height: 12 } );
		expect( roofFromTags( { 'building:shape': 'cylinder' }, 12 ) ).toBeNull(); // a footprint, not a roof
		expect( roofFromTags( { 'building:shape': 'pyramid', 'roof:shape': 'flat' }, 12 ) ).toBeNull(); // roof:shape wins

	} );

	it( 'colours walls and roofs from the tags, and makes glass translucent', () => {

		const plain = roofColours( {}, WALL );
		expect( plain ).toEqual( { wall: WALL, roof: WALL, glass: false } );
		const painted = roofColours( { 'building:colour': 'white', 'roof:colour': '#2A2E52' }, WALL );
		expect( painted.wall ).toEqual( [ 255, 255, 255, 255 ] );
		expect( painted.roof[ 2 ] ).toBeGreaterThan( painted.roof[ 0 ] ); // bluish, in linear light
		expect( painted.glass ).toBe( false );
		const pyramid = roofColours( { 'building:material': 'glass', 'roof:material': 'glass' }, WALL );
		expect( pyramid.glass ).toBe( true );
		expect( pyramid.wall[ 3 ] ).toBeLessThan( 255 );
		const glassRoof = roofColours( { 'roof:material': 'glass', 'building:colour': 'beige' }, WALL );
		expect( glassRoof.wall[ 3 ] ).toBe( 255 ); // stone walls stay
		expect( glassRoof.roof[ 3 ] ).toBeLessThan( 255 );

	} );

} );

describe( 'appendRoofedExtrusion', () => {

	it( 'draws a pyramid: walls to the eave, four faces to one apex over the centroid', () => {

		const out = newOut();
		const triangles = appendRoofedExtrusion( out, RECT, projection, colours, 0, 21.65, { shape: 'pyramidal', height: 21.65, direction: null, orientation: 'along' }, 1 );
		expect( triangles ).toBe( 8 + 4 ); // 4 wall quads of height 0, then 4 roof faces
		const apex = at( out, 21.65 );
		expect( apex.length ).toBe( 4 ); // one apex vertex per face
		for ( const [ x, z ] of apex ) { expect( x ).toBeCloseTo( 10, 9 ); expect( z ).toBeCloseTo( 5, 9 ); }
		expect( Math.max( ...tops( out ) ) ).toBeCloseTo( 21.65, 9 );
		// the roof is roof-coloured, the walls wall-coloured
		expect( out.colors.slice( 0, 4 ) ).toEqual( WALL );
		expect( out.colors.slice( - 4 ) ).toEqual( ROOF );

	} );

	it( 'draws a gable with the ridge along the long axis out to the end walls', () => {

		const out = newOut();
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, { shape: 'gabled', height: 5, direction: null, orientation: 'along' }, 1 );
		const ridge = at( out, 15 );
		const xs = ridge.map( p => p[ 0 ] ), zs = ridge.map( p => p[ 1 ] );
		expect( Math.min( ...xs ) ).toBeCloseTo( 0, 9 ); // the ridge reaches both ends
		expect( Math.max( ...xs ) ).toBeCloseTo( 20, 9 );
		for ( const z of zs ) expect( z ).toBeCloseTo( 5, 9 ); // and runs down the middle
		expect( Math.min( ...tops( out ).filter( y => y > 0 ) ) ).toBeCloseTo( 10, 9 ); // the eave

	} );

	it( 'draws a hip with the ridge shortened by the half-width, and across on request', () => {

		const out = newOut();
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, { shape: 'hipped', height: 5, direction: null, orientation: 'along' }, 1 );
		const xs = at( out, 15 ).map( p => p[ 0 ] );
		expect( Math.min( ...xs ) ).toBeCloseTo( 5, 9 ); // 10 - (10 - 5)
		expect( Math.max( ...xs ) ).toBeCloseTo( 15, 9 );

		const across = newOut();
		appendRoofedExtrusion( across, RECT, projection, colours, 0, 15, { shape: 'gabled', height: 5, direction: null, orientation: 'across' }, 1 );
		const zs = at( across, 15 ).map( p => p[ 1 ] );
		expect( Math.min( ...zs ) ).toBeCloseTo( 0, 9 );
		expect( Math.max( ...zs ) ).toBeCloseTo( 10, 9 );

	} );

	it( 'slopes a skillion down towards roof:direction, walls following', () => {

		const out = newOut();
		// down towards the east (90): the west wall is at the top, the east at the eave
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 12, { shape: 'skillion', height: 4, direction: 90, orientation: 'along' }, 1 );
		const west = at( out, 12 ), east = at( out, 8 );
		expect( west.length ).toBeGreaterThan( 0 );
		for ( const [ x ] of west ) expect( x ).toBeCloseTo( 0, 9 );
		expect( east.length ).toBeGreaterThan( 0 );
		for ( const [ x ] of east ) expect( x ).toBeCloseTo( 20, 9 );

	} );

	it( 'rounds a dome off at the top over the centroid', () => {

		const out = newOut();
		const triangles = appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, { shape: 'dome', height: 5, direction: null, orientation: 'along' }, 1 );
		expect( triangles ).toBe( 8 + 4 * ( 2 * 5 + 1 ) ); // 6 rings of 4 edges, the last one triangles
		for ( const [ x, z ] of at( out, 15 ) ) { expect( x ).toBeCloseTo( 10, 9 ); expect( z ).toBeCloseTo( 5, 9 ); }

	} );

	it( 'sizes an untagged roof as OSM2World does: the angle over the half-width, a dome\'s radius, else 5 m', () => {

		const roof = ( shape, extra = {} ) => ( { shape, height: null, angle: null, direction: null, orientation: 'along', ...extra } );
		const eave = out => Math.min( ...tops( out ).filter( y => y > 0 ) );
		// two tile units a meter: the rectangle is 10 x 5 m, the half-width 2.5 m
		let out = newOut();
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, roof( 'gabled', { angle: 45 } ), 2 );
		expect( eave( out ) ).toBeCloseTo( 12.5, 9 );
		out = newOut();
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, roof( 'dome' ), 2 );
		expect( eave( out ) ).toBeCloseTo( 12.5, 9 );
		out = newOut();
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, roof( 'hipped' ), 2 );
		expect( eave( out ) ).toBeCloseTo( 10, 9 );
		out = newOut(); // a 3 m building cannot hold a 5 m roof
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 3, roof( 'hipped' ), 2 );
		expect( Math.min( ...tops( out ) ) ).toBe( 0 );
		expect( Math.max( ...tops( out ) ) ).toBeCloseTo( 3, 9 );

	} );

	it( 'snaps a rough roof:direction to the nearest wall, and keeps a measured one', () => {

		// the rectangle's walls run east-west and north-south; 'NE' (45, within 45) snaps to a wall
		const ridge = out => at( out, 15 ).map( p => p[ 0 ] );
		let out = newOut();
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, { shape: 'gabled', height: 5, angle: null, direction: 80, tolerance: 10, orientation: 'along' }, 1 );
		// 80 snaps to 90 (east): the slopes face east and west, the ridge runs north-south
		expect( Math.max( ...ridge( out ) ) - Math.min( ...ridge( out ) ) ).toBeCloseTo( 0, 9 );
		out = newOut();
		appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, { shape: 'gabled', height: 5, angle: null, direction: 80.0, tolerance: 0.5, orientation: 'along' }, 1 );
		expect( Math.max( ...ridge( out ) ) - Math.min( ...ridge( out ) ) ).toBeGreaterThan( 1 ); // kept oblique

	} );

	describe( 'from the straight skeleton', () => {

		const roof = ( shape, height = 5 ) => ( { shape, height, angle: null, direction: null, orientation: 'along' } );
		// an L: a 20 x 20 square missing the 10 x 10 corner at x > 10, z < 10,
		// so a wing along x = 0..10 and a wing along z = 10..20, both 10 wide
		const L = [ [ 0, 0, 10, 0, 10, 10, 20, 10, 20, 20, 0, 20 ] ];

		it( 'hips an L-shaped footprint: every roof vertex between eave and top, the top reached', () => {

			const out = newOut();
			const triangles = appendRoofedExtrusion( out, L, projection, colours, 0, 15, roof( 'hipped' ), 1 );
			expect( triangles ).toBeGreaterThan( 12 + 6 );
			const ys = tops( out ).filter( y => y > 0 );
			expect( Math.min( ...ys ) ).toBeCloseTo( 10, 9 );
			expect( Math.max( ...ys ) ).toBeCloseTo( 15, 9 );
			// the ridges run down the middle of each wing: x = 5 or z = 15
			const top = at( out, 15 );
			expect( top.length ).toBeGreaterThan( 0 );
			for ( const [ x, z ] of top ) expect( Math.min( Math.abs( x - 5 ), Math.abs( z - 15 ) ) ).toBeLessThan( 1e-6 );

		} );

		it( 'gables an L: the ridge ends stand on the end walls', () => {

			const out = newOut();
			appendRoofedExtrusion( out, L, projection, colours, 0, 15, roof( 'gabled' ), 1 );
			const top = at( out, 15 );
			// a ridge end on the east wall of the north wing (x = 20) and on the south wall of the west wing (z = 0)
			expect( top.some( ( [ x ] ) => Math.abs( x - 20 ) < 1e-6 ) ).toBe( true );
			expect( top.some( ( [ , z ] ) => Math.abs( z ) < 1e-6 ) ).toBe( true );

		} );

		it( 'cuts a mansard where the slope changes, three quarters of the way up', () => {

			const out = newOut();
			appendRoofedExtrusion( out, RECT, projection, colours, 0, 14, roof( 'mansard', 4 ), 1 );
			const ys = tops( out ).filter( y => y > 10 && y < 14 );
			expect( ys.length ).toBeGreaterThan( 0 );
			for ( const y of ys ) expect( y ).toBeCloseTo( 13, 9 ); // 10 + 0.75 * 4

		} );

		it( 'roofs the real footprints of the extract', () => {

			for ( const key of [ 'marsan', 'barreau', 'chatelet', 'bourse', 'marly' ] ) {

				const f = FIXTURES[ key ];
				const ring = f.meters.flatMap( ( [ x, y ] ) => [ x, - y ] ); // y down, as tile space
				const out = newOut();
				const shape = f.tags[ 'roof:shape' ];
				const triangles = appendRoofedExtrusion( out, [ ring ], projection, colours, 0, 20, roof( shape, 6 ), 1 );
				expect( triangles ).toBeGreaterThan( ring.length ); // more than the walls alone
				const ys = tops( out );
				expect( Math.max( ...ys ) ).toBeCloseTo( 20, 6 );
				expect( Math.min( ...ys.filter( y => y > 0 ) ) ).toBeCloseTo( 14, 6 );
				for ( const y of ys ) expect( Number.isFinite( y ) ).toBe( true );

			}

		} );

		it( 'draws no walls for a building=roof', () => {

			expect( hasWalls( { building: 'roof' } ) ).toBe( false );
			expect( hasWalls( { 'building:part': 'yes', wall: 'no' } ) ).toBe( false );
			expect( hasWalls( { building: 'yes' } ) ).toBe( true );
			const out = newOut();
			appendRoofedExtrusion( out, RECT, projection, colours, 0, 15, { ...roof( 'hipped' ), walls: false }, 1 );
			expect( Math.min( ...tops( out ) ) ).toBeCloseTo( 10, 9 ); // nothing below the eave

		} );

	} );

} );
