import { Vector3 } from 'three';
import { EARTH_RADIUS, metersToNormalized, normalizedToLatitude, normalizedToLongitude } from '../math/WebMercator.js';
import { MAPLIBRE_SPHERE, ecefToLatLon, localFrame, rayEllipsoidIntersection } from '../math/Ellipsoid.js';

const _position = new Vector3();
const _forward = new Vector3();
const _right = new Vector3();
const _level = new Vector3();
const _look = new Vector3();
const _screenUp = new Vector3();
const _center = new Vector3();
const _east = new Vector3();
const _north = new Vector3();
const _up = new Vector3();
const _place = { lat: 0, lon: 0, height: 0 };
const RAD2DEG = 180 / Math.PI;

// A maplibre-gl map drawn under a three.js scene: direction B of the
// bridge, the mirror of MapLibreLayer. The map lives in its own element
// beneath a transparent three.js canvas, the scene's controls own the
// input, and every frame the map's camera is derived from the scene's, so
// one controller drives both and MapLibre's whole style (labels, icons,
// everything this engine does not draw yet) shows through under the 3D.
//
//   const map = new maplibregl.Map( { container: 'basemap', interactive: false, ... } );
//   const underlay = new MapLibreUnderlay( map, { mode: 'planar' } );
//   ...each frame, after the controls:
//   underlay.sync( camera );
//
// Flat: the scene is this library's planar frame, Web Mercator meters with
// x east, y up and -z north, and MapLibre's flat map is the same
// projection, so a ground point lands on the same pixel in both by
// construction.
//
// Globe: the scene is this library's globe built on MAPLIBRE_SPHERE, the
// sphere maplibre-gl draws its globe on (every map, anchor and controller
// of the scene takes that datum), the map has projection 'globe', and the
// point the view ray meets the sphere at is the map's centre. MapLibre
// sizes its globe so the ground at the centre has the meters per pixel of
// the flat map at that zoom and latitude, which is where the zoom comes
// from. Past zoom 12 MapLibre's globe is a flat map again; the sphere and
// the plane are within a pixel of each other over what a view spans there.
//
// What a DOM underlay cannot do is share a depth buffer: the scene is
// always over the map, so a building here hides a label there. The layer
// (direction A) is the way to put three.js content in among MapLibre's.
//
// The camera is read, not the controls, so a free camera works as long as
// its view ray still meets the ground; looking at the sky, sync() returns
// false and leaves the map where it was.

export class MapLibreUnderlay {

	constructor( map, { mode = 'planar', datum = MAPLIBRE_SPHERE } = {} ) {

		this.map = map;
		this.mode = mode;
		this.datum = datum;
		// a MapLibre map clamps its pitch unless told otherwise; the scene's
		// camera is the truth here
		map.setMaxPitch( 180 );
		this._last = { lng: NaN, lat: NaN, zoom: NaN, bearing: NaN, pitch: NaN, roll: NaN, fov: NaN };

	}

	// MapLibre's camera for a three.js camera over the scene and a viewport
	// of the given height in pixels, or null when the view does not meet the
	// ground.
	static cameraState( camera, height, target = {}, mode = 'planar', datum = MAPLIBRE_SPHERE ) {

		_position.setFromMatrixPosition( camera.matrixWorld );
		_forward.set( 0, 0, - 1 ).transformDirection( camera.matrixWorld );
		let t, radius;

		if ( mode === 'planar' ) {

			if ( _forward.y >= - 1e-9 || _position.y <= 0 ) return null;

			// the ground under the screen centre
			t = - _position.y / _forward.y;
			_center.copy( _position ).addScaledVector( _forward, t );
			const [ nx, ny ] = metersToNormalized( _center.x, - _center.z );
			target.lng = normalizedToLongitude( nx );
			target.lat = normalizedToLatitude( ny );
			_east.set( 1, 0, 0 );
			_north.set( 0, 0, - 1 );
			_up.set( 0, 1, 0 );
			radius = EARTH_RADIUS;

		} else {

			if ( rayEllipsoidIntersection( _position, _forward, _center, datum ) === null ) return null;
			t = _center.distanceTo( _position );
			ecefToLatLon( _center, datum, _place );
			target.lng = _place.lon;
			target.lat = _place.lat;
			localFrame( _place.lat, _place.lon, _east, _north, _up );
			// MapLibre's globe at the centre: the flat map's meters per pixel
			// at that latitude, on a sphere of its radius
			radius = datum.radius * Math.cos( _place.lat / RAD2DEG );

		}

		// MapLibre: the centre is cameraToCenterDistance pixels away, and
		// that distance is 0.5 * height / tan( fov / 2 ); zoom follows from
		// the meters one pixel covers there
		const metersPerPixel = t * 2 * Math.tan( 0.5 * camera.fov / RAD2DEG ) / height;
		target.zoom = Math.log2( 2 * Math.PI * radius / ( metersPerPixel * 512 ) );

		// the horizontal look: the view direction along the ground, or, straight
		// down where it has none, where the top of the screen points
		_look.copy( _forward ).addScaledVector( _up, - _forward.dot( _up ) );
		if ( _look.lengthSq() < 1e-12 ) {

			_screenUp.set( 0, 1, 0 ).transformDirection( camera.matrixWorld );
			_look.copy( _screenUp ).addScaledVector( _up, - _screenUp.dot( _up ) );

		}

		_look.normalize();

		// bearing clockwise from north, pitch from straight down, in the frame
		// of the centre
		target.bearing = Math.atan2( _look.dot( _east ), _look.dot( _north ) ) * RAD2DEG;
		target.pitch = Math.acos( Math.max( - 1, Math.min( 1, - _forward.dot( _up ) ) ) ) * RAD2DEG;

		// roll: the camera's right against the level right for that view
		_right.set( 1, 0, 0 ).transformDirection( camera.matrixWorld );
		_level.crossVectors( _look, _up ).normalize();
		const cos = Math.max( - 1, Math.min( 1, _right.dot( _level ) ) );
		const sign = _right.clone().cross( _level ).dot( _forward ) < 0 ? 1 : - 1;
		target.roll = Math.abs( cos - 1 ) < 1e-9 ? 0 : sign * Math.acos( cos ) * RAD2DEG;
		target.fov = camera.fov;
		return target;

	}

	// Puts the map's camera where the scene's is, the map's own canvas being
	// the viewport. Returns whether it could.
	sync( camera ) {

		const state = MapLibreUnderlay.cameraState( camera, this.map.getCanvas().clientHeight, this._state ?? ( this._state = {} ), this.mode, this.datum );
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
