import { describe, expect, it } from 'vitest';
import { XYZTileSource, createOSMSource } from '../src/core/XYZTileSource.js';

describe( 'XYZTileSource', () => {

	it( 'requires a url template', () => {

		expect( () => new XYZTileSource() ).toThrow( /url/ );

	} );

	it( 'substitutes tile coordinates into the template', () => {

		const source = new XYZTileSource( { url: 'https://example.com/{z}/{x}/{y}.png' } );
		expect( source.tileUrl( 66544, 45115, 17 ) ).toBe( 'https://example.com/17/66544/45115.png' );

	} );

	it( 'rotates subdomains deterministically per tile', () => {

		const source = new XYZTileSource( {
			url: 'https://{s}.example.com/{z}/{x}/{y}.png',
			subdomains: [ 'a', 'b', 'c' ],
		} );
		expect( source.tileUrl( 0, 0, 1 ) ).toContain( '://a.' );
		expect( source.tileUrl( 1, 0, 1 ) ).toContain( '://b.' );
		expect( source.tileUrl( 1, 1, 1 ) ).toContain( '://c.' );
		expect( source.tileUrl( 0, 0, 1 ) ).toBe( source.tileUrl( 0, 0, 1 ) );

	} );

	it( 'creates an OSM source with attribution and policy-compliant zoom range', () => {

		const source = createOSMSource();
		expect( source.tileUrl( 0, 0, 0 ) ).toBe( 'https://tile.openstreetmap.org/0/0/0.png' );
		expect( source.attribution ).toContain( 'OpenStreetMap' );
		expect( source.maxZoom ).toBe( 19 );

	} );

} );
