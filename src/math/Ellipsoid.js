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

// Height of a world-space point above the ellipsoid along the ray from the
// center (geocentric, so a few meters off the geodetic height at mid
// latitudes: enough for LOD and control scaling, not for surveying).
export function geocentricHeight( point ) {

	const length = Math.hypot( point.x, point.y, point.z );
	if ( length === 0 ) return - WGS84_RADIUS_POLAR;

	const sinPhi = point.y / length;
	const cosPhi2 = 1 - sinPhi * sinPhi;
	const a = WGS84_RADIUS;
	const b = WGS84_RADIUS_POLAR;
	const surface = ( a * b ) / Math.sqrt( b * b * cosPhi2 + a * a * sinPhi * sinPhi );
	return length - surface;

}

// First intersection of the ray (origin, unit direction) with the ellipsoid
// surface, written into target; null when the ray misses. Solved on the unit
// sphere the ellipsoid scales to, since the ray parameter survives scaling.
export function rayEllipsoidIntersection( origin, direction, target ) {

	const a = WGS84_RADIUS;
	const b = WGS84_RADIUS_POLAR;
	const ox = origin.x / a, oy = origin.y / b, oz = origin.z / a;
	const dx = direction.x / a, dy = direction.y / b, dz = direction.z / a;

	const A = dx * dx + dy * dy + dz * dz;
	const B = 2 * ( ox * dx + oy * dy + oz * dz );
	const C = ox * ox + oy * oy + oz * oz - 1;
	const disc = B * B - 4 * A * C;
	if ( disc < 0 ) return null;

	const root = Math.sqrt( disc );
	let t = ( - B - root ) / ( 2 * A );
	if ( t < 0 ) t = ( - B + root ) / ( 2 * A ); // inside: the exit point
	if ( t < 0 ) return null;

	target.x = origin.x + t * direction.x;
	target.y = origin.y + t * direction.y;
	target.z = origin.z + t * direction.z;
	return target;

}

// The east, north and up unit vectors at (lat, lon), in the +Y-pole world
// convention of latLonToEcef: what "level" and "north" mean for something
// standing on the globe there.
export function localFrame( lat, lon, east, north, up ) {

	const phi = lat * DEG2RAD;
	const lambda = lon * DEG2RAD;
	const cosPhi = Math.cos( phi );
	const sinPhi = Math.sin( phi );
	const cosLambda = Math.cos( lambda );
	const sinLambda = Math.sin( lambda );
	east.set( - sinLambda, 0, - cosLambda );
	north.set( - sinPhi * cosLambda, cosPhi, sinPhi * sinLambda );
	up.set( cosPhi * cosLambda, sinPhi, - cosPhi * sinLambda );

}
