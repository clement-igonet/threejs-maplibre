// Minimal ellipsoid: geodetic coordinates to three.js world space.
// Axes follow the three.js globe convention used by 3d-tiles-renderer:
// +Y through the north pole, +X through (lat 0, lon 0), right-handed.
//
// The shape of the earth is a datum, { radius, polarRadius } in meters, and
// every function takes one, WGS84 unless told otherwise. A datum is a plain
// object so it survives postMessage to the build workers. Two are provided:
// WGS84, the ellipsoid of GPS and of every 3D Tiles dataset, and
// MAPLIBRE_SPHERE, the sphere maplibre-gl draws its globe on (its
// earthRadius, with geodetic latitude taken as spherical). The two surfaces
// are 21 km apart on the ground at Paris, so a scene over a MapLibre globe
// has to be built on MapLibre's sphere to land where the map puts it.

export const WGS84_RADIUS = 6378137;
export const WGS84_RADIUS_POLAR = 6356752.314245179;

export const WGS84 = Object.freeze( { radius: WGS84_RADIUS, polarRadius: WGS84_RADIUS_POLAR } );
export const MAPLIBRE_SPHERE = Object.freeze( { radius: 6371008.8, polarRadius: 6371008.8 } );

const DEG2RAD = Math.PI / 180;

// lat/lon in degrees, height in meters, writes into target {x, y, z}
export function latLonToEcef( lat, lon, height, target, datum = WGS84 ) {

	const phi = lat * DEG2RAD;
	const lambda = lon * DEG2RAD;
	const cosPhi = Math.cos( phi );
	const sinPhi = Math.sin( phi );

	const a = datum.radius, b = datum.polarRadius;
	const e2 = 1 - ( b * b ) / ( a * a );
	const n = a / Math.sqrt( 1 - e2 * sinPhi * sinPhi );

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
export function geocentricHeight( point, datum = WGS84 ) {

	const length = Math.hypot( point.x, point.y, point.z );
	if ( length === 0 ) return - datum.polarRadius;

	const sinPhi = point.y / length;
	const cosPhi2 = 1 - sinPhi * sinPhi;
	const a = datum.radius;
	const b = datum.polarRadius;
	const surface = ( a * b ) / Math.sqrt( b * b * cosPhi2 + a * a * sinPhi * sinPhi );
	return length - surface;

}

// First intersection of the ray (origin, unit direction) with the ellipsoid
// surface, written into target; null when the ray misses. Solved on the unit
// sphere the ellipsoid scales to, since the ray parameter survives scaling.
export function rayEllipsoidIntersection( origin, direction, target, datum = WGS84 ) {

	const a = datum.radius;
	const b = datum.polarRadius;
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

// The geodetic place under a world-space point: latitude and longitude in
// degrees, height in meters above the datum along its normal. Exact on a
// sphere; on an ellipsoid, Bowring's first step then the classic fixed
// point, which holds a nanodegree from the ground to a satellite.
export function ecefToLatLon( point, datum = WGS84, target = { lat: 0, lon: 0, height: 0 } ) {

	const a = datum.radius, b = datum.polarRadius;
	const x = point.x, y = - point.z, z = point.y; // back to z through the pole
	const p = Math.hypot( x, y );
	target.lon = Math.atan2( y, x ) / DEG2RAD;

	if ( a === b ) {

		const r = Math.hypot( p, z );
		target.lat = Math.atan2( z, p ) / DEG2RAD;
		target.height = r - a;
		return target;

	}

	const e2 = 1 - ( b * b ) / ( a * a );
	const ep2 = ( a * a - b * b ) / ( b * b );
	const theta = Math.atan2( z * a, p * b );
	const sinT = Math.sin( theta ), cosT = Math.cos( theta );
	let phi = Math.atan2( z + ep2 * b * sinT * sinT * sinT, p - e2 * a * cosT * cosT * cosT );
	let sinPhi = Math.sin( phi ), cosPhi = Math.cos( phi );
	let n = a / Math.sqrt( 1 - e2 * sinPhi * sinPhi );
	for ( let i = 0; i < 4; i ++ ) {

		phi = Math.atan2( z + e2 * n * sinPhi, p );
		sinPhi = Math.sin( phi );
		cosPhi = Math.cos( phi );
		n = a / Math.sqrt( 1 - e2 * sinPhi * sinPhi );

	}

	target.lat = phi / DEG2RAD;
	target.height = Math.abs( cosPhi ) > 1e-10 ? p / cosPhi - n : Math.abs( z ) - b;
	return target;

}

// The east, north and up unit vectors at (lat, lon), in the +Y-pole world
// convention of latLonToEcef: what "level" and "north" mean for something
// standing on the globe there. The same on every datum: up is the geodetic
// normal, which is what latitude is measured from.
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
