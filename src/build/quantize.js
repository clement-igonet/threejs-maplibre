// Line attributes are stored as normalized Int16: the value read in the
// shader is the stored one divided by 32767 and multiplied back by the scale,
// so these bound what a line vertex can carry. An extrude is a direction
// whose length is the miter length (line-miter-limit, 2 by default), and a
// baked property is a width, gap or offset in pixels.
export const EXTRUDE_SCALE = 8;
export const PROPS_SCALE = 1024;

export function quantize( values, scale ) {

	const out = new Int16Array( values.length );
	for ( let i = 0; i < values.length; i ++ ) out[ i ] = Math.max( - 32767, Math.min( 32767, Math.round( values[ i ] / scale * 32767 ) ) );
	return out;

}
