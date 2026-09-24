// Map-style camera controls for both RasterTileMap modes: the state is a
// ground point at the screen center (lat, lon), the distance from that point
// to the camera, a heading and a pitch, as in MapLibre. The camera is placed
// from that state every frame, on the WGS84 globe or on the Web Mercator
// plane, so drags move the ground under the pointer and zoom steps are a
// fixed fraction of the distance, at any altitude and latitude. In planar
// mode distances are Web Mercator meters, like the scene.
//
// Gestures follow MapLibre's conventions:
// - one pointer drag: pan
// - wheel: zoom around the cursor
// - right drag, or ctrl/shift + left drag: heading (x) and pitch (y)
// - two fingers: pinch to zoom, move to pan, twist to turn; both fingers
//   sliding vertically together tilt the view instead

import { Vector3 } from 'three';
import { latLonToEcef, localFrame, WGS84_RADIUS } from '../math/Ellipsoid.js';
import { latitudeToNormalized, longitudeToNormalized, metersToNormalized, normalizedToLatitude, normalizedToLongitude, normalizedToMeters } from '../math/WebMercator.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const MAX_LAT = 85; // Web Mercator edge, and keeps the frame away from the pole

const _target = new Vector3();
const _up = new Vector3();
const _east = new Vector3();
const _north = new Vector3();
const _look = new Vector3();

export class MapControls {

	/**
	 * @param {PerspectiveCamera} camera
	 * @param {HTMLElement} [domElement] element receiving the gestures; omit to drive the state from code only
	 * @param {{ mode?: 'globe' | 'planar' }} [options] the RasterTileMap mode the camera looks at
	 */
	constructor( camera, domElement = null, { mode = 'globe' } = {} ) {

		this.camera = camera;
		this.domElement = domElement;
		this.mode = mode;
		this.enabled = true;

		// view state; degrees and meters
		this.lat = 0;
		this.lon = 0;
		this.distance = 3 * WGS84_RADIUS;
		this.heading = 0;
		this.pitch = 0;

		this.minAltitude = 100; // of the camera, approximated as distance * cos(pitch)
		this.maxDistance = 10 * WGS84_RADIUS;
		this.maxPitch = 85;
		this.zoomFraction = 0.05; // distance change per wheel notch
		this.rotateDegPerPixel = 0.25;
		this.pitchDegPerPixel = 0.5;

		this._pointers = new Map(); // pointerId -> { x, y, button }
		this._twoFingers = null; // { mode, distance, angle, cx, cy }
		this._changed = true;

		if ( domElement ) this._bind( domElement );

	}

	/** Set any of lat, lon, distance, heading, pitch; others keep their value. */
	setView( view ) {

		Object.assign( this, view );
		this._clamp();
		this._changed = true;

	}

	/** Meters covered by one pixel at the screen center. */
	metersPerPixel() {

		const height = this.domElement ? this.domElement.clientHeight : 1;
		return 2 * this.distance * Math.tan( 0.5 * this.camera.fov * DEG2RAD ) / height;

	}

	/** Move the ground by a pointer displacement, in pixels (y down). */
	panByPixels( dx, dy ) {

		// the ground is tilted by the pitch about the screen's horizontal
		// axis, so a vertical pixel step covers more ground than a horizontal one
		const mpp = this.metersPerPixel();
		this.moveByMeters( - dx * mpp, dy * mpp / Math.cos( this.pitch * DEG2RAD ) );

	}

	/** Move the center by screen-right and screen-up ground distances, in meters (Web Mercator meters in planar mode). */
	moveByMeters( right, up ) {

		const h = this.heading * DEG2RAD;
		const northMeters = up * Math.cos( h ) - right * Math.sin( h );
		const eastMeters = up * Math.sin( h ) + right * Math.cos( h );

		if ( this.mode === 'planar' ) {

			const [ mx, my ] = normalizedToMeters( longitudeToNormalized( this.lon ), latitudeToNormalized( this.lat ) );
			const [ nx, ny ] = metersToNormalized( mx + eastMeters, my + northMeters );
			this.lon = normalizedToLongitude( nx );
			this.lat = normalizedToLatitude( Math.min( 1, Math.max( 0, ny ) ) );

		} else {

			this.lat += northMeters / WGS84_RADIUS * RAD2DEG;
			this.lon += eastMeters / ( WGS84_RADIUS * Math.cos( this.lat * DEG2RAD ) ) * RAD2DEG;

		}

		this._clamp();
		this._changed = true;

	}

