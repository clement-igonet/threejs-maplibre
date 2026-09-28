import { Matrix4, PerspectiveCamera, Scene, Vector3, Vector4, WebGLRenderer } from 'three';
import { MAPLIBRE_EARTH_RADIUS, globeFrame, mercatorFrame } from './MapLibreFrames.js';

const _frame = new Matrix4();
const _globe = new Matrix4();
const _flat = new Matrix4();
const _clip = new Vector4();
const _local = new Vector3();

// A three.js scene drawn inside a maplibre-gl map, as a custom layer, with
// the map's own camera: the other direction from the rest of this library,
// where the map is drawn inside a three.js scene.
//
//   const layer = new MapLibreLayer( { lng: 2.3359, lat: 48.8610 } );
//   layer.scene.add( model ); // meters, x east, y up, -z north
//   map.addLayer( layer );
//
// The scene lives in meters around an anchor, in the frame MapAnchor gives
// its children (x east, y up, -z north), so a three.js object built the
// usual way stands level and faces north. Every frame, MapLibre hands the
// layer its projection as 64-bit matrices; the layer multiplies the one that
// applies by the matrix from the anchor's frame into MapLibre's space
// (MapLibreFrames.js), still in float64, and gives three.js the product as
// the camera's projection. The anchor's world coordinates never reach the
// GPU, only offsets of a few hundred meters do, so a building-scale scene
// holds still at street level.
//
// Which space depends on the map. Under mercator, MapLibre projects mercator
// coordinates. Its globe is a unit sphere up to zoom 11, flat mercator from
// zoom 12, and between the two it blends the clip-space results of both
// (projectionTransition going from 1 to 0, in _projection_globe.vertex.glsl).
// The layer does the same: it projects each vertex through both matrices
// and mixes, so the scene follows the map through the morph. A three.js
// camera holds one projection, so when both apply the layer sets the mixed
// matrix at the anchor, which is exact there and drifts with the square of
// the distance from it, like the meters frame itself.
//
// Precision: measured against map.project() over zooms 2 to 19, pitched
// and turned, the scene lands within 0.1 px of where MapLibre puts the same
// ground, in both projections (scripts/bridge-check.mjs).

export class MapLibreLayer {

	constructor( { id = 'three', scene = new Scene(), lng = 0, lat = 0, altitude = 0 } = {} ) {

		// the maplibre-gl CustomLayerInterface
		this.id = id;
		this.type = 'custom';
		this.renderingMode = '3d'; // share MapLibre's depth buffer

		this.scene = scene;
		this.camera = new PerspectiveCamera(); // its projection is set every frame
		this.map = null;
		this.renderer = null;

		this._anchor = { lng, lat, altitude };
		// the clip matrix of the last frame and the transition it was built
		// for, for anyone checking where the scene lands
		this.lastProjection = { matrix: new Matrix4(), transition: 0 };

	}

	get anchor() {

		return this._anchor;

	}

	// Moves the scene's origin. Everything in the scene moves with it, so a
	// scene that follows a vehicle sets the anchor to the vehicle and keeps
	// its content at the origin.
	setAnchor( lng, lat, altitude = 0 ) {

		this._anchor = { lng, lat, altitude };
		this.map?.triggerRepaint();
		return this;

	}

	onAdd( map, gl ) {

		this.map = map;
		// on MapLibre's canvas and context: one depth buffer, one frame
		this.renderer = new WebGLRenderer( { canvas: map.getCanvas(), context: gl } );
		this.renderer.autoClear = false;

	}

	onRemove() {

		this.renderer?.dispose();
		this.renderer = null;
		this.map = null;

	}

	render( gl, args ) {

		this.projectionFor( args.defaultProjectionData, this.camera.projectionMatrix );
		this.camera.projectionMatrixInverse.copy( this.camera.projectionMatrix ).invert();

		this.renderer.resetState(); // MapLibre left the GL state as it likes it
		this.renderer.render( this.scene, this.camera );

	}

	// Local meters at the anchor to clip space, for MapLibre's projection data.
	projectionFor( data, target ) {

		const { lng, lat, altitude } = this._anchor;
		const transition = data.projectionTransition ?? 0;

		if ( transition <= 0 ) {

			// mercator, or a globe map past zoom 12 where mainMatrix is mercator
			target.fromArray( data.mainMatrix ).multiply( mercatorFrame( lng, lat, altitude, _frame ) );

		} else if ( transition >= 1 ) {

			target.fromArray( data.mainMatrix ).multiply( globeFrame( lng, lat, altitude, _frame ) );

		} else {

			// the morph: MapLibre mixes the two clip positions per vertex; one
			// camera matrix can only be that mix at one point, the anchor
			_globe.fromArray( data.mainMatrix ).multiply( globeFrame( lng, lat, altitude, _frame ) );
			_flat.fromArray( data.fallbackMatrix ).multiply( mercatorFrame( lng, lat, altitude, _frame ) );
			const g = _globe.elements, f = _flat.elements, t = target.elements;
			for ( let i = 0; i < 16; i ++ ) t[ i ] = f[ i ] + ( g[ i ] - f[ i ] ) * transition;

		}

		this.lastProjection.matrix.copy( target );
		this.lastProjection.transition = transition;
		return target;

	}

	// --- coordinates --------------------------------------------------------

	// Local meters (x east, y up, -z north) of a place, relative to the anchor.
	// Exact at the anchor, a meters frame elsewhere: 1 km out is within a
	// decimetre, 10 km out within ten meters, on MapLibre's sphere.
	localFromLngLat( lng, lat, altitude = 0, target = new Vector3() ) {

		const a = this._anchor;
		const lat0 = a.lat * Math.PI / 180;
		const east = ( lng - a.lng ) * Math.PI / 180 * MAPLIBRE_EARTH_RADIUS * Math.cos( lat0 );
		const north = ( lat - a.lat ) * Math.PI / 180 * MAPLIBRE_EARTH_RADIUS;
		return target.set( east, altitude - a.altitude, - north );

	}

	// The place under a local point, the inverse of the above.
	lngLatFromLocal( local ) {

		const a = this._anchor;
		const lat0 = a.lat * Math.PI / 180;
		return {
			lng: a.lng + local.x / ( MAPLIBRE_EARTH_RADIUS * Math.cos( lat0 ) ) * 180 / Math.PI,
			lat: a.lat - local.z / MAPLIBRE_EARTH_RADIUS * 180 / Math.PI,
			altitude: a.altitude + local.y,
		};

	}

	// Where a local point lands on the map's canvas, in CSS pixels, from the
	// last frame's projection: what map.project gives for a place.
	project( local, target = { x: 0, y: 0 } ) {

		_clip.set( local.x, local.y, local.z, 1 ).applyMatrix4( this.lastProjection.matrix );
		const canvas = this.map.getCanvas();
		target.x = ( _clip.x / _clip.w * 0.5 + 0.5 ) * canvas.clientWidth;
		target.y = ( 0.5 - _clip.y / _clip.w * 0.5 ) * canvas.clientHeight;
		return target;

	}

	// A three.js object placed at a place: position from localFromLngLat,
	// heading in degrees clockwise from north as MapAnchor takes it.
	place( object, lng, lat, altitude = 0, heading = 0 ) {

		this.localFromLngLat( lng, lat, altitude, _local );
		object.position.copy( _local );
		object.rotation.set( 0, - heading * Math.PI / 180, 0 );
		return object;

	}

}
