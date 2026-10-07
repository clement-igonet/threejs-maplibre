import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { Places } from '../src/game/Places.js';

const { layers } = JSON.parse( readFileSync( new URL( '../demo/data/saint-lazare.json', import.meta.url ) ) );
const places = new Places( layers );

describe( 'Places', () => {

	it( 'routes from the walk demo\'s start to its goal, at both places', () => {

		// the demo's goals (demo/walk.html): a platform deep under each
		// station, routed from the spot 8 m outside the entrance it starts at
		const walks = [
			{ data: 'saint-lazare', start: [ 2.324587, 48.875896 ], goal: [ 'Métro 13: Châtillon-Montrouge', - 4 ] },
			// Porte Lescot: the Lego store's own door, nearer the old start, joins no corridor in the data
			{ data: 'chatelet', start: [ 2.347777, 48.861695 ], goal: [ 'Quai 1', - 5 ] },
		];
		for ( const { data, start, goal } of walks ) {

			const p = data === 'saint-lazare' ? places : new Places( JSON.parse( readFileSync( new URL( `../demo/data/${ data }.json`, import.meta.url ) ) ).layers );
			const g = p.graph;
			const target = g.nodes.find( n => n.kind === 'space' && n.name === goal[ 0 ] && n.level === goal[ 1 ] );
			expect( target, `${ data }: ${ goal[ 0 ] }` ).toBeTruthy();
			const from = g.toMeters( start[ 0 ], start[ 1 ] );
			const route = g.route( { x: from.x, y: from.y, level: 0 }, { x: target.x, y: target.y, level: target.level } );
			expect( route, `${ data }: a route` ).not.toBeNull();
			expect( route.path[ route.path.length - 1 ].level ).toBe( goal[ 1 ] );
			expect( route.seconds ).toBeGreaterThan( 120 );
			expect( route.seconds ).toBeLessThan( 600 );
			// standing at the goal's centre is being there
			const { lon, lat } = g.toLonLat( target.x, target.y );
			expect( p.where( lon, lat, goal[ 1 ] ).space ).toBe( goal[ 0 ] );

		}

	} );

	it( 'names the space a character stands in, with its building', () => {

		// Sephora, on level -1 of the station's mall
		const sephora = places.graph.findSpace( 'Sephora', - 1 );
		const { lon, lat } = places.graph.toLonLat( sephora.x, sephora.y );
		const w = places.where( lon, lat, - 1 );
		expect( w.indoor ).toBe( true );
		expect( w.space ).toBe( 'Sephora' );
		expect( w.level ).toBe( - 1 );

	} );

	it( 'names the street outdoors, and nothing indoors at a level with no space there', () => {

		// in the middle of a named street of the extract
		const way = layers.transportation.features.find( f => f.properties.name && f.properties.class !== 'path' && f.geometry.type === 'LineString' && ! f.properties.level && f.geometry.coordinates.length >= 2 );
		const [ a, b ] = way.geometry.coordinates;
		const w = places.where( ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2, 0 );
		expect( w.indoor ).toBe( false );
		expect( w.street ).toBe( way.properties.name );

	} );

	it( 'lists the names around, on the character\'s level only, nearest first', () => {

		const sephora = places.graph.findSpace( 'Sephora', - 1 );
		const { lon, lat } = places.graph.toLonLat( sephora.x, sephora.y );
		const around = places.nearby( lon, lat, - 1, 35, 12 );
		expect( around.length ).toBeGreaterThan( 2 );
		expect( around[ 0 ].text ).toBe( 'Sephora' );
		for ( const l of around ) expect( l.level ).toBe( - 1 );
		for ( let i = 1; i < around.length; i ++ ) expect( around[ i ].distance ).toBeGreaterThanOrEqual( around[ i - 1 ].distance );
		// level 0 above has its own names
		expect( places.nearby( lon, lat, 0, 35, 12 ).every( l => l.level === 0 ) ).toBe( true );

	} );

} );
