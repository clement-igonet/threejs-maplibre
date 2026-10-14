// The sky and the hour for a walk: three's Sky (the Preetham model) with
// the sun where it stands over the place at that time, a directional
// light from it with one shadow map round the character, a hemisphere
// light for the rest, and colours for the fog and the backdrop that
// follow the sun down and up. What a map renderer has no place for:
// shadows that move with the hour, and a night.
//
//   const day = new DayNight( root, { latitude, longitude } );
//   day.setTime( date );          // where the sun is now
//   day.follow( position );       // every frame: the sky and the shadow round here
//   day.fogColor, day.daylight    // for the scene's fog and backdrop

import { Color, DirectionalLight, HemisphereLight, Vector3 } from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { sunPosition } from '../src/game/sun.js';

const DAY_FOG = new Color( 0xdfe6ec ), DUSK_FOG = new Color( 0xe0a070 ), NIGHT_FOG = new Color( 0x0c1020 );
const DAY_SKY = new Color( 0xdde8f2 ), NIGHT_SKY = new Color( 0x56688a );
const INDOOR = new Color( 0xf4f1ea ); // the station's own light, from nowhere in particular
const DAY_GROUND = new Color( 0x8a8478 ), NIGHT_GROUND = new Color( 0x3a3830 );
const _dir = new Vector3();

export class DayNight {

	constructor( parent, { latitude, longitude, shadowSize = 2048, shadowRadius = 110 } = {} ) {


		this.latitude = latitude;
		this.longitude = longitude;
		this.sky = new Sky();
		this.sky.scale.setScalar( 4000 );
		const u = this.sky.material.uniforms;
		u.turbidity.value = 3;
		u.rayleigh.value = 1.2;
		u.mieCoefficient.value = 0.005;
		u.mieDirectionalG.value = 0.8;
		parent.add( this.sky );

		this.sun = new DirectionalLight( 0xffffff, 2 );
		this.sun.castShadow = true;
		this.sun.shadow.mapSize.set( shadowSize, shadowSize );
		const c = this.sun.shadow.camera;
		c.left = - shadowRadius; c.right = shadowRadius; c.top = shadowRadius; c.bottom = - shadowRadius;
		c.near = 1; c.far = 900;
		this.sun.shadow.bias = - 0.0004;
		this.sun.shadow.normalBias = 0.05;
		parent.add( this.sun, this.sun.target );

		this.hemisphere = new HemisphereLight( DAY_SKY, DAY_GROUND, 1 );
		parent.add( this.hemisphere );

		this.fogColor = new Color( DAY_FOG );
		this.daylight = 1;
		this.sunIntensity = 2;
		this.hemisphereIntensity = 1.15;
		this.skyColor = new Color( DAY_SKY );
		this.altitude = 0;
		this.azimuth = 0;
		this.direction = new Vector3( 0, 1, 0 ); // towards the sun

	}

	setTime( date ) {

		const { altitude, azimuth } = sunPosition( date, this.latitude, this.longitude );
		this.altitude = altitude;
		this.azimuth = azimuth;
		// x east, y up, z south (the planar frame): north is -z
		this.direction.set( Math.cos( altitude ) * Math.sin( azimuth ), Math.sin( altitude ), - Math.cos( altitude ) * Math.cos( azimuth ) );
		this.sky.material.uniforms.sunPosition.value.copy( this.direction );
		// daylight: full with the sun 10 degrees up, gone 6 degrees under
		// (civil twilight), eased between; a dusk tint while it is low
		const t = Math.min( 1, Math.max( 0, ( altitude / Math.PI * 180 + 6 ) / 16 ) );
		const daylight = t * t * ( 3 - 2 * t );
		this.daylight = daylight;
		const dusk = Math.max( 0, 1 - Math.abs( altitude / Math.PI * 180 ) / 8 ) * 0.6;
		this.fogColor.lerpColors( NIGHT_FOG, DAY_FOG, daylight ).lerp( DUSK_FOG, dusk );
		this.sunIntensity = 2.0 * daylight;
		this.sun.intensity = this.sunIntensity;
		this.sun.color.setRGB( 1, 0.86 + 0.14 * t, 0.7 + 0.3 * t );
		this.sun.visible = daylight > 0.01;
		// a night keeps half the hemisphere light, a city's glow: the streets
		// stay readable, which a true night would not be
		this.hemisphereIntensity = 0.7 + 0.45 * daylight;
		this.hemisphere.intensity = this.hemisphereIntensity;
		this.skyColor = this.hemisphere.color.lerpColors( NIGHT_SKY, DAY_SKY, daylight ).clone();
		this.hemisphere.groundColor.lerpColors( NIGHT_GROUND, DAY_GROUND, daylight );
		return this;

	}

	// how far underground the view is, 0 to 1: the sun fades out (its
	// shadows would be the buildings' above), the sky hides, and the
	// station's own light comes up, the hemisphere light brightened and
	// whitened, so the halls are as readable as the street
	underground( amount ) {

		this.sun.intensity = this.sunIntensity * ( 1 - amount );
		this.sky.visible = amount < 0.5;
		this.hemisphere.intensity = this.hemisphereIntensity * ( 1 - amount ) + 1.6 * amount;
		this.hemisphere.color.lerpColors( this.skyColor, INDOOR, amount );
		return this;

	}

	// the sky and the sun's shadow box round a point (the character)
	follow( position ) {

		this.sky.position.copy( position );
		this.sun.target.position.copy( position );
		this.sun.position.copy( position ).addScaledVector( this.direction, 400 );
		return this;

	}

}