	/**
	 * Scale the distance by factor, keeping the ground point under the
	 * pixel (px, py measured from the screen center, y down) in place.
	 */
	zoomBy( factor, px = 0, py = 0 ) {

		const before = this.distance;
		this.distance *= factor;
		this._clamp();
		const applied = this.distance / before;
		const mpp = this.metersPerPixel() / applied; // before the zoom
		this.moveByMeters( ( 1 - applied ) * px * mpp, - ( 1 - applied ) * py * mpp / Math.cos( this.pitch * DEG2RAD ) );

	}

	rotateBy( headingDeg, pitchDeg ) {

		this.heading += headingDeg;
		this.pitch += pitchDeg;
		this._clamp();
		this._changed = true;

	}

	/** The ground point at the screen center and the local up there, in scene units. */
	getTarget( target, up = null ) {

		if ( this.mode === 'planar' ) {

			const [ mx, my ] = normalizedToMeters( longitudeToNormalized( this.lon ), latitudeToNormalized( this.lat ) );
			target.set( mx, 0, - my );
			if ( up ) up.set( 0, 1, 0 );

		} else {

			latLonToEcef( this.lat, this.lon, 0, target );
			if ( up ) localFrame( this.lat, this.lon, _east, _north, up );

		}

		return target;

	}

	/** Place the camera from the state. Returns true when the view changed. */
	update() {

		if ( ! this._changed ) return false;
		this._changed = false;

		const camera = this.camera;
		this.getTarget( _target, _up );
		if ( this.mode === 'planar' ) {

			// RasterTileMap planar frame: x east, y up, -z north
			_east.set( 1, 0, 0 );
			_north.set( 0, 0, - 1 );

		}

		// horizontal look direction, clockwise from north
		const h = this.heading * DEG2RAD;
		_look.copy( _north ).multiplyScalar( Math.cos( h ) ).addScaledVector( _east, Math.sin( h ) );

		const p = this.pitch * DEG2RAD;
		camera.position.copy( _target )
			.addScaledVector( _up, this.distance * Math.cos( p ) )
			.addScaledVector( _look, - this.distance * Math.sin( p ) );
		camera.up.copy( _look );
		camera.lookAt( _target );
		camera.updateMatrixWorld();
		return true;

	}

	dispose() {

		if ( this._unbind ) this._unbind();

	}

	_clamp() {

		this.lat = Math.min( MAX_LAT, Math.max( - MAX_LAT, this.lat ) );
		this.lon = ( ( this.lon + 180 ) % 360 + 360 ) % 360 - 180;
		this.pitch = Math.min( this.maxPitch, Math.max( 0, this.pitch ) );
		this.heading = ( ( this.heading % 360 ) + 360 ) % 360;
		const minDistance = this.minAltitude / Math.cos( this.pitch * DEG2RAD );
		this.distance = Math.min( this.maxDistance, Math.max( minDistance, this.distance ) );

	}

	// --- pointer handling ---------------------------------------------------

