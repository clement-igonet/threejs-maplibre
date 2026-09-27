import { Matrix4, PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { globeFrame, mercatorFrame } from './MapLibreFrames.js';

const _frame = new Matrix4();

// A three.js scene drawn inside a maplibre-gl map, as a custom layer, with
// the map's own camera: the other direction from the rest of this library,
// where the map is drawn inside a three.js scene.
//
//   const layer = new MapLibreLayer( { lng: 2.3359, lat: 48.8610 } );
//   layer.scene.add( model ); // meters, x east, y up, -z north
//   map.addLayer( layer );
//
// The scene lives in meters around an anchor. Every frame, MapLibre hands
// the layer its projection as 64-bit matrices; the layer multiplies the one
// that applies by the matrix from the anchor's frame into MapLibre's space
// (MapLibreFrames.js), still in float64, and gives three.js the product as
// the camera's projection. The anchor's world coordinates never reach the
// GPU, only offsets of a few hundred meters do, so a building-scale scene
// holds still at street level.
//
// Which space depends on the map. Under mercator, MapLibre projects mercator
// coordinates. Its globe is a unit sphere up to zoom 11, flat mercator from
// zoom 12, and a blend of the two in between (projectionTransition going
// from 1 to 0); the layer follows whichever side dominates.

export class MapLibreLayer {

	constructor( { id = 'three', scene = new Scene(), lng = 0, lat = 0, altitude = 0 } = {} ) {

		// the maplibre-gl CustomLayerInterface
		this.id = id;
		this.type = 'custom';
		this.renderingMode = '3d'; // share MapLibre's depth buffer

		this.scene = scene;
		this.camera = new PerspectiveCamera(); // its projection is set every frame
		this.anchor = { lng, lat, altitude };

		this.map = null;
		this.renderer = null;
		// the clip matrix of the last frame and the transition it was built
		// for, for anyone checking where the scene lands
		this.lastProjection = { matrix: new Matrix4(), transition: 0 };

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

		const { lng, lat, altitude } = this.anchor;
		const transition = data.projectionTransition ?? 0;

		if ( transition >= 0.5 ) {

			globeFrame( lng, lat, altitude, _frame );
			target.fromArray( data.mainMatrix ).multiply( _frame );

		} else {

			mercatorFrame( lng, lat, altitude, _frame );
			// under a globe map past zoom 12 the mercator matrix is the fallback
			target.fromArray( transition > 0 ? data.fallbackMatrix : data.mainMatrix ).multiply( _frame );

		}

		this.lastProjection.matrix.copy( target );
		this.lastProjection.transition = transition;
		return target;

	}

}
