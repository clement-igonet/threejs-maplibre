import { Style, VectorTileSource, loadOpenFreeMapSource } from '../src/index.js';
import { createGeoJSONVectorSource } from './geojson-vector-source.js';
import { createStubVectorSource } from './stub-vector-tiles.js';
import { LOUVRE_STYLE } from './louvre-style.js';
import { STUB_STYLE } from './stub-style.js';

// The vector data behind the demo pages, from the URL parameters:
//   ?data=louvre (default, offline extract) | stub (synthetic city) | openfreemap (live planet tiles)
//   ?style=<url> replaces the style (openfreemap defaults to its Liberty style)
// Resolves to { source, style, sourceId, view: { lat, lon } }, plus the
// extract's tile( z, x, y ) cutter for the Louvre (the bench feeds it to
// maplibre-gl-js too).

export const LOUVRE = { lat: 48.8606, lon: 2.3376 };
export const STUB = { lat: 48.8566, lon: 2.3522 };

export async function loadVectorData( params ) {

	const data = params.get( 'data' ) ?? 'louvre';

	if ( data === 'stub' ) {

		return { source: createStubVectorSource(), style: new Style( STUB_STYLE ), view: STUB };

	}

	if ( data === 'openfreemap' ) {

		const styleUrl = params.get( 'style' ) ?? 'https://tiles.openfreemap.org/styles/liberty';
		const style = await Style.load( styleUrl );
		const sourceId = Object.keys( style.sources )[ 0 ];
		const tilejson = style.sources[ sourceId ].url;
		const source = tilejson ? await VectorTileSource.loadTileJSON( tilejson ) : await loadOpenFreeMapSource();
		return { source, style, sourceId, view: LOUVRE };

	}

	const response = await fetch( new URL( './data/louvre.json', import.meta.url ) );
	const { meta, layers } = await response.json();
	const { source, tile } = createGeoJSONVectorSource( layers, {
		maxZoom: 16,
		attribution: `<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (${ meta.osm_base.slice( 0, 10 ) })`,
	} );
	const style = params.has( 'style' ) ? await Style.load( params.get( 'style' ) ) : new Style( LOUVRE_STYLE );
	return { source, style, view: LOUVRE, tile };

}
