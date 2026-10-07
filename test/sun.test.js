import { describe, expect, it } from 'vitest';
import { dateAtHour, sunPosition } from '../src/game/sun.js';

const DEG = 180 / Math.PI;
const PARIS = [ 48.8566, 2.3522 ];

describe( 'sun', () => {

	it( 'puts the summer solstice sun 64 degrees up over Paris at noon, due south', () => {

		// the sun's noon height at a latitude is 90 - latitude + declination;
		// on June 21 the declination is 23.44 degrees
		const { altitude, azimuth } = sunPosition( new Date( '2026-06-21T11:52:00Z' ), ...PARIS );
		expect( altitude * DEG ).toBeGreaterThan( 64 );
		expect( altitude * DEG ).toBeLessThan( 65 );
		expect( Math.abs( azimuth * DEG - 180 ) ).toBeLessThan( 3 );

	} );

	it( 'puts the equinox sun 41 degrees up, and the midnight sun well under the horizon', () => {

		const noon = sunPosition( new Date( '2026-03-20T11:52:00Z' ), ...PARIS );
		expect( Math.abs( noon.altitude * DEG - ( 90 - 48.8566 ) ) ).toBeLessThan( 1 );
		const midnight = sunPosition( new Date( '2026-06-21T00:00:00Z' ), ...PARIS );
		expect( midnight.altitude * DEG ).toBeLessThan( - 15 );
		// morning in the east, evening in the west
		expect( sunPosition( new Date( '2026-06-21T06:00:00Z' ), ...PARIS ).azimuth * DEG ).toBeLessThan( 120 );
		expect( sunPosition( new Date( '2026-06-21T17:00:00Z' ), ...PARIS ).azimuth * DEG ).toBeGreaterThan( 240 );

	} );

	it( 'turns a Paris wall-clock hour into UTC, daylight saving included', () => {

		// July: Paris is UTC+2; January: UTC+1
		expect( dateAtHour( 14, 'Europe/Paris', new Date( '2026-07-10T09:00:00Z' ) ).toISOString() ).toBe( '2026-07-10T12:00:00.000Z' );
		expect( dateAtHour( 14.5, 'Europe/Paris', new Date( '2026-01-10T09:00:00Z' ) ).toISOString() ).toBe( '2026-01-10T13:30:00.000Z' );

	} );

} );
