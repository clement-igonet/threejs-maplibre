// OrbitControls around a globe center: its rotate and zoom speeds are
// expressed in orbit angle and in distance-to-center, both of which stay the
// same whether the camera is 20 000 km or 200 m above the ground. Rescaling
// them every frame from the current altitude makes a drag move the ground
// under the pointer and a wheel notch or pinch change the altitude by a fixed
// fraction, like a 2D map, at every zoom.

import { geocentricHeight, WGS84_RADIUS } from '../math/Ellipsoid.js';

const DEG2RAD = Math.PI / 180;

/**
 * @param {number} altitude camera height above the surface, same unit as radius
 * @param {number} radius globe radius
 * @param {number} fovDeg vertical field of view
 * @param {number} zoomFraction altitude change per wheel notch (default 5%)
 * @returns {{ rotateSpeed: number, zoomSpeed: number }}
 */
export function globeOrbitSpeeds( altitude, radius, fovDeg, zoomFraction = 0.05 ) {

	const alt = Math.max( altitude, 1e-6 * radius );

	// OrbitControls rotates by 2*pi*dx/clientHeight*rotateSpeed. Dragging the
	// full viewport height should move the ground under the pointer by what
	// that height covers at nadir: 2*alt*tan(fov/2) meters, i.e. an angle of
	// 2*alt*tan(fov/2)/radius. Bounded by 1 so the whole earth stays orbitable.
	const rotateSpeed = Math.min( 1, alt * Math.tan( 0.5 * fovDeg * DEG2RAD ) / ( Math.PI * radius ) );

	// OrbitControls scales distance-to-center by 0.95^zoomSpeed per notch
	// (and by pinchRatio^zoomSpeed on touch). A step that leaves the ground
	// at (1 - zoomFraction) * alt scales the distance by
	// (radius + (1 - f) * alt) / (radius + alt); solve 0.95^zoomSpeed = that.
	const distanceScale = ( radius + ( 1 - zoomFraction ) * alt ) / ( radius + alt );
	const zoomSpeed = Math.log( distanceScale ) / Math.log( 0.95 );

	return { rotateSpeed, zoomSpeed };

}

/**
 * Apply globeOrbitSpeeds() to an OrbitControls orbiting the WGS84 globe
 * centered at the origin. Call once per frame before controls.update().
 */
export function updateGlobeOrbitSpeeds( controls, camera ) {

	const altitude = geocentricHeight( camera.position );
	const { rotateSpeed, zoomSpeed } = globeOrbitSpeeds( altitude, WGS84_RADIUS, camera.fov );
	controls.rotateSpeed = rotateSpeed;
	controls.zoomSpeed = zoomSpeed;

}
