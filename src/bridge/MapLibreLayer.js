import { Matrix4, PerspectiveCamera, Scene, Vector3, Vector4, WebGLRenderer } from 'three';
import { MAPLIBRE_EARTH_RADIUS, globeFrame, mercatorFrame, mercatorUnitsPerMeter, mercatorX, mercatorY } from './MapLibreFrames.js';

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
//
// Terrain: with terrain on the map, the anchor stands on it. Its elevation
// is asked of the map every frame (map.queryTerrainElevation, what
// MapLibre's own three.js example does), so the scene settles as DEM tiles
// land, and an object placed elsewhere through place() stands on its own
// ground rather than the anchor's.
//
// Two spaces. 'local', the default: meters around the anchor, for anything
// building-sized, where float32 has to hold a centimetre. 'world': the
// scene's units are MapLibre's own, mercator 0..1 on the flat map and the
// unit sphere on the globe, for content the size of a continent, where a
// meters frame would drift (it is mercator linearised at one point) and a
// kilometre of float32 precision is plenty. worldPosition() gives a place
// in the space of the current frame; content that must survive the globe
// to mercator morph rebuilds itself when onGlobe changes.

export class MapLibreLayer {

	constructor( { id = 'three', scene = new Scene(), lng = 0, lat = 0, altitude = 0, space = 'local', terrain = true } = {} ) {

		// the maplibre-gl CustomLayerInterface
		this.id = id;
		this.type = 'custom';
		this.renderingMode = '3d'; // share MapLibre's depth buffer

		this.scene = scene;
		this.camera = new PerspectiveCamera(); // its projection is set every frame
		this.map = null;
		this.renderer = null;
		this.space = space;
		this.terrain = terrain; // follow the map's terrain, when it has one

		this._anchor = { lng, lat, altitude };
		this.elevation = 0; // terrain under the anchor, meters, as last asked
		this._placed = []; // objects standing at a place, settled every frame
		// the clip matrix of the last frame and the transition it was built
		// for, for anyone checking where the scene lands
		this.lastProjection = { matrix: new Matrix4(), transition: 0 };

	}

	// Globe or flat, as of the last frame: which space worldPosition speaks.
	get onGlobe() {

		return this.lastProjection.transition >= 0.5;

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

		if ( this.space === 'local' ) {

			this.elevation = this.terrainElevation( this._anchor.lng, this._anchor.lat );
			this._settle();

		}

		this.projectionFor( args.defaultProjectionData, this.camera.projectionMatrix );
		this.camera.projectionMatrixInverse.copy( this.camera.projectionMatrix ).invert();

		this.renderer.resetState(); // MapLibre left the GL state as it likes it
		this.renderer.render( this.scene, this.camera );

	}

	// The terrain under a place, in meters, as the map draws it (exaggeration
	// included); 0 without terrain, or before its tiles have landed there.
	terrainElevation( lng, lat ) {

		if ( ! this.terrain || ! this.map ) return 0;
		return this.map.queryTerrainElevation( [ lng, lat ] ) ?? 0;

	}

	// Scene units at the anchor to clip space, for MapLibre's projection data.
	// In local space the anchor stands at its altitude plus the terrain under
	// it; in world space the scene is already in MapLibre's units.
	projectionFor( data, target ) {

		const transition = data.projectionTransition ?? 0;

		if ( this.space === 'world' ) {

			// mainMatrix is the globe's past the midpoint of the morph and
			// the flat map's before it; the fallback is the flat one while
			// the globe is being drawn
			target.fromArray( transition > 0 && transition < 0.5 ? data.fallbackMatrix : data.mainMatrix );
			this.lastProjection.matrix.copy( target );
			this.lastProjection.transition = transition;
			return target;

		}

		const { lng, lat } = this._anchor;
		const altitude = this._anchor.altitude + this.elevation;

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

	// A place in world space, as of the current frame: mercator on the flat
	// map, a point on the unit sphere on the globe, altitude in meters
	// either way.
	worldPosition( lng, lat, altitude = 0, target = new Vector3() ) {

		if ( this.onGlobe ) {

			const l = lng * Math.PI / 180, f = lat * Math.PI / 180;
			const k = 1 + altitude / MAPLIBRE_EARTH_RADIUS;
			return target.set( Math.sin( l ) * Math.cos( f ) * k, Math.sin( f ) * k, Math.cos( l ) * Math.cos( f ) * k );

		}

		return target.set( mercatorX( lng ), mercatorY( lat ), altitude * mercatorUnitsPerMeter( lat ) );

	}

	// A three.js object standing at a place, heading in degrees clockwise
	// from north as MapAnchor takes it. It is settled every frame: on the
	// terrain under it once the map has one, at its altitude above that.
	place( object, lng, lat, altitude = 0, heading = 0 ) {

		const entry = this._placed.find( p => p.object === object ) ?? ( this._placed.push( { object } ), this._placed[ this._placed.length - 1 ] );
		Object.assign( entry, { lng, lat, altitude, heading } );
		object.rotation.set( 0, - heading * Math.PI / 180, 0 );
		this._settleOne( entry );
		return object;

	}

	// Forgets a placed object; the object itself stays where it is.
	unplace( object ) {

		const i = this._placed.findIndex( p => p.object === object );
		if ( i !== - 1 ) this._placed.splice( i, 1 );
		return object;

	}

	_settle() {

		for ( const entry of this._placed ) this._settleOne( entry );

	}

	// An object stands at its own ground, not the anchor's: the frame's
	// origin already sits at the anchor's elevation, so the difference is
	// what to add.
	_settleOne( { object, lng, lat, altitude } ) {

		this.localFromLngLat( lng, lat, altitude, _local );
		if ( this.space === 'local' ) _local.y += this.terrainElevation( lng, lat ) - this.elevation;
		object.position.copy( _local );

	}

}
