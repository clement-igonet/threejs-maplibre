// Builds demo/data/louvre.json, the offline dataset of the Louvre demo, from
// an Overpass extract of the area around the museum.
//
//   node scripts/louvre-extract.mjs            # converts demo/data/louvre.osm.json
//   node scripts/louvre-extract.mjs --fetch    # runs demo/data/louvre.overpassql first
//
// The output keeps the OpenMapTiles layer names (building, transportation,
// water, waterway, park, landuse, place, poi) plus a "tree" layer, so a style
// written for OpenFreeMap applies to it unchanged. Unlike OpenMapTiles it keeps
// the raw OSM tags: the Simple 3D Buildings fields (building:levels, roof:shape,
// roof:height, building:colour, building:part, ...) are what the later
// milestones render. render_height and render_min_height follow the
// OpenMapTiles rules so the extrusion layer of a standard style applies too.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import osmtogeojson from 'osmtogeojson';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const dataDir = path.join( root, 'demo', 'data' );
const rawPath = path.join( dataDir, 'louvre.osm.json' );
const outPath = path.join( dataDir, 'louvre.json' );
const queryPath = path.join( dataDir, 'louvre.overpassql' );
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

// tags that describe the object rather than its bookkeeping
const DROP_TAG = /^(addr:|source|wiki|ref|note|fixme|contact:|check_date|survey|mapillary|panoramax|heritage|mhs:|name:|alt_name|old_name|official_name|short_name|opening_hours|phone|website|email|description|image|url|start_date|inscription|created_by|is_in|toilets|payment:|diet:|cuisine|brand|operator|wheelchair|internet|smoking|takeaway|outdoor_seating|delivery|drive_through|reservation|capacity|fee|access|level$)/;

const METERS_PER_LEVEL = 3.66; // OpenMapTiles

function parseMeters( value ) {

	if ( value === undefined ) return undefined;
	const m = /^\s*(-?\d+(?:\.\d+)?)\s*(m|meters?)?\s*$/i.exec( value );
	return m ? parseFloat( m[ 1 ] ) : undefined;

}

function parseLevels( value ) {

	if ( value === undefined ) return undefined;
	const n = parseFloat( value );
	return Number.isFinite( n ) ? n : undefined;

}

function pruneTags( tags ) {

	const out = {};
	for ( const key of Object.keys( tags ) ) {

		if ( ! DROP_TAG.test( key ) ) out[ key ] = tags[ key ];

	}

	return out;

}

// OpenMapTiles transportation classes
const HIGHWAY_CLASS = {
	motorway: 'motorway', motorway_link: 'motorway',
	trunk: 'trunk', trunk_link: 'trunk',
	primary: 'primary', primary_link: 'primary',
	secondary: 'secondary', secondary_link: 'secondary',
	tertiary: 'tertiary', tertiary_link: 'tertiary',
	residential: 'minor', unclassified: 'minor', living_street: 'minor',
	service: 'service',
	footway: 'path', path: 'path', pedestrian: 'path', steps: 'path', cycleway: 'path', bridleway: 'path', corridor: 'path',
	track: 'track', raceway: 'raceway',
};

function ringCentroid( ring ) {

	let x = 0, y = 0;
	for ( let i = 0; i < ring.length - 1; i ++ ) {

		x += ring[ i ][ 0 ];
		y += ring[ i ][ 1 ];

	}

	return [ x / ( ring.length - 1 ), y / ( ring.length - 1 ) ];

}

function pointInRing( [ px, py ], ring ) {

	let inside = false;
	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

		const [ xi, yi ] = ring[ i ];
		const [ xj, yj ] = ring[ j ];
		if ( ( yi > py ) !== ( yj > py ) && px < ( xj - xi ) * ( py - yi ) / ( yj - yi ) + xi ) inside = ! inside;

	}

	return inside;

}

function pointInPolygon( point, geometry ) {

	const polygons = geometry.type === 'Polygon' ? [ geometry.coordinates ] : geometry.coordinates;
	for ( const rings of polygons ) {

		if ( ! pointInRing( point, rings[ 0 ] ) ) continue;
		let inHole = false;
		for ( let r = 1; r < rings.length; r ++ ) if ( pointInRing( point, rings[ r ] ) ) inHole = true;
		if ( ! inHole ) return true;

	}

	return false;

}

function roundCoordinates( geometry ) {

	const round = c => [ Math.round( c[ 0 ] * 1e6 ) / 1e6, Math.round( c[ 1 ] * 1e6 ) / 1e6 ];
	const walk = c => Array.isArray( c[ 0 ] ) ? c.map( walk ) : round( c );
	geometry.coordinates = walk( geometry.coordinates );

}

