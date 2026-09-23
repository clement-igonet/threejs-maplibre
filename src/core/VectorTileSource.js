import { XYZTileSource } from './XYZTileSource.js';

// A Mapbox Vector Tile (MVT) source: same url template and zoom range as a
// raster source, plus the tile extent hint and a TileJSON constructor, since
// MapLibre styles usually point at a TileJSON document rather than at a tile
// template. Schema (OpenMapTiles, Shortbread) is not a property of the
// source: the style decides which source layers and attributes it reads.

export class VectorTileSource extends XYZTileSource {

	constructor( { maxZoom = 14, extent = 4096, ...options } = {} ) {

		super( { maxZoom, ...options } );
		this.type = 'vector';
		this.extent = extent;

	}

	// Builds a source from a TileJSON document (https://github.com/mapbox/tilejson-spec):
	// the first url template, the zoom range and the attribution are read from it.
	static fromTileJSON( json, options = {} ) {

		if ( ! json || ! Array.isArray( json.tiles ) || json.tiles.length === 0 ) {

			throw new Error( 'VectorTileSource.fromTileJSON: no "tiles" url template in TileJSON.' );

		}

		return new VectorTileSource( {
			url: json.tiles[ 0 ],
			minZoom: json.minzoom ?? 0,
			maxZoom: json.maxzoom ?? 14,
			attribution: json.attribution ?? '',
			...options,
		} );

	}

	static async loadTileJSON( url, options = {} ) {

		const response = await fetch( url );
		if ( ! response.ok ) {

			throw new Error( `VectorTileSource.loadTileJSON: HTTP ${ response.status } for ${ url }` );

		}

		return VectorTileSource.fromTileJSON( await response.json(), options );

	}

}

// OpenFreeMap serves the OpenMapTiles schema for the whole planet without an
// API key (https://openfreemap.org). Its tile url carries a dated path, so
// the source is resolved from the TileJSON document at run time.
export const OPENFREEMAP_TILEJSON_URL = 'https://tiles.openfreemap.org/planet';

export function loadOpenFreeMapSource( options = {} ) {

	return VectorTileSource.loadTileJSON( OPENFREEMAP_TILEJSON_URL, {
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="https://openfreemap.org">OpenFreeMap</a>',
		...options,
	} );

}
