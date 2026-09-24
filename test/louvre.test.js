import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { createGeoJSONVectorSource } from '../demo/geojson-vector-source.js';
import { LOUVRE_STYLE } from '../demo/louvre-style.js';
import { buildTile } from '../src/build/buildTile.js';
import { decodeVectorTile } from '../src/core/decodeVectorTile.js';
import { Style } from '../src/style/Style.js';
import { latitudeToNormalized, longitudeToNormalized } from '../src/math/WebMercator.js';

// The committed Louvre extract, cut into tiles the way the demo does it.
const { layers, meta } = JSON.parse( readFileSync( new URL( '../demo/data/louvre.json', import.meta.url ) ) );
const { source, tile } = createGeoJSONVectorSource( layers, { maxZoom: 16 } );
const style = new Style( LOUVRE_STYLE );

const LAT = 48.8606, LON = 2.3376;
const tileAt = z => [ Math.floor( longitudeToNormalized( LON ) * 2 ** z ), Math.floor( latitudeToNormalized( LAT ) * 2 ** z ), z ];

function build( z ) {

	const [ x, y ] = tileAt( z );
	const decoded = decodeVectorTile( tile( z, x, y ) );
	return { decoded, built: buildTile( decoded, style, { sourceId: 'openmaptiles', x, y, z, mode: 'planar' } ) };

}

describe( 'Louvre extract', () => {

	it( 'carries the layers and license the demo relies on', () => {

		expect( meta.license ).toMatch( /ODbL/ );
		expect( Object.keys( layers ) ).toEqual( expect.arrayContaining( [ 'building', 'transportation', 'water', 'park', 'landuse', 'place' ] ) );
		const parts = layers.building.features.filter( f => f.properties[ 'building:part' ] );
		expect( parts.length ).toBeGreaterThan( 400 );
		expect( parts.every( f => typeof f.properties.render_height === 'number' ) ).toBe( true );
		// outlines that have parts are flagged, so the 3D layer draws the parts only
		expect( layers.building.features.some( f => f.properties.hide_3d ) ).toBe( true );

	} );

	it( 'serves data-URL tiles with the building layer down to z13', () => {

		for ( const z of [ 13, 14, 15, 16 ] ) {

			const [ x, y ] = tileAt( z );
			expect( source.tileUrl( x, y, z ).length ).toBeGreaterThan( 100 );
			const decoded = decodeVectorTile( tile( z, x, y ) );
			expect( decoded.layers.building.featureCount ).toBeGreaterThan( 20 );

		}

	} );

	it( 'builds footprints, outlines and extrusions for the palace', () => {

		const flat = build( 13 ).built;
		const ids = flat.blocks.map( b => `${ b.id }:${ b.type }` );
		expect( ids ).toContain( 'building:fill' );
		expect( ids ).toContain( 'building:line' ); // the outline
		expect( ids ).toContain( 'building-3d:fill-extrusion' );
		expect( ids ).toContain( 'road:line' );
		expect( ids ).toContain( 'water:fill' );

		const { built } = build( 15 );
		const extrusion = built.blocks.find( b => b.id === 'building-3d' );
		expect( extrusion ).toBeDefined();
		expect( extrusion.features ).toBeGreaterThan( 50 );
		// the palace parts are tall: some roof higher than 15 m
		let top = 0;
		for ( let i = 1; i < extrusion.positions.length; i += 3 ) top = Math.max( top, extrusion.positions[ i ] );
		expect( top ).toBeGreaterThan( 15 );

	} );

} );
