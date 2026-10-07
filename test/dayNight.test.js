import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { DayNight } from '../demo/day-night.js';

describe( 'DayNight', () => {

	it( 'lights the day from the sun and dims to a night, the colours following', () => {

		const root = new Group();
		const day = new DayNight( root, { latitude: 48.8566, longitude: 2.3522 } );
		expect( root.children ).toContain( day.sky );
		day.setTime( new Date( '2026-06-21T12:00:00Z' ) );
		expect( day.daylight ).toBe( 1 );
		expect( day.sun.intensity ).toBeGreaterThanOrEqual( 2 );
		expect( day.direction.y ).toBeGreaterThan( 0.85 ); // high in the sky
		expect( day.direction.z ).toBeGreaterThan( 0 ); // to the south (+z)
		const noonFog = day.fogColor.clone();
		day.setTime( new Date( '2026-06-21T23:00:00Z' ) );
		expect( day.daylight ).toBe( 0 );
		expect( day.sun.visible ).toBe( false );
		expect( day.hemisphere.intensity ).toBeLessThan( 0.8 );
		// underground: no sun, no sky, and the station's own light on
		day.underground( 1 );
		expect( day.sun.intensity ).toBe( 0 );
		expect( day.sky.visible ).toBe( false );
		expect( day.hemisphere.intensity ).toBeGreaterThan( 1.5 );
		day.underground( 0 );
		expect( day.sky.visible ).toBe( true );
		expect( day.fogColor.getHex() ).toBeLessThan( noonFog.getHex() ); // darker
		// the sun's shadow box follows the character
		day.follow( { x: 100, y: 0, z: - 50 } );
		expect( day.sun.target.position.x ).toBe( 100 );
		expect( day.sky.position.z ).toBe( - 50 );
		expect( day.sun.castShadow ).toBe( true );

	} );

} );
