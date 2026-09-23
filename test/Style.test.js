import { afterEach, describe, expect, it, vi } from 'vitest';
import { Style, StyleLayer } from '../src/style/Style.js';
import { STUB_STYLE } from '../demo/stub-style.js';

const polygon = ( properties = {} ) => ( { type: 3, properties } );
const line = ( properties = {} ) => ( { type: 2, properties } );

describe( 'Style', () => {

	afterEach( () => vi.restoreAllMocks() );

	it( 'requires a version 8 style', () => {

		expect( () => new Style( { version: 7, layers: [] } ) ).toThrow( /version/ );

	} );

	it( 'parses the stub style, only deferring its symbol layer', () => {

		const style = new Style( STUB_STYLE );
		expect( style.warnings ).toEqual( [ 'layer "place-city": symbol layers are parsed, not rendered yet' ] );
		expect( style.layers.map( l => l.id ) ).toEqual( [ 'background', 'park', 'water', 'road-residential', 'road-major', 'building-3d', 'place-city' ] );
		expect( style.sources.openmaptiles.tiles ).toEqual( [ 'stub://{z}/{x}/{y}.pbf' ] );
		expect( style.backgroundLayer.get( 'background-color', 10 ).rgb ).toEqual( [ 0.9490196078431372, 0.9372549019607843, 0.9137254901960784, 1 ] );

	} );

	it( 'lists rendered layers per source and source layer, in style order', () => {

		const style = new Style( STUB_STYLE );
		expect( style.layersForSource( 'openmaptiles' ).map( l => l.id ) ).toEqual( [ 'park', 'water', 'road-residential', 'road-major', 'building-3d', 'place-city' ] );
		expect( style.layersForSource( 'openmaptiles', 'transportation' ).map( l => l.id ) ).toEqual( [ 'road-residential', 'road-major' ] );
		expect( style.layersForSource( 'other' ) ).toEqual( [] );

	} );

	it( 'applies filters, zoom range and visibility', () => {

		const style = new Style( STUB_STYLE );
		const water = style.layers.find( l => l.id === 'water' );
		expect( water.matches( 10, polygon( { class: 'river' } ) ) ).toBe( true );
		expect( water.matches( 10, line( { class: 'river' } ) ) ).toBe( false );

		const residential = style.layers.find( l => l.id === 'road-residential' );
		expect( residential.matches( 14, line( { class: 'residential' } ) ) ).toBe( true );
		expect( residential.matches( 11.9, line( { class: 'residential' } ) ) ).toBe( false );
		expect( residential.matches( 14, line( { class: 'primary' } ) ) ).toBe( false );

		const hidden = new StyleLayer( { id: 'h', type: 'fill', layout: { visibility: 'none' } } );
		expect( hidden.visible ).toBe( false );
		expect( hidden.matches( 10, polygon() ) ).toBe( false );

	} );

	it( 'evaluates zoom and data driven properties like MapLibre', () => {

		const style = new Style( STUB_STYLE );
		const major = style.layers.find( l => l.id === 'road-major' );
		expect( major.kind( 'line-width' ) ).toBe( 'camera' );
		expect( major.get( 'line-width', 8 ) ).toBeCloseTo( 0.5 );
		expect( major.get( 'line-width', 18 ) ).toBeCloseTo( 24 );
		const mid = major.get( 'line-width', 13 );
		expect( mid ).toBeGreaterThan( 0.5 );
		expect( mid ).toBeLessThan( 24 );

		expect( major.kind( 'line-color' ) ).toBe( 'source' );
		expect( major.get( 'line-color', 13, line( { class: 'primary' } ) ).rgb ).toEqual( [ 0.9882352941176471, 0.8392156862745098, 0.6431372549019608, 1 ] );
		expect( major.get( 'line-color', 13, line( { class: 'secondary' } ) ).rgb[ 0 ] ).toBeCloseTo( 0.9686, 3 );

		const buildings = style.layers.find( l => l.id === 'building-3d' );
		expect( buildings.get( 'fill-extrusion-height', 15, polygon( { render_height: 32 } ) ) ).toBe( 32 );
		expect( buildings.get( 'fill-extrusion-height', 15, polygon( {} ) ) ).toBe( 0 );
		expect( buildings.get( 'fill-extrusion-opacity', 15 ) ).toBe( 0.9 );
		// legacy zoom stops still work
		const stops = new StyleLayer( { id: 's', type: 'line', paint: { 'line-width': { stops: [ [ 10, 1 ], [ 16, 4 ] ] } } } );
		expect( stops.get( 'line-width', 13 ) ).toBeCloseTo( 2.5 );

	} );

	it( 'falls back to the spec default for properties the style does not set', () => {

		const layer = new StyleLayer( { id: 'f', type: 'fill' } );
		expect( layer.has( 'fill-opacity' ) ).toBe( false );
		expect( layer.get( 'fill-opacity', 10 ) ).toBe( 1 );
		expect( layer.get( 'fill-color', 10 ) ).toBe( '#000000' );
		expect( layer.kind( 'fill-color' ) ).toBe( 'constant' );
		expect( new StyleLayer( { id: 'l', type: 'line' } ).get( 'line-join', 10 ) ).toBe( 'miter' );

	} );

	it( 'warns once per layer about what it ignores and keeps the layer', () => {

		const style = new Style( {
			version: 8,
			sources: { osm: { type: 'vector', url: 'https://example.com/tiles.json' }, hills: { type: 'raster-dem', url: 'x' } },
			layers: [
				{ id: 'dashed', type: 'line', source: 'osm', 'source-layer': 'transportation', paint: { 'line-color': '#000', 'line-dasharray': [ 2, 1 ], 'line-blur': 1 } },
				{ id: 'dots', type: 'circle', source: 'osm', 'source-layer': 'poi', paint: { 'circle-radius': 3 } },
				{ id: 'copy', ref: 'dashed', paint: { 'line-color': '#fff' } },
			],
		} );
		expect( style.warnings ).toEqual( [
			'source "hills": type "raster-dem" is not supported',
			'layer "dashed": ignored line-dasharray, line-blur',
			'layer "dots": type "circle" is not rendered',
		] );
		expect( style.layers.length ).toBe( 3 );
		expect( style.layers[ 0 ].ignored ).toEqual( [ 'line-dasharray', 'line-blur' ] );
		expect( style.layersForSource( 'osm' ).map( l => l.id ) ).toEqual( [ 'dashed', 'copy' ] );
		// ref layers inherit source, source-layer and filter, not paint
		expect( style.layers[ 2 ].sourceLayer ).toBe( 'transportation' );
		expect( style.layers[ 2 ].ignored ).toEqual( [] );
		expect( style.layers[ 2 ].get( 'line-color', 10 ).rgb ).toEqual( [ 1, 1, 1, 1 ] );
		expect( style.sources.osm.url ).toBe( 'https://example.com/tiles.json' );

	} );

	it( 'loads a style document', async () => {

		vi.spyOn( globalThis, 'fetch' ).mockResolvedValue( new Response( JSON.stringify( STUB_STYLE ) ) );
		const style = await Style.load( 'https://example.com/style.json' );
		expect( style.name ).toBe( 'stub' );
		expect( fetch ).toHaveBeenCalledWith( 'https://example.com/style.json' );

	} );

} );
