// Minimal WGS84 ellipsoid: geodetic coordinates to three.js world space.
// Axes follow the three.js globe convention used by 3d-tiles-renderer:
// +Y through the north pole, +X through (lat 0, lon 0), right-handed.

export const WGS84_RADIUS = 6378137;
export const WGS84_RADIUS_POLAR = 6356752.314245179;

const DEG2RAD = Math.PI / 180;

// lat/lon in degrees, height in meters, writes into target {x, y, z}
export function latLonToEcef( lat, lon, height, target ) {

	const phi = lat * DEG2RAD;
	const lambda = lon * DEG2RAD;
	const cosPhi = Math.cos( phi );
	const sinPhi = Math.sin( phi );

	const e2 = 1 - ( WGS84_RADIUS_POLAR * WGS84_RADIUS_POLAR ) / ( WGS84_RADIUS * WGS84_RADIUS );
	const n = WGS84_RADIUS / Math.sqrt( 1 - e2 * sinPhi * sinPhi );

	// ECEF with z through the pole, then swizzled so +Y is the pole in three.js
	const ex = ( n + height ) * cosPhi * Math.cos( lambda );
	const ey = ( n + height ) * cosPhi * Math.sin( lambda );
	const ez = ( n * ( 1 - e2 ) + height ) * sinPhi;

	target.x = ex;
	target.y = ez;
	target.z = - ey;
	return target;

}
