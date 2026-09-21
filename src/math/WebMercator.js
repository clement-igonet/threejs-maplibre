// Web Mercator (EPSG:3857) helpers over normalized tile space.
// Normalized coordinates (nx, ny) are in [0, 1] with (0, 0) at the north-west
// corner of the projection, matching XYZ tile addressing.

export const EARTH_RADIUS = 6378137;
export const MAX_LATITUDE = 85.05112877980659;

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function clampLatitude( lat ) {

	return Math.min( MAX_LATITUDE, Math.max( - MAX_LATITUDE, lat ) );

}

// longitude in degrees -> normalized x
export function longitudeToNormalized( lon ) {

	return ( lon + 180 ) / 360;

}

// latitude in degrees -> normalized y (0 at the north edge)
export function latitudeToNormalized( lat ) {

	const rad = clampLatitude( lat ) * DEG2RAD;
	return 0.5 - Math.log( Math.tan( Math.PI / 4 + rad / 2 ) ) / ( 2 * Math.PI );

}

export function normalizedToLongitude( nx ) {

	return nx * 360 - 180;

}

export function normalizedToLatitude( ny ) {

	return ( 2 * Math.atan( Math.exp( ( 0.5 - ny ) * 2 * Math.PI ) ) - Math.PI / 2 ) * RAD2DEG;

}

// XYZ tile of the point at the given zoom
export function pointToTile( lon, lat, z ) {

	const n = 1 << z;
	const x = Math.min( n - 1, Math.floor( longitudeToNormalized( lon ) * n ) );
	const y = Math.min( n - 1, Math.floor( latitudeToNormalized( lat ) * n ) );
	return [ x, y, z ];

}

// [west, south, east, north] bounds of a tile, in degrees
export function tileToBounds( x, y, z ) {

	const n = 1 << z;
	return [
		normalizedToLongitude( x / n ),
		normalizedToLatitude( ( y + 1 ) / n ),
		normalizedToLongitude( ( x + 1 ) / n ),
		normalizedToLatitude( y / n ),
	];

}

// ground size in meters of one texel of a tile texture at the given latitude
export function texelSizeMeters( z, latDeg, tileResolution = 256 ) {

	const groundSize = Math.cos( clampLatitude( latDeg ) * DEG2RAD ) * 2 * Math.PI * EARTH_RADIUS / ( 1 << z );
	return groundSize / tileResolution;

}

// planar mode: normalized coordinates -> mercator meters, x east, y north
export function normalizedToMeters( nx, ny ) {

	const s = 2 * Math.PI * EARTH_RADIUS;
	return [ ( nx - 0.5 ) * s, ( 0.5 - ny ) * s ];

}

export function metersToNormalized( mx, my ) {

	const s = 2 * Math.PI * EARTH_RADIUS;
	return [ mx / s + 0.5, 0.5 - my / s ];

}
