import { Group, Matrix4, Vector3 } from 'three';
import { latLonToEcef, localFrame } from '../math/Ellipsoid.js';
import { latitudeToNormalized, longitudeToNormalized, normalizedToMeters } from '../math/WebMercator.js';

const _east = new Vector3();
const _north = new Vector3();
const _up = new Vector3();
const _south = new Vector3();
const _basis = new Matrix4();

// A Group standing on the map at a geographic location: its children live in
// a local frame with x east, y up and -z north, in meters, whatever the map
// mode, so a three.js object built the usual way (y up, facing -z) stands
// level and faces north on the globe as on the plane. Add it to the scene
// next to the map, like the map itself:
//
//   const antenna = new MapAnchor( { mode: 'globe' } ).setLocation( 48.8606, 2.3376, 0 );
//   antenna.add( gltf.scene );
//   scene.add( map, antenna );
//
// heading turns the object clockwise from north, as a MapControls heading.

export class MapAnchor extends Group {

	constructor( { mode = 'globe' } = {} ) {

		super();
		this.mode = mode;
		this.lat = 0;
		this.lon = 0;
		this.height = 0;
		this.heading = 0;

	}

	/** Place the anchor; height in meters above the ground (the ellipsoid, or the plane), heading in degrees clockwise from north. */
	setLocation( lat, lon, height = 0, heading = 0 ) {

		this.lat = lat;
		this.lon = lon;
		this.height = height;
		this.heading = heading;

		if ( this.mode === 'planar' ) {

			const [ mx, my ] = normalizedToMeters( longitudeToNormalized( lon ), latitudeToNormalized( lat ) );
			this.position.set( mx, height, - my );
			this.quaternion.identity();

		} else {

			latLonToEcef( lat, lon, height, this.position );
			localFrame( lat, lon, _east, _north, _up );
			_south.copy( _north ).negate();
			_basis.makeBasis( _east, _up, _south );
			this.quaternion.setFromRotationMatrix( _basis );

		}

		if ( heading !== 0 ) this.rotateY( - heading * Math.PI / 180 );
		this.updateMatrixWorld();
		return this;

	}

}
