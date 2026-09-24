import { Color, DoubleSide, ShaderMaterial, Vector3 } from 'three';

// Screen-space line material for the strips built by build/buildLines.js.
// Each vertex holds its position on the line, the tangent direction to
// extrude along and its side; the vertex shader moves it by half the width
// in pixels, converted to local units at the vertex's depth. Widths, gaps and
// offsets come out as baked attribute * uniform (see build/buildTile.js), so
// a zoom-dependent width costs a uniform update, not a rebuild. Edges are
// antialiased in the fragment shader; lines thinner than a pixel are drawn
// one pixel wide and faded, as MapLibre does.

const vertexShader = /* glsl */`
attribute vec3 extrude;
attribute vec2 lineSide;   // side (-1, 1), gap strip (-1, 0, 1)
attribute vec3 lineProps;  // baked width, gap, offset
attribute vec4 lineColor;

uniform float pixelScale;  // local units per pixel at unit depth
uniform vec3 propScale;    // uniform width, gap, offset (px)
uniform vec3 diffuse;

varying vec4 vColor;
varying float vSide;
varying float vCover;

void main() {

	vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
	vec3 mvExtrude = ( modelViewMatrix * vec4( extrude, 0.0 ) ).xyz;

	vec3 props = lineProps * propScale;
	float width = max( props.x, 1.0 );
	vCover = props.x / width;
	float halfWidth = 0.5 * width;
	// line-offset is positive to the right of the line, our side +1 is its left
	float shift = - props.z + lineSide.y * ( 0.5 * props.y + halfWidth );

	float pxToLocal = - mvPosition.z * pixelScale;
	mvPosition.xyz += mvExtrude * ( lineSide.x * halfWidth + shift ) * pxToLocal;

	gl_Position = projectionMatrix * mvPosition;
	vSide = lineSide.x;
	vColor = vec4( lineColor.rgb * diffuse, lineColor.a );

}
`;

const fragmentShader = /* glsl */`
uniform float opacity;

varying vec4 vColor;
varying float vSide;
varying float vCover;

void main() {

	float d = abs( vSide );
	float aa = fwidth( d );
	float edge = 1.0 - smoothstep( 1.0 - aa, 1.0, d );
	gl_FragColor = vec4( vColor.rgb, vColor.a * opacity * vCover * edge );

	#include <colorspace_fragment>

}
`;

export class VectorLineMaterial extends ShaderMaterial {

	constructor() {

		super( {
			uniforms: {
				pixelScale: { value: 0.001 },
				propScale: { value: new Vector3( 1, 1, 1 ) },
				diffuse: { value: new Color( 1, 1, 1 ) },
				opacity: { value: 1 },
			},
			vertexShader,
			fragmentShader,
			transparent: true,
			depthWrite: false,
			side: DoubleSide,
		} );

		this.isVectorLineMaterial = true;

	}

	get color() {

		return this.uniforms.diffuse.value;

	}

	// three keeps material.opacity for sorting; mirror it into the uniform
	set opacity( value ) {

		if ( this.uniforms ) this.uniforms.opacity.value = value;
		this._opacity = value;

	}

	get opacity() {

		return this._opacity ?? 1;

	}

}
