import { Matrix4 } from 'three';

// Where a three.js scene sits in a maplibre-gl map.
//
// A scene placed on a map lives in a local frame at an anchor, in meters,
// with x east, y up and -z north, the frame MapAnchor gives its children:
// a three.js object built the usual way (y up, facing -z) stands level and
// faces north. What MapLibre projects is not meters, and not one space:
//
// - its mercator coordinates, 0..1 across the world, y towards the south,
//   z up in the same units (a meter is the same length in every direction,
//   which is what MapLibre calls conformal);
// - its globe, a unit sphere with a point at (sin lng cos lat, sin lat,
//   cos lng cos lat), altitude along the radius.
//
// Both are MapLibre's sphere, 6 371 008.8 m in radius (earthRadius in
// maplibre-gl's lng_lat.ts), not the WGS84 ellipsoid this engine's own
// globe uses: on MapLibre's map, MapLibre's earth is the one to stand on.
//
// These functions build, in float64, the matrix from the local frame to one
// of those spaces. Multiplied by MapLibre's projection matrix on the CPU,
// still in float64, the result maps meters around the anchor straight to
// clip space, and only then is it rounded to float32 for the GPU: the
// anchor's world-sized coordinates never reach a float32, which is what
// keeps a street-level scene from jittering (relative-to-center rendering).

export const MAPLIBRE_EARTH_RADIUS = 6371008.8;

const DEG2RAD = Math.PI / 180;

// maplibre-gl's mercatorXfromLng, mercatorYfromLat, circumferenceAtLatitude
export function mercatorX( lng ) {

	return ( 180 + lng ) / 360;

}

export function mercatorY( lat ) {

	return ( 180 - ( 180 / Math.PI * Math.log( Math.tan( Math.PI / 4 + lat * DEG2RAD / 2 ) ) ) ) / 360;

}

// mercator units per meter at a latitude, the same along x, y and z
export function mercatorUnitsPerMeter( lat ) {

	return 1 / ( 2 * Math.PI * MAPLIBRE_EARTH_RADIUS * Math.cos( lat * DEG2RAD ) );

}

// Local meters (x east, y up, -z north) at lng, lat, altitude to MapLibre
// mercator coordinates.
export function mercatorFrame( lng, lat, altitude = 0, target = new Matrix4() ) {

	const s = mercatorUnitsPerMeter( lat );
	// east is +x in both; north is -z here and -y there; up is +y here and
	// +z there
	return target.set(
		s, 0, 0, mercatorX( lng ),
		0, 0, s, mercatorY( lat ),
		0, s, 0, altitude * s,
		0, 0, 0, 1,
	);

}

// Local meters (x east, y up, -z north) at lng, lat, altitude to MapLibre's
// unit sphere.
export function globeFrame( lng, lat, altitude = 0, target = new Matrix4() ) {

	const lambda = lng * DEG2RAD, phi = lat * DEG2RAD;
	const sinL = Math.sin( lambda ), cosL = Math.cos( lambda );
	const sinP = Math.sin( phi ), cosP = Math.cos( phi );
	const r = 1 / MAPLIBRE_EARTH_RADIUS;
	const k = 1 + altitude * r;

	// up is the point itself on a sphere; east and north are its tangents
	const up = [ sinL * cosP, sinP, cosL * cosP ];
	const east = [ cosL, 0, - sinL ];
	const north = [ - sinL * sinP, cosP, - cosL * sinP ];

	return target.set(
		east[ 0 ] * r, up[ 0 ] * r, - north[ 0 ] * r, up[ 0 ] * k,
		east[ 1 ] * r, up[ 1 ] * r, - north[ 1 ] * r, up[ 1 ] * k,
		east[ 2 ] * r, up[ 2 ] * r, - north[ 2 ] * r, up[ 2 ] * k,
		0, 0, 0, 1,
	);

}
