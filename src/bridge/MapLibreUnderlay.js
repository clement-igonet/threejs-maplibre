import { Vector3 } from 'three';
import { EARTH_RADIUS, metersToNormalized, normalizedToLatitude, normalizedToLongitude } from '../math/WebMercator.js';

const _position = new Vector3();
const _forward = new Vector3();
const _right = new Vector3();
const _level = new Vector3();
const _center = new Vector3();
const UP = new Vector3( 0, 1, 0 );
const RAD2DEG = 180 / Math.PI;

// A maplibre-gl map drawn under a three.js scene: direction B of the
// bridge, the mirror of MapLibreLayer. The map lives in its own element
// beneath a transparent three.js canvas, the scene's controls own the
// input, and every frame the map's camera is derived from the scene's, so
// one controller drives both and MapLibre's whole style (labels, icons,
// everything this engine does not draw yet) shows through under the 3D.
//
//   const map = new maplibregl.Map( { container: 'basemap', interactive: false, ... } );
//   const underlay = new MapLibreUnderlay( map );
//   ...each frame, after the controls:
//   underlay.sync( camera );
//
// Flat map only. The scene is this library's planar frame, Web Mercator
// meters with x east, y up and -z north, and MapLibre's flat map is the
// same projection, so a ground point lands on the same pixel in both by
// construction. On the globe the two engines draw different shapes of the
// earth (WGS84 here, MapLibre's sphere there), 21 km apart at Paris, and
// no camera sync bridges that; that is a datum question, not a camera one.
//
// What a DOM underlay cannot do is share a depth buffer: the scene is
// always over the map, so a building here hides a label there. The layer
// (direction A) is the way to put three.js content in among MapLibre's.
//
// The camera is read, not the controls, so a free camera works as long as
// its view ray still meets the ground; looking at the sky, sync() returns
// false and leaves the map where it was.

export class MapLibreUnderlay {

	constructor( map ) {

		this.map = map;
		// a MapLibre map clamps its pitch unless told otherwise; the scene's
		// camera is the truth here
		map.setMaxPitch( 180 );
		this._last = { lng: NaN, lat: NaN, zoom: NaN, bearing: NaN, pitch: NaN, roll: NaN, fov: NaN };

	}

	// MapLibre's camera for a three.js camera over the planar frame and a
	// viewport of the given height in pixels, or null when the view does
	// not meet the ground.
	static cameraState( camera, height, target = {} ) {

		_position.setFromMatrixPosition( camera.matrixWorld );
		_forward.set( 0, 0, - 1 ).transformDirection( camera.matrixWorld );
		if ( _forward.y >= - 1e-9 || _position.y <= 0 ) return null;

		// the ground under the screen centre
		const t = - _position.y / _forward.y;
		_center.copy( _position ).addScaledVector( _forward, t );
		const [ nx, ny ] = metersToNormalized( _center.x, - _center.z );
		target.lng = normalizedToLongitude( nx );
		target.lat = normalizedToLatitude( ny );

		// MapLibre: the centre is cameraToCenterDistance pixels away, and
		// that distance is 0.5 * height / tan( fov / 2 ); zoom follows from
		// the mercator meters one pixel covers there
		const metersPerPixel = t * 2 * Math.tan( 0.5 * camera.fov / RAD2DEG ) / height;
		target.zoom = Math.log2( 2 * Math.PI * EARTH_RADIUS / ( metersPerPixel * 512 ) );

		// bearing clockwise from north, pitch from straight down
		target.bearing = Math.atan2( _forward.x, - _forward.z ) * RAD2DEG;
		target.pitch = Math.acos( Math.max( - 1, Math.min( 1, - _forward.y ) ) ) * RAD2DEG;

		// roll: the camera's right against the level right for that view
		_right.set( 1, 0, 0 ).transformDirection( camera.matrixWorld );
		_level.crossVectors( _forward, UP ).normalize();
		const cos = Math.max( - 1, Math.min( 1, _right.dot( _level ) ) );
		const sign = _right.clone().cross( _level ).dot( _forward ) < 0 ? 1 : - 1;
		target.roll = Math.abs( cos - 1 ) < 1e-9 ? 0 : sign * Math.acos( cos ) * RAD2DEG;
		target.fov = camera.fov;
		return target;

	}

	// Puts the map's camera where the scene's is, the map's own canvas being
	// the viewport. Returns whether it could.
	sync( camera ) {

		const state = MapLibreUnderlay.cameraState( camera, this.map.getCanvas().clientHeight, this._state ?? ( this._state = {} ) );
		if ( ! state ) return false;

		const last = this._last;
		if ( state.fov !== last.fov ) this.map.setVerticalFieldOfView( state.fov );
		if ( state.lng !== last.lng || state.lat !== last.lat || state.zoom !== last.zoom || state.bearing !== last.bearing || state.pitch !== last.pitch || state.roll !== last.roll ) {

			this.map.jumpTo( { center: [ state.lng, state.lat ], zoom: state.zoom, bearing: state.bearing, pitch: state.pitch, roll: state.roll } );

		}

		Object.assign( last, state );
		return true;

	}

}
