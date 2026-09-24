// Deterministic offline vector tile source for tests, CI screenshots and
// benchmarks: a synthetic city (road grid, river, parks, buildings, one
// place label) around Paris, cut into MVT tiles at request time (see
// geojson-vector-source.js), so no tile host is contacted and every run
// decodes the same bytes. Layer and attribute names follow the OpenMapTiles
// schema so a stock style renders it.

import { createGeoJSONVectorSource } from './geojson-vector-source.js';

export const STUB_CITY_CENTER = { lat: 48.8566, lon: 2.3522 };
const SIZE = 2400; // meters, square
const BLOCK = 200; // road spacing

// small deterministic generator so building heights and footprints are
// the same in every environment
function lcg( seed ) {

	let s = seed >>> 0;
	return () => {

		s = ( s * 1664525 + 1013904223 ) >>> 0;
		return s / 4294967296;

	};

}

function toLonLat( x, y ) {

	const lat = STUB_CITY_CENTER.lat + y / 111320;
	const lon = STUB_CITY_CENTER.lon + x / ( 111320 * Math.cos( STUB_CITY_CENTER.lat * Math.PI / 180 ) );
	return [ + lon.toFixed( 7 ), + lat.toFixed( 7 ) ];

}

function feature( geometry, properties, id ) {

	return { type: 'Feature', id, properties, geometry };

}

function rect( x0, y0, x1, y1 ) {

	return [ [ toLonLat( x0, y0 ), toLonLat( x1, y0 ), toLonLat( x1, y1 ), toLonLat( x0, y1 ), toLonLat( x0, y0 ) ] ];

}

// GeoJSON per source layer, in meters east/north of the center.
export function createStubCity() {

	const random = lcg( 42 );
	const half = SIZE / 2;
	const transportation = [];
	const building = [];
	const park = [];
	const water = [];
	const place = [];
	let id = 1;

	// road grid: primary every 800 m, secondary every 400 m, residential otherwise
	for ( let i = 0; i <= SIZE / BLOCK; i ++ ) {

		const c = - half + i * BLOCK;
		const cls = i % 4 === 0 ? 'primary' : i % 2 === 0 ? 'secondary' : 'residential';
		transportation.push( feature( { type: 'LineString', coordinates: [ toLonLat( c, - half ), toLonLat( c, half ) ] }, { class: cls, oneway: 0 }, id ++ ) );
		transportation.push( feature( { type: 'LineString', coordinates: [ toLonLat( - half, c ), toLonLat( half, c ) ] }, { class: cls, oneway: 0 }, id ++ ) );

	}

	// a river crossing the city with a bend, 60 m wide
	const bank = [];
	const other = [];
	for ( let x = - half - 200; x <= half + 200; x += 100 ) {

		const y = 300 * Math.sin( x / 600 ) - 200;
		bank.push( toLonLat( x, y - 30 ) );
		other.unshift( toLonLat( x, y + 30 ) );

	}

	water.push( feature( { type: 'Polygon', coordinates: [ [ ...bank, ...other, bank[ 0 ] ] ] }, { class: 'river' }, id ++ ) );

	// blocks: some become parks, the rest get buildings
	for ( let bx = 0; bx < SIZE / BLOCK; bx ++ ) {

		for ( let by = 0; by < SIZE / BLOCK; by ++ ) {

			const x0 = - half + bx * BLOCK + 15;
			const y0 = - half + by * BLOCK + 15;
			const x1 = x0 + BLOCK - 30;
			const y1 = y0 + BLOCK - 30;
			if ( ( bx * 7 + by * 3 ) % 11 === 0 ) {

				park.push( feature( { type: 'Polygon', coordinates: rect( x0, y0, x1, y1 ) }, { class: 'park' }, id ++ ) );
				continue;

			}

			for ( let i = 0; i < 4; i ++ ) {

				const w = 40 + random() * 60;
				const h = 40 + random() * 60;
				const x = x0 + random() * ( BLOCK - 30 - w );
				const y = y0 + random() * ( BLOCK - 30 - h );
				const height = Math.round( 6 + random() * 54 );
				building.push( feature( { type: 'Polygon', coordinates: rect( x, y, x + w, y + h ) }, { render_height: height, render_min_height: 0 }, id ++ ) );

			}

		}

	}

	place.push( feature( { type: 'Point', coordinates: toLonLat( 0, 0 ) }, { class: 'city', name: 'Stub City', rank: 1 }, id ++ ) );

	const collection = features => ( { type: 'FeatureCollection', features } );
	return { transportation: collection( transportation ), water: collection( water ), park: collection( park ), building: collection( building ), place: collection( place ) };

}

let stub = null;

function getStub() {

	if ( ! stub ) stub = createGeoJSONVectorSource( createStubCity(), { maxZoom: 16, attribution: 'stub vector tiles', url: 'stub://{z}/{x}/{y}.pbf' } );
	return stub;

}

// The MVT bytes of a tile, or null when no layer covers it.
export function stubVectorTile( z, x, y ) {

	return getStub().tile( z, x, y );

}

export function createStubVectorSource() {

	return getStub().source;

}
