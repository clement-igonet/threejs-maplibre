import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { IndoorGraph, pointInPolygon, pointToSegment, ringCentroid } from '../src/indoor/IndoorGraph.js';

// Gare Saint-Lazare, the committed extract
const { layers } = JSON.parse( readFileSync( new URL( '../demo/data/saint-lazare.json', import.meta.url ) ) );
const graph = IndoorGraph.fromLayers( layers );

// two rooms side by side on level 0, a wall between them, a door on it or not
function twoRooms( withDoor ) {

	const room = ( id, name, lon0, lon1 ) => ( { type: 'Feature', id, geometry: { type: 'Polygon', coordinates: [ [ [ lon0, 0 ], [ lon1, 0 ], [ lon1, 0.0001 ], [ lon0, 0.0001 ], [ lon0, 0 ] ] ] }, properties: { class: 'room', name, levels: '0' } } );
	const features = [ room( 1, 'left', 0, 0.0001 ), room( 2, 'right', 0.0001, 0.0002 ) ];
	if ( withDoor ) features.push( { type: 'Feature', id: 3, geometry: { type: 'Point', coordinates: [ 0.0001, 0.00005 ] }, properties: { class: 'door', levels: '0' } } );
	return IndoorGraph.fromLayers( { indoor: { type: 'FeatureCollection', features }, transportation: { type: 'FeatureCollection', features: [] } } );

}

// the level changes along a path, each between the two ends of one staircase or the stops of one lift
function climbs( route ) {

	let count = 0;
	for ( let i = 1; i < route.path.length; i ++ ) {

		const a = route.path[ i - 1 ], b = route.path[ i ];
		if ( a.level === b.level ) continue;
		count ++;
		expect( [ 'stair', 'lift' ] ).toContain( a.kind );
		expect( [ 'stair', 'lift' ] ).toContain( b.kind );
		expect( a.id.split( ':' )[ 1 ] ).toBe( b.id.split( ':' )[ 1 ] );

	}

	return count;

}

describe( 'IndoorGraph geometry', () => {

	it( 'finds a point in a polygon, holes excepted', () => {

		const square = [ 0, 0, 10, 0, 10, 10, 0, 10 ];
		const hole = [ 4, 4, 6, 4, 6, 6, 4, 6 ];
		expect( pointInPolygon( 1, 1, [ square ] ) ).toBe( true );
		expect( pointInPolygon( 11, 1, [ square ] ) ).toBe( false );
		expect( pointInPolygon( 5, 5, [ square ] ) ).toBe( true );
		expect( pointInPolygon( 5, 5, [ square, hole ] ) ).toBe( false );
		expect( ringCentroid( square ) ).toEqual( [ 5, 5 ] );
		expect( pointToSegment( 5, 3, 0, 0, 10, 0 ) ).toBe( 3 );
		expect( pointToSegment( 13, 4, 0, 0, 10, 0 ) ).toBe( 5 );

	} );

	it( 'round trips meters and degrees', () => {

		const { x, y } = graph.toMeters( 2.3253, 48.8762 );
		const { lon, lat } = graph.toLonLat( x, y );
		expect( lon ).toBeCloseTo( 2.3253, 9 );
		expect( lat ).toBeCloseTo( 48.8762, 9 );
		const east = graph.toMeters( graph.origin.lon + 0.001, graph.origin.lat );
		expect( east.x ).toBeCloseTo( 111.32 * Math.cos( graph.origin.lat * Math.PI / 180 ), 3 );
		expect( east.y ).toBeCloseTo( 0, 9 );

	} );

} );

describe( 'IndoorGraph on two rooms', () => {

	it( 'joins them through the door on their wall, not without it', () => {

		const joined = twoRooms( true );
		expect( joined.stats ).toMatchObject( { spaces: 2, doors: 1, edges: 2, levels: 1 } );
		const left = joined.findSpace( 'left' ), right = joined.findSpace( 'right' );
		const route = joined.route( left, right );
		expect( route ).not.toBeNull();
		expect( route.path.length ).toBe( 3 );
		expect( route.path[ 1 ].kind ).toBe( 'door' );
		expect( route.seconds ).toBeGreaterThan( 0 );
		expect( route.seconds ).toBeCloseTo( 11.132 / 1.4, 1 );

		const apart = twoRooms( false );
		expect( apart.stats ).toMatchObject( { spaces: 2, doors: 0, edges: 0, isolated: 2 } );
		expect( apart.route( apart.findSpace( 'left' ), apart.findSpace( 'right' ) ) ).toBeNull();

	} );

} );

