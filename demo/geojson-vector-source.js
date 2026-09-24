// A vector tile source cut from GeoJSON in the browser: one geojson-vt index
// per source layer, encoded to MVT with vt-pbf at request time and served as
// data URLs, so the whole loading path (fetch, Worker decode, build) runs
// without a tile host. The stub city and the Louvre extract both go through
// it; a real deployment would pre-tile the data instead.

import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import { VectorTileSource } from '../src/index.js';

const EXTENT = 4096;
const EMPTY_TILE = 'data:application/x-protobuf;base64,';

function toDataUrl( bytes ) {

	let binary = '';
	for ( let i = 0; i < bytes.length; i ++ ) binary += String.fromCharCode( bytes[ i ] );
	return `data:application/x-protobuf;base64,${ btoa( binary ) }`;

}

// layers: { name: FeatureCollection }; returns { tile( z, x, y ), source }
export function createGeoJSONVectorSource( layers, {
	minZoom = 0,
	maxZoom = 16,
	attribution = '',
	tolerance = 1,
	buffer = 64,
	url = 'geojson://{z}/{x}/{y}.pbf',
} = {} ) {

	const indexes = {};
	for ( const name in layers ) {

		indexes[ name ] = geojsonvt( layers[ name ], { maxZoom, indexMaxZoom: Math.min( maxZoom, 10 ), tolerance, extent: EXTENT, buffer } );

	}

	const cache = new Map();

	// The MVT bytes of a tile, or null when no layer covers it.
	function tile( z, x, y ) {

		const key = `${ z }/${ x }/${ y }`;
		if ( cache.has( key ) ) return cache.get( key );

		const tileLayers = {};
		let any = false;
		for ( const name in indexes ) {

			const t = indexes[ name ].getTile( z, x, y );
			if ( t && t.features.length ) {

				tileLayers[ name ] = t;
				any = true;

			}

		}

		const bytes = any ? vtpbf.fromGeojsonVt( tileLayers, { version: 2, extent: EXTENT } ) : null;
		cache.set( key, bytes );
		return bytes;

	}

	const source = new VectorTileSource( { url, minZoom, maxZoom, attribution } );
	source.tileUrl = ( x, y, z ) => {

		const bytes = tile( z, x, y );
		return bytes ? toDataUrl( bytes ) : EMPTY_TILE;

	};

	return { source, tile };

}
