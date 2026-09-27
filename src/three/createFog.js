import { Color, Fog, SRGBColorSpace } from 'three';
import { Color as SpecColor } from '@maplibre/maplibre-gl-style-spec';

// Haze for a view that ends before the horizon does. A view distance
// (TileTree's viewDistance) stops the map at a given range, which is what a
// street, a tunnel or a room wants; without fog the map would simply stop in
// mid air, so the geometry fades into the same colour the sky has there.
//
// The colour comes from the style when it has one. MapLibre keeps the sky as
// a root property of the style document rather than a layer, and its
// fog-color is exactly this: what the ground blends into towards the
// horizon. Failing that, the background layer's colour, which is what fills
// the frame behind everything anyway.
//
//   scene.fog = createFog( style, { viewDistance: 800 } );
//   scene.background = scene.fog.color;
//
// The result is a plain three.js Fog, so it can be replaced, tuned or
// dropped by the application.

export function createFog( style, { viewDistance, start = 0.6, color = null } = {} ) {

	if ( ! Number.isFinite( viewDistance ) ) throw new Error( 'createFog: viewDistance must be a distance in meters' );

	return new Fog( color !== null ? new Color( color ) : fogColor( style ), start * viewDistance, viewDistance );

}

// The style's fog colour, its sky horizon colour, its background, white.
function fogColor( style ) {

	const sky = style?.sky ?? null;
	const value = sky?.[ 'fog-color' ] ?? sky?.[ 'horizon-color' ] ?? null;
	const parsed = typeof value === 'string' ? SpecColor.parse( value ) : null;
	// .rgb, not .r/.g/.b: the style spec premultiplies those by the alpha
	if ( parsed ) {

		const [ r, g, b ] = parsed.rgb;
		return new Color().setRGB( r, g, b, SRGBColorSpace );

	}

	const background = style?.backgroundLayer ?? null;
	if ( background ) {

		const [ r, g, b ] = background.get( 'background-color', 14 ).rgb;
		return new Color().setRGB( r, g, b, SRGBColorSpace );

	}

	return new Color( 0xffffff );

}