function convert( osm ) {

	const geojson = osmtogeojson( osm, { flatProperties: false } );
	const layers = {};
	const add = ( name, feature, properties ) => {

		roundCoordinates( feature.geometry );
		( layers[ name ] ??= { type: 'FeatureCollection', features: [] } ).features.push( {
			type: 'Feature',
			id: feature.properties.id,
			geometry: feature.geometry,
			properties,
		} );

	};

	for ( const feature of geojson.features ) {

		const { tags = {}, relations = [] } = feature.properties;
		const type = feature.geometry.type;
		const isArea = type === 'Polygon' || type === 'MultiPolygon';
		const isLine = type === 'LineString' || type === 'MultiLineString';
		const isPoint = type === 'Point';

		if ( isArea && ( tags.building || tags[ 'building:part' ] ) ) {

			const props = pruneTags( tags );
			const levels = parseLevels( tags[ 'building:levels' ] );
			const minLevel = parseLevels( tags[ 'building:min_level' ] );
			const height = parseMeters( tags.height ) ?? ( levels !== undefined ? levels * METERS_PER_LEVEL : 5 );
			const minHeight = parseMeters( tags.min_height ) ?? ( minLevel !== undefined ? minLevel * METERS_PER_LEVEL : 0 );
			props.render_height = Math.round( height * 100 ) / 100;
			props.render_min_height = Math.round( minHeight * 100 ) / 100;
			// an outline of a type=building relation is hidden in 3D, its parts draw
			if ( relations.some( r => r.reltags.type === 'building' && r.role === 'outline' ) ) props.hide_3d = true;
			add( 'building', feature, props );
			continue;

		}

		if ( tags.highway && ( isLine || isArea ) ) {

			const props = pruneTags( tags );
			props.class = HIGHWAY_CLASS[ tags.highway ] ?? tags.highway;
			props.subclass = tags.highway;
			if ( tags.bridge && tags.bridge !== 'no' ) props.brunnel = 'bridge';
			if ( tags.tunnel && tags.tunnel !== 'no' ) props.brunnel = 'tunnel';
			add( 'transportation', feature, props );
			continue;

		}

		if ( isArea && ( tags.natural === 'water' || tags.waterway === 'riverbank' || tags.waterway === 'dock' ) ) {

			const props = pruneTags( tags );
			props.class = tags.water ?? ( tags.waterway ? 'river' : 'lake' );
			add( 'water', feature, props );
			continue;

		}

		if ( isLine && tags.waterway ) {

			const props = pruneTags( tags );
			props.class = tags.waterway;
			add( 'waterway', feature, props );
			continue;

		}

		if ( isArea && tags.leisure && [ 'park', 'garden', 'playground', 'nature_reserve', 'dog_park' ].includes( tags.leisure ) ) {

			const props = pruneTags( tags );
			props.class = tags.leisure;
			add( 'park', feature, props );
			continue;

		}

		if ( isArea && ( tags.landuse || tags.leisure ) ) {

			const props = pruneTags( tags );
			props.class = tags.landuse ?? tags.leisure;
			add( 'landuse', feature, props );
			continue;

		}

		if ( isPoint && tags.place ) {

			const props = pruneTags( tags );
			props.class = tags.place;
			add( 'place', feature, props );
			continue;

		}

		if ( isPoint && tags.natural === 'tree' ) {

			add( 'tree', feature, pruneTags( tags ) );
			continue;

		}

		if ( isPoint && ( tags.tourism || tags.amenity ) ) {

			const props = pruneTags( tags );
			props.class = tags.tourism ?? tags.amenity;
			add( 'poi', feature, props );
			continue;

		}

	}

	// buildings that contain building parts are hidden in 3D too
	const buildings = layers.building.features;
	const parts = buildings.filter( f => f.properties[ 'building:part' ] && ! f.properties.building );
	const outlines = buildings.filter( f => f.properties.building );
	for ( const outline of outlines ) {

		if ( outline.properties.hide_3d ) continue;
		for ( const part of parts ) {

			const rings = part.geometry.type === 'Polygon' ? part.geometry.coordinates : part.geometry.coordinates[ 0 ];
			if ( pointInPolygon( ringCentroid( rings[ 0 ] ), outline.geometry ) ) {

				outline.properties.hide_3d = true;
				break;

			}

		}

	}

	return layers;

}

async function main() {

	if ( process.argv.includes( '--fetch' ) ) {

		const query = await readFile( queryPath, 'utf8' );
		const response = await fetch( ENDPOINT, { method: 'POST', body: new URLSearchParams( { data: query } ) } );
		if ( ! response.ok ) throw new Error( `Overpass: ${ response.status } ${ response.statusText }` );
		await writeFile( rawPath, await response.text() );

	}

	const osm = JSON.parse( await readFile( rawPath, 'utf8' ) );
	const query = await readFile( queryPath, 'utf8' );
	const bbox = /\[bbox:([^\]]+)\]/.exec( query )[ 1 ].split( ',' ).map( Number );
	const layers = convert( osm );

	const out = {
		meta: {
			source: 'OpenStreetMap contributors, via the Overpass API',
			license: 'ODbL 1.0',
			osm_base: osm.osm3s?.timestamp_osm_base,
			bbox: [ bbox[ 1 ], bbox[ 0 ], bbox[ 3 ], bbox[ 2 ] ], // west, south, east, north
			query: 'demo/data/louvre.overpassql',
		},
		layers,
	};

	await writeFile( outPath, JSON.stringify( out ) );

	const summary = Object.entries( layers ).map( ( [ name, fc ] ) => `${ name }: ${ fc.features.length }` ).join( ', ' );
	const stats = await import( 'node:fs' ).then( fs => fs.statSync( outPath ) );
	console.log( `${ path.relative( root, outPath ) } (${ ( stats.size / 1e6 ).toFixed( 2 ) } MB): ${ summary }` );
	const parts = layers.building.features.filter( f => f.properties[ 'building:part' ] ).length;
	const roofs = layers.building.features.filter( f => f.properties[ 'roof:shape' ] ).length;
	const hidden = layers.building.features.filter( f => f.properties.hide_3d ).length;
	console.log( `building parts: ${ parts }, roof:shape: ${ roofs }, hidden outlines: ${ hidden }` );

}

main().catch( error => {

	console.error( error );
	process.exit( 1 );

} );