	_bind( element ) {

		element.style.touchAction = 'none';

		const onPointerDown = event => {

			if ( ! this.enabled ) return;
			element.setPointerCapture( event.pointerId );
			this._pointers.set( event.pointerId, { x: event.clientX, y: event.clientY, button: event.button, ctrl: event.ctrlKey || event.shiftKey } );
			if ( this._pointers.size === 2 ) {

				this._twoFingers = this._twoFingerState( 'pending' );
				this._twoFingers.rect = element.getBoundingClientRect();

			}

		};

		const onPointerMove = event => {

			const pointer = this._pointers.get( event.pointerId );
			if ( ! pointer || ! this.enabled ) return;
			const dx = event.clientX - pointer.x;
			const dy = event.clientY - pointer.y;
			pointer.x = event.clientX;
			pointer.y = event.clientY;

			if ( this._pointers.size === 1 ) {

				if ( pointer.button === 2 || pointer.ctrl ) this.rotateBy( dx * this.rotateDegPerPixel, - dy * this.pitchDegPerPixel );
				else this.panByPixels( dx, dy );

			} else if ( this._pointers.size === 2 ) {

				this._onTwoFingers();

			}

		};

		const onPointerUp = event => {

			this._pointers.delete( event.pointerId );
			if ( element.hasPointerCapture( event.pointerId ) ) element.releasePointerCapture( event.pointerId );
			this._twoFingers = null;

		};

		const onWheel = event => {

			if ( ! this.enabled ) return;
			event.preventDefault();
			const notches = event.deltaMode === 1 ? event.deltaY / 3 : event.deltaY / 100;
			const rect = element.getBoundingClientRect();
			const px = event.clientX - rect.left - rect.width / 2;
			const py = event.clientY - rect.top - rect.height / 2;
			this.zoomBy( Math.pow( 1 - this.zoomFraction, - notches ), px, py );

		};

		const onContextMenu = event => event.preventDefault();

		element.addEventListener( 'pointerdown', onPointerDown );
		element.addEventListener( 'pointermove', onPointerMove );
		element.addEventListener( 'pointerup', onPointerUp );
		element.addEventListener( 'pointercancel', onPointerUp );
		element.addEventListener( 'wheel', onWheel, { passive: false } );
		element.addEventListener( 'contextmenu', onContextMenu );

		this._unbind = () => {

			element.removeEventListener( 'pointerdown', onPointerDown );
			element.removeEventListener( 'pointermove', onPointerMove );
			element.removeEventListener( 'pointerup', onPointerUp );
			element.removeEventListener( 'pointercancel', onPointerUp );
			element.removeEventListener( 'wheel', onWheel );
			element.removeEventListener( 'contextmenu', onContextMenu );

		};

	}

	_twoFingerState( mode ) {

		const [ a, b ] = this._pointers.values();
		return {
			mode,
			distance: Math.hypot( b.x - a.x, b.y - a.y ),
			angle: Math.atan2( b.y - a.y, b.x - a.x ),
			cx: ( a.x + b.x ) / 2,
			cy: ( a.y + b.y ) / 2,
			startA: { x: a.x, y: a.y },
			startB: { x: b.x, y: b.y },
		};

	}

	_onTwoFingers() {

		const start = this._twoFingers;
		const now = this._twoFingerState( start.mode );

		if ( start.mode === 'pending' ) {

			// wait for a clear intent: both fingers sliding vertically the
			// same way, at a steady spread, is a tilt; anything else is a
			// pinch. Pointer events arrive one finger at a time, so a finger
			// that has not moved yet does not vote.
			const [ a, b ] = this._pointers.values();
			const da = { x: a.x - start.startA.x, y: a.y - start.startA.y };
			const db = { x: b.x - start.startB.x, y: b.y - start.startB.y };
			const movedA = Math.hypot( da.x, da.y );
			const movedB = Math.hypot( db.x, db.y );
			if ( Math.max( movedA, movedB ) < 8 ) return;
			const vertical = d => Math.abs( d.y ) > 2 * Math.abs( d.x );
			const steady = Math.abs( now.distance - start.distance ) < 0.1 * start.distance;
			const tiltLike = steady && ( movedA < 4 || vertical( da ) ) && ( movedB < 4 || vertical( db ) ) && da.y * db.y >= 0;
			if ( tiltLike && Math.min( movedA, movedB ) < 8 ) {

				// one finger still: a pinch with an anchor, unless the other catches up
				if ( Math.max( movedA, movedB ) < 30 ) return;
				start.mode = 'pinch';

			} else {

				start.mode = tiltLike ? 'pitch' : 'pinch';

			}

			// the deltas below start from here
			Object.assign( start, now, { mode: start.mode, rect: start.rect } );
			return;

		}

		if ( start.mode === 'pitch' ) {

			this.rotateBy( 0, - ( now.cy - start.cy ) * this.pitchDegPerPixel );

		} else {

			// zoom around the fingers, then keep the ground under their midpoint
			const { rect } = start;
			if ( start.distance > 0 ) this.zoomBy( start.distance / now.distance, now.cx - rect.left - rect.width / 2, now.cy - rect.top - rect.height / 2 );
			this.panByPixels( now.cx - start.cx, now.cy - start.cy );
			// screen y points down, so a positive twist is clockwise: the map
			// turns with the fingers, i.e. the heading decreases
			let twist = now.angle - start.angle;
			if ( twist > Math.PI ) twist -= 2 * Math.PI;
			if ( twist < - Math.PI ) twist += 2 * Math.PI;
			this.rotateBy( - twist * RAD2DEG, 0 );

		}

		Object.assign( start, now, { mode: start.mode, rect: start.rect } );

	}

}
