import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { Places } from '../src/game/Places.js';

const { layers } = JSON.parse( readFileSync( new URL( '../demo/data/saint-lazare.json', import.meta.url ) ) );
const places = new Places( layers );

describe( 'Places', () => {

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
