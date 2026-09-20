// Deterministic offline tile source for CI screenshots, benchmarks and local
// testing: every tile is a canvas-rendered PNG data URL labeled with its
// coordinates, so no real tile host is contacted and renders are reproducible.
// (PNG rather than SVG: Chrome's createImageBitmap does not decode SVG blobs.)

import { XYZTileSource } from '../src/index.js';

const PALETTE = [ '#264653', '#2a9d8f', '#e9c46a', '#f4a261', '#e76f51' ];

let canvas = null;
let ctx = null;
const cache = new Map();

export function stubTileDataUrl( z, x, y ) {

	const key = `${ z }/${ x }/${ y }`;
	if ( cache.has( key ) ) return cache.get( key );

	if ( ! canvas ) {

		canvas = document.createElement( 'canvas' );
		canvas.width = canvas.height = 256;
		ctx = canvas.getContext( '2d' );

	}

	ctx.fillStyle = PALETTE[ ( x + y + z ) % PALETTE.length ];
	ctx.fillRect( 0, 0, 256, 256 );
	ctx.strokeStyle = 'rgba(255,255,255,0.6)';
	ctx.lineWidth = 2;
	ctx.strokeRect( 1, 1, 254, 254 );
	ctx.fillStyle = '#fff';
	ctx.font = '28px monospace';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( key, 128, 128 );

	const url = canvas.toDataURL( 'image/png' );
	cache.set( key, url );
	return url;

}

export function createStubSource( options = {} ) {

	const source = new XYZTileSource( {
		url: 'stub://{z}/{x}/{y}',
		maxZoom: 19,
		attribution: 'stub tiles',
		...options,
	} );

	source.tileUrl = ( x, y, z ) => stubTileDataUrl( z, x, y );

	return source;

}
