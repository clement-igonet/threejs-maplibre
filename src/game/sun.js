// Where the sun is, from a date and a place: altitude and azimuth, the
// NOAA solar position formulas (Jean Meeus, Astronomical Algorithms, as
// NOAA's solar calculator lays them out), good to a tenth of a degree
// for this century, which is what a sky and a shadow need.
//
//   sunPosition( date, latitude, longitude )
//     -> { altitude, azimuth }   radians; azimuth clockwise from north

const DEG = Math.PI / 180;

export function sunPosition( date, latitude, longitude ) {

	const ms = date.getTime();
	const jd = ms / 86400000 + 2440587.5; // Julian day, UTC
	const T = ( jd - 2451545 ) / 36525; // Julian centuries since J2000
	const L0 = ( ( 280.46646 + T * ( 36000.76983 + T * 0.0003032 ) ) % 360 + 360 ) % 360;
	const M = 357.52911 + T * ( 35999.05029 - 0.0001537 * T );
	const e = 0.016708634 - T * ( 0.000042037 + 0.0000001267 * T );
	const C = Math.sin( M * DEG ) * ( 1.914602 - T * ( 0.004817 + 0.000014 * T ) ) + Math.sin( 2 * M * DEG ) * ( 0.019993 - 0.000101 * T ) + Math.sin( 3 * M * DEG ) * 0.000289;
	const trueLongitude = L0 + C;
	const omega = 125.04 - 1934.136 * T;
	const lambda = trueLongitude - 0.00569 - 0.00478 * Math.sin( omega * DEG );
	const epsilon0 = 23 + ( 26 + ( 21.448 - T * ( 46.815 + T * ( 0.00059 - T * 0.001813 ) ) ) / 60 ) / 60;
	const epsilon = epsilon0 + 0.00256 * Math.cos( omega * DEG );
	const declination = Math.asin( Math.sin( epsilon * DEG ) * Math.sin( lambda * DEG ) );
	const y = Math.tan( epsilon / 2 * DEG ) ** 2;
	const equationOfTime = 4 / DEG * ( y * Math.sin( 2 * L0 * DEG ) - 2 * e * Math.sin( M * DEG ) + 4 * e * y * Math.sin( M * DEG ) * Math.cos( 2 * L0 * DEG ) - 0.5 * y * y * Math.sin( 4 * L0 * DEG ) - 1.25 * e * e * Math.sin( 2 * M * DEG ) ); // minutes
	const minutesUTC = ( ms / 60000 ) % 1440;
	const trueSolarTime = ( ( minutesUTC + equationOfTime + 4 * longitude ) % 1440 + 1440 ) % 1440;
	const hourAngle = trueSolarTime / 4 - 180; // degrees, negative before solar noon
	const phi = latitude * DEG, H = hourAngle * DEG;
	const sinAltitude = Math.sin( phi ) * Math.sin( declination ) + Math.cos( phi ) * Math.cos( declination ) * Math.cos( H );
	const altitude = Math.asin( Math.min( 1, Math.max( - 1, sinAltitude ) ) );
	// NOAA's azimuth: the angle from north through east, from the zenith
	// triangle, the branch by which side of noon the hour angle is on
	let cosAzimuth = ( Math.sin( phi ) * sinAltitude - Math.sin( declination ) ) / ( Math.cos( phi ) * Math.cos( altitude ) );
	cosAzimuth = Math.min( 1, Math.max( - 1, cosAzimuth ) );
	const a = Math.acos( cosAzimuth );
	const azimuth = hourAngle > 0 ? ( a + Math.PI ) % ( 2 * Math.PI ) : ( 3 * Math.PI - a ) % ( 2 * Math.PI );
	return { altitude, azimuth };

}

// A Date for a wall-clock hour in a time zone, today (or the date given):
// what "14:00 in Paris" is in UTC, daylight saving and all.
export function dateAtHour( hours, timeZone, day = new Date() ) {

	const parts = Object.fromEntries( new Intl.DateTimeFormat( 'en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false } ).formatToParts( day ).filter( p => p.type !== 'literal' ).map( p => [ p.type, parseInt( p.value, 10 ) ] ) );
	// the zone's offset now: the zone's wall clock against the UTC clock
	const wall = Date.UTC( parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second );
	const offset = wall - Math.floor( day.getTime() / 1000 ) * 1000; // ms east of UTC
	const h = Math.floor( hours ), m = Math.round( ( hours - h ) * 60 );
	return new Date( Date.UTC( parts.year, parts.month - 1, parts.day, h, m, 0 ) - offset );

}