describe( 'IndoorGraph on Gare Saint-Lazare', () => {

	it( 'builds the station', () => {

		expect( graph.stats.spaces ).toBeGreaterThan( 350 );
		expect( graph.stats.doors ).toBeGreaterThan( 200 );
		expect( graph.stats.stairs ).toBeGreaterThan( 150 );
		expect( graph.stats.lifts ).toBe( 6 );
		expect( graph.stats.edges ).toBeGreaterThan( 500 );
		expect( graph.stats.stairsWithoutLevels ).toBe( 18 );
		expect( graph.stats.isolated ).toBeLessThan( 60 ); // shops with no door mapped, mostly
		expect( graph.levels ).toContain( 0 );
		expect( graph.levels ).toContain( - 1 );
		for ( const n of graph.nodes ) {

			expect( [ 'space', 'door', 'stair', 'lift' ] ).toContain( n.kind );
			expect( Number.isFinite( n.x ) && Number.isFinite( n.y ) && Number.isFinite( n.level ) ).toBe( true );

		}

	} );

	it( 'finds a space by name, exact then loosely', () => {

		const sephora = graph.findSpace( 'sephora' );
		expect( sephora ).not.toBeNull();
		expect( sephora.name ).toBe( 'Sephora' );
		expect( sephora.level ).toBe( - 1 ); // the lowest of the two Sephoras first
		expect( graph.findSpace( 'Sephora', 0 ).level ).toBe( 0 );
		expect( graph.findSpace( 'pas perdus' ).name ).toBe( 'Salle des Pas Perdus' );
		expect( graph.findSpace( 'no such shop' ) ).toBeNull();
		expect( graph.spaceAt( sephora.x, sephora.y, - 1 ) ).toBe( sephora );

	} );

	it( 'reaches the station\'s shops from the Salle des Pas Perdus, not the Passage du Havre\'s', () => {

		const hall = graph.findSpace( 'Salle des Pas Perdus' );
		expect( hall.level ).toBe( - 2 );
		const reached = graph.reachableFrom( hall.id );
		const namedOn = level => graph.nodes.filter( n => n.kind === 'space' && n.level === level && n.name && reached.has( n.id ) ).map( n => n.name );
		expect( namedOn( - 1 ).length ).toBeGreaterThanOrEqual( 30 );
		expect( namedOn( 0 ).length ).toBeGreaterThanOrEqual( 30 );
		expect( namedOn( 1 ).length ).toBeGreaterThanOrEqual( 25 );
		expect( namedOn( - 1 ) ).toContain( 'Sephora' );
		expect( namedOn( - 1 ) ).toContain( 'Centre commercial (niveau métro)' );
		expect( namedOn( 0 ) ).toContain( 'Ladurée' );
		expect( namedOn( 0 ) ).toContain( 'Restaurant Lazare' );
		expect( namedOn( 0 ) ).toContain( 'Centre commercial (niveau rue)' );
		expect( namedOn( 1 ) ).toContain( 'Centre commercial (niveau trains)' );
		// the Passage du Havre is another building, across the rue Saint-Lazare
		expect( reached.has( graph.findSpace( 'Fnac', 0 ).id ) ).toBe( false );
		expect( reached.has( graph.findSpace( 'Starbucks', - 1 ).id ) ).toBe( false );

	} );

	it( 'routes from Sephora on level -1 to Ladurée on level 0', () => {

		const from = graph.findSpace( 'Sephora', - 1 ), to = graph.findSpace( 'Ladurée', 0 );
		const route = graph.route( from, to );
		expect( route ).not.toBeNull();
		expect( route.seconds ).toBeGreaterThan( 0 );
		expect( route.path.length ).toBeGreaterThanOrEqual( 4 );
		const first = route.path[ 0 ], last = route.path[ route.path.length - 1 ];
		expect( first ).toMatchObject( { x: from.x, y: from.y, level: - 1, kind: 'start' } );
		expect( last ).toMatchObject( { x: to.x, y: to.y, level: 0, kind: 'end' } );
		expect( climbs( route ) ).toBe( 1 );
		// the same route in degrees
		const degrees = graph.route( { ...graph.toLonLat( from.x, from.y ), level: - 1 }, { ...graph.toLonLat( to.x, to.y ), level: 0 } );
		expect( degrees.seconds ).toBeCloseTo( route.seconds, 6 );
		// two levels up, through the street level
		const upstairs = graph.route( from, graph.findSpace( 'Paul', 1 ) );
		expect( upstairs ).not.toBeNull();
		expect( [ ...new Set( upstairs.path.map( p => p.level ) ) ] ).toEqual( [ - 1, 0, 1 ] );
		expect( climbs( upstairs ) ).toBe( 2 );
		expect( upstairs.seconds ).toBeGreaterThan( route.seconds );

	} );

	it( 'walks straight between two spaces open onto each other, through the door otherwise', () => {

		const space = id => graph.node( id );
		const open = graph.edges.find( e => e.kind === 'open' && graph.spaceAt( space( e.a ).x, space( e.a ).y, space( e.a ).level ) === space( e.a ) && graph.spaceAt( space( e.b ).x, space( e.b ).y, space( e.b ).level ) === space( e.b ) );
		expect( open ).toBeDefined();
		const direct = graph.route( space( open.a ), space( open.b ) );
		expect( direct.path.length ).toBe( 2 );
		expect( direct.seconds ).toBeCloseTo( Math.hypot( space( open.a ).x - space( open.b ).x, space( open.a ).y - space( open.b ).y ) / 1.4, 6 );

		// a door between two rooms that are not open onto each other
		const door = graph.nodes.find( n => n.kind === 'door' && graph.neighbours( n.id ).length === 2 && graph.neighbours( n.id ).every( e => {

			const s = space( e.to );
			return s.class === 'room' && graph.spaceAt( s.x, s.y, s.level ) === s && ! graph.neighbours( s.id ).some( f => f.to === ( e.to === graph.neighbours( n.id )[ 0 ].to ? graph.neighbours( n.id )[ 1 ].to : graph.neighbours( n.id )[ 0 ].to ) );

		} ) );
		expect( door ).toBeDefined();
		const [ a, b ] = graph.neighbours( door.id ).map( e => space( e.to ) );
		const through = graph.route( a, b );
		expect( through ).not.toBeNull();
		expect( through.path.length ).toBeGreaterThanOrEqual( 2 );
		expect( through.path.length ).toBeLessThanOrEqual( 3 );

	} );

	it( 'gives up on a point far outside', () => {

		const from = graph.findSpace( 'Sephora', - 1 );
		expect( graph.route( from, { x: from.x + 2000, y: from.y, level: 0 } ) ).toBeNull();
		expect( graph.route( { x: 2000, y: 2000, level: - 1 }, from ) ).toBeNull();
		expect( graph.route( from, { x: from.x, y: from.y, level: 42 } ) ).toBeNull();

	} );

} );
