import { describe, expect, it } from 'vitest';
import { Color, SRGBColorSpace } from 'three';
import { createFog } from '../src/three/createFog.js';
import { Style } from '../src/style/Style.js';
import { STUB_STYLE } from '../demo/stub-style.js';

const hex = color => '#' + color.getHexString( SRGBColorSpace );

describe( 'createFog', () => {

	it( 'hazes the last stretch of the view distance', () => {

		const fog = createFog( new Style( STUB_STYLE ), { viewDistance: 1000 } );
		expect( fog.near ).toBe( 600 );
		expect( fog.far ).toBe( 1000 );

		const tight = createFog( new Style( STUB_STYLE ), { viewDistance: 1000, start: 0.2 } );
		expect( tight.near ).toBe( 200 );

		expect( () => createFog( new Style( STUB_STYLE ), { viewDistance: Infinity } ) ).toThrow( /meters/ );

	} );

	it( 'takes the colour from the style sky, then the background, then white', () => {

		const sky = new Style( { ...STUB_STYLE, sky: { 'fog-color': '#ff0000' } } );
		expect( hex( createFog( sky, { viewDistance: 500 } ).color ) ).toBe( '#ff0000' );

		// horizon-color stands in when there is no fog-color
		const horizon = new Style( { ...STUB_STYLE, sky: { 'horizon-color': '#00ff00' } } );
		expect( hex( createFog( horizon, { viewDistance: 500 } ).color ) ).toBe( '#00ff00' );

		// no sky: the background layer is what fills the frame anyway
		const background = new Style( STUB_STYLE ).backgroundLayer;
		expect( background ).not.toBeNull();
		const [ r, g, b ] = background.get( 'background-color', 14 ).rgb;
		expect( hex( createFog( new Style( STUB_STYLE ), { viewDistance: 500 } ).color ) )
			.toBe( hex( new Color().setRGB( r, g, b, SRGBColorSpace ) ) );

		// and an explicit colour wins over all of it
		expect( hex( createFog( sky, { viewDistance: 500, color: 0x0000ff } ).color ) ).toBe( '#0000ff' );

	} );

	it( 'works without a style at all', () => {

		expect( hex( createFog( null, { viewDistance: 300 } ).color ) ).toBe( '#ffffff' );

	} );

} );
