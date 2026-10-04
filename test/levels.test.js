import { describe, expect, it } from 'vitest';
import { levelsOf, parseLevels } from '../src/indoor/levels.js';

describe( 'parseLevels', () => {

	// indoorequal's level_to_array_test.sql (BSD), cases and expectations as there
	it( 'passes indoorequal\'s cases', () => {

		expect( parseLevels( '1' ) ).toEqual( [ 1 ] );
		expect( parseLevels( '1,2' ) ).toBeNull(); // a comma is not a separator
		expect( parseLevels( 'HELLO' ) ).toBeNull();
		expect( parseLevels( '1.5' ) ).toEqual( [ 1.5 ] );
		expect( parseLevels( '-1' ) ).toEqual( [ - 1 ] );
		expect( parseLevels( '1;2' ) ).toEqual( [ 1, 2 ] );
		expect( parseLevels( '1.5;2.5' ) ).toEqual( [ 1.5, 2.5 ] );
		expect( parseLevels( '1-3' ) ).toEqual( [ 1, 2, 3 ] );
		expect( parseLevels( '-3--1' ) ).toEqual( [ - 3, - 2, - 1 ] );
		expect( parseLevels( '1-3;5' ) ).toEqual( [ 1, 2, 3, 5 ] );
		expect( parseLevels( '-1-3;5' ) ).toEqual( [ - 1, 0, 1, 2, 3, 5 ] );

	} );

	// OSM2World's ValueParseUtilTest (MIT), minus its rejection of decimals
	it( 'passes OSM2World\'s cases, decimals excepted', () => {

		expect( parseLevels( '-5' ) ).toEqual( [ - 5 ] );
		expect( parseLevels( '13 - 14' ) ).toEqual( [ 13, 14 ] );
		expect( parseLevels( '-1-3' ) ).toEqual( [ - 1, 0, 1, 2, 3 ] );
		expect( parseLevels( '-4--3' ) ).toEqual( [ - 4, - 3 ] );
		expect( parseLevels( '6;5 ; 7' ) ).toEqual( [ 5, 6, 7 ] );
		expect( parseLevels( ' -3; 0-2 ;3' ) ).toEqual( [ - 3, 0, 1, 2, 3 ] );
		expect( parseLevels( '3-1' ) ).toEqual( [ 1, 2, 3 ] );
		expect( parseLevels( '0--1' ) ).toEqual( [ - 1, 0 ] );
		expect( parseLevels( '-2-2; -1' ) ).toEqual( [ - 2, - 1, 0, 1, 2 ] );
		expect( parseLevels( '0-2;1-4' ) ).toEqual( [ 0, 1, 2, 3, 4 ] );
		expect( parseLevels( null ) ).toBeNull();
		expect( parseLevels( undefined ) ).toBeNull();
		expect( parseLevels( 'ground floor' ) ).toBeNull();
		// OSM2World returns null here; the Paris stations use these values
		expect( parseLevels( '5.5' ) ).toEqual( [ 5.5 ] );

	} );

	it( 'reads what the Paris stations actually carry', () => {

		expect( parseLevels( '-3.5;-3' ) ).toEqual( [ - 3.5, - 3 ] ); // Chatelet-Les Halles
		expect( parseLevels( '-0.75' ) ).toEqual( [ - 0.75 ] );
		expect( parseLevels( '-7;-6;-5' ) ).toEqual( [ - 7, - 6, - 5 ] ); // Saint-Lazare
		expect( parseLevels( '0;-1' ) ).toEqual( [ - 1, 0 ] );
		expect( parseLevels( '-2-32' ) ).toHaveLength( 35 ); // Key:level's own example
		expect( parseLevels( '0-100000' ) ).toBeNull(); // a typo, not a tower

	} );

} );

describe( 'levelsOf', () => {

	it( 'unites level and repeat_on, and falls back to a building\'s min and max', () => {

		expect( levelsOf( { level: '0', repeat_on: '1-3' } ) ).toEqual( [ 0, 1, 2, 3 ] );
		expect( levelsOf( { repeat_on: '1;2' } ) ).toEqual( [ 1, 2 ] );
		expect( levelsOf( { level: '2;1' } ) ).toEqual( [ 1, 2 ] );
		expect( levelsOf( { building: 'yes', min_level: '-2', max_level: '1' } ) ).toEqual( [ - 2, - 1, 0, 1 ] );
		expect( levelsOf( { building: 'yes' } ) ).toBeNull();
		expect( levelsOf( { level: 'mezzanine' } ) ).toBeNull();

	} );

} );
