// Builds demo/data/<dataset>.json, an offline dataset of a demo, from an
// Overpass extract: the Louvre (the default) or Gare Saint-Lazare's indoor
// mapping.
//
//   node scripts/osm-extract.mjs                        # converts demo/data/louvre.osm.json
//   node scripts/osm-extract.mjs --fetch                # runs demo/data/louvre.overpassql first
//   node scripts/osm-extract.mjs --dataset saint-lazare # the station, demo/data/saint-lazare.*
//
// A dataset may be several queries, <name>.overpassql and <name>.<part>.overpassql,
// fetched one by one and merged (Overpass times out on one big one); the
// bbox written into the output is the union of the queries' boxes: where
// the data is, which a demo keeps its character inside.
//
// The output keeps the OpenMapTiles layer names (building, transportation,
// water, waterway, park, landuse, place, poi) plus a "tree" layer, so a style
// written for OpenFreeMap applies to it unchanged. Unlike OpenMapTiles it keeps
// the raw OSM tags: the Simple 3D Buildings fields (building:levels, roof:shape,
// roof:height, building:colour, building:part, ...) are what the later
// milestones render. render_height and render_min_height follow the
// OpenMapTiles rules so the extrusion layer of a standard style applies too.
// Simple Indoor Tagging goes to an "indoor" layer of its own, each feature
// with its levels parsed (levels, level_min, level_max) next to the raw tags.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import osmtogeojson from 'osmtogeojson';
import polygonClipping from 'polygon-clipping';
import { levelsOf } from '../src/indoor/levels.js';

const root = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const dataDir = path.join( root, 'demo', 'data' );
const dataset = process.argv.includes( '--dataset' ) ? process.argv[ process.argv.indexOf( '--dataset' ) + 1 ] : 'louvre';
const rawPath = path.join( dataDir, `${ dataset }.osm.json` );
const outPath = path.join( dataDir, `${ dataset }.json` );
const queryPath = path.join( dataDir, `${ dataset }.overpassql` );
// the public Overpass servers, tried in turn: each times out (504) or
// turns a query away (429) often enough that one is not to be relied on
const ENDPOINTS = process.env.OVERPASS_URL ? [ process.env.OVERPASS_URL ] : [ 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter' ];
// Overpass answers 406 to a request without a User-Agent naming its sender
const USER_AGENT = 'threejs-maplibre/0.1 (+https://github.com/clement-igonet/threejs-maplibre)';

// tags that describe the object rather than its bookkeeping
const DROP_TAG = /^(addr:|source|wiki|ref|note|fixme|contact:|check_date|survey|mapillary|panoramax|heritage|mhs:|name:|alt_name|old_name|official_name|short_name|opening_hours|phone|website|email|description|image|url|start_date|inscription|created_by|is_in|toilets|payment:|diet:|cuisine|brand|operator|wheelchair|internet|smoking|takeaway|outdoor_seating|delivery|drive_through|reservation|capacity|fee|access)/;

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

function asMulti( geometry ) {

	return geometry.type === 'Polygon' ? [ geometry.coordinates ] : geometry.coordinates;

}

// Area in degrees squared, scaled so that a part and its outline compare;
// only ratios of it are used.
function geometryArea( geometry ) {

	let area = 0;
	for ( const polygon of asMulti( geometry ) ) {

		polygon.forEach( ( ring, r ) => {

			let a = 0;
			for ( let i = 0; i < ring.length - 1; i ++ ) a += ring[ i ][ 0 ] * ring[ i + 1 ][ 1 ] - ring[ i + 1 ][ 0 ] * ring[ i ][ 1 ];
			area += ( r === 0 ? 1 : - 1 ) * Math.abs( a / 2 );

		} );

	}

	return area;

}

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

// The levels a feature is on, as the tile can carry them: a list, and the
// two ends for a cheap filter.
function withLevels( props, tags ) {

	const levels = levelsOf( tags );
	if ( levels === null ) return;
	props.levels = levels.join( ';' );
	props.level_min = levels[ 0 ];
	props.level_max = levels[ levels.length - 1 ];
	const height = parseMeters( tags.height );
	if ( height !== undefined ) props.height = height;

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

		// Simple Indoor Tagging: rooms, corridors, areas, walls, doors,
		// columns and level outlines, with their levels parsed; indoor=yes
		// on a point of interest is not a room and stays a point of interest
		const indoorClass = tags.indoor && tags.indoor !== 'yes' && tags.indoor !== 'no' ? tags.indoor : isPoint && tags.level !== undefined && ( tags.door || tags.entrance ) ? ( tags.door ? 'door' : 'entrance' ) : null;
		if ( indoorClass ) {

			const props = pruneTags( tags );
			props.class = indoorClass;
			withLevels( props, tags );
			add( 'indoor', feature, props );
			continue;

		}

		if ( tags.highway && ( isLine || isArea ) ) {

			const props = pruneTags( tags );
			props.class = HIGHWAY_CLASS[ tags.highway ] ?? tags.highway;
			props.subclass = tags.highway;
			if ( tags.bridge && tags.bridge !== 'no' ) props.brunnel = 'bridge';
			if ( tags.tunnel && tags.tunnel !== 'no' ) props.brunnel = 'tunnel';
			if ( tags.level !== undefined || tags.repeat_on !== undefined ) withLevels( props, tags );
			add( 'transportation', feature, props );
			continue;

		}

		if ( isPoint && tags.highway === 'elevator' ) {

			const props = pruneTags( tags );
			props.class = 'path';
			props.subclass = 'elevator';
			withLevels( props, tags );
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

		// points of interest: tourism, amenities, and shops (class 'shop',
		// the kind of shop in subclass, so a walk can label Levi's as it
		// labels a café)
		if ( isPoint && ( tags.tourism || tags.amenity || tags.shop ) ) {

			const props = pruneTags( tags );
			props.class = tags.tourism ?? tags.amenity ?? 'shop';
			if ( tags.shop ) props.subclass = tags.shop;
			add( 'poi', feature, props );
			continue;

		}

	}

	// buildings that contain building parts are hidden in 3D too, and the
	// parts inherit what the outline says and they do not (OSM2World's
	// inheritTags; heights only when the part gives none of its own, as its
	// LevelAndHeightData does), so a pavilion mapped as a bare part stands
	// as tall as its palace rather than at the 5 m default
	const buildings = layers.building.features;
	const parts = buildings.filter( f => f.properties[ 'building:part' ] && ! f.properties.building );
	const outlines = buildings.filter( f => f.properties.building );
	const HEIGHT_TAGS = [ 'height', 'building:levels', 'roof:levels' ];
	const partsOf = new Map(); // outline -> its parts
	let inherited = 0;
	for ( const part of parts ) {

		const rings = part.geometry.type === 'Polygon' ? part.geometry.coordinates : part.geometry.coordinates[ 0 ];
		const centroid = ringCentroid( rings[ 0 ] );
		const outline = outlines.find( o => pointInPolygon( centroid, o.geometry ) );
		if ( ! outline ) continue;
		if ( ! partsOf.has( outline ) ) partsOf.set( outline, [] );
		partsOf.get( outline ).push( part );

		const from = outline.properties, into = part.properties;
		const ownHeight = HEIGHT_TAGS.some( key => into[ key ] !== undefined );
		let changed = false;
		for ( const key of Object.keys( from ) ) {

			if ( key === 'building' || key === 'hide_3d' || key.startsWith( 'render_' ) || into[ key ] !== undefined ) continue;
			if ( ownHeight && ( HEIGHT_TAGS.includes( key ) || key === 'min_height' || key === 'building:min_level' || key === 'roof:height' ) ) continue;
			into[ key ] = from[ key ];
			changed = true;

		}

		if ( changed ) {

			inherited ++;
			if ( ! ownHeight ) {

				into.render_height = from.render_height;
				into.render_min_height = from.render_min_height;

			}

		}

	}

	console.log( `parts inheriting from their outline: ${ inherited }` );

	// An outline with parts is hidden only when the parts cover it: the
	// Palais du Louvre has 531 parts, pavilions and roofs, over 27% of its
	// 47 000 m2, and hiding it lost the wings. OSM2World draws such an
	// outline whole when the parts cover less than 90% (Building.java,
	// "non-standard mapping"); F4Map draws the outline minus its parts.
	// Subtracting is what keeps the parts' tops from fighting the outline's,
	// so that is what happens here, and the remainder keeps the outline's
	// own tags and height.
	let subtracted = 0, hidden = 0;
	for ( const [ outline, inside ] of partsOf ) {

		const coverage = inside.reduce( ( sum, p ) => sum + geometryArea( p.geometry ), 0 ) / geometryArea( outline.geometry );
		if ( coverage >= 0.9 ) {

			outline.properties.hide_3d = true;
			hidden ++;
			continue;

		}

		let remainder;
		try {

			remainder = polygonClipping.difference( asMulti( outline.geometry ), ...inside.map( p => asMulti( p.geometry ) ) );

		} catch {

			remainder = null; // a part the clipper cannot take: the outline stays whole

		}

		if ( remainder === null || remainder.length === 0 ) continue;
		outline.geometry = remainder.length === 1 ? { type: 'Polygon', coordinates: remainder[ 0 ] } : { type: 'MultiPolygon', coordinates: remainder };
		delete outline.properties.hide_3d;
		subtracted ++;

	}

	console.log( `outlines with parts: ${ partsOf.size }, hidden under them: ${ hidden }, drawn minus them: ${ subtracted }` );

	return layers;

}

async function main() {

	if ( process.argv.includes( '--fetch' ) ) {

		const { readdir } = await import( 'node:fs/promises' );
		const parts = ( await readdir( dataDir ) ).filter( f => f === `${ dataset }.overpassql` || ( f.startsWith( `${ dataset }.` ) && f.endsWith( '.overpassql' ) ) ).sort();
		const seen = new Set();
		let merged = null;
		for ( const part of parts ) {

			const query = await readFile( path.join( dataDir, part ), 'utf8' );
			let json = null;
			for ( const endpoint of [ ...ENDPOINTS, ...ENDPOINTS ] ) {

				const response = await fetch( endpoint, { method: 'POST', headers: { 'User-Agent': USER_AGENT }, body: new URLSearchParams( { data: query } ) } ).catch( error => ( { ok: false, status: error.message, statusText: '' } ) );
				if ( response.ok ) { json = JSON.parse( await response.text() ); break; }
				console.log( `${ part }: ${ response.status } ${ response.statusText } from ${ new URL( endpoint ).host }, trying the next` );

			}

			if ( json === null ) throw new Error( `Overpass: every server failed on ${ part }` );
			if ( merged === null ) merged = { ...json, elements: [] };
			for ( const element of json.elements ) {

				const key = `${ element.type }/${ element.id }`;
				if ( seen.has( key ) ) continue;
				seen.add( key );
				merged.elements.push( element );

			}

			console.log( `${ part }: ${ json.elements.length } elements` );

		}

		await writeFile( rawPath, JSON.stringify( merged ) );

	}

	const osm = JSON.parse( await readFile( rawPath, 'utf8' ) );
	const { readdir } = await import( 'node:fs/promises' );
	const queries = ( await readdir( dataDir ) ).filter( f => f === `${ dataset }.overpassql` || ( f.startsWith( `${ dataset }.` ) && f.endsWith( '.overpassql' ) ) );
	const bbox = [ Infinity, Infinity, - Infinity, - Infinity ]; // south, west, north, east, as Overpass writes it
	for ( const file of queries ) {

		const [ s, w, n, e ] = /\[bbox:([^\]]+)\]/.exec( await readFile( path.join( dataDir, file ), 'utf8' ) )[ 1 ].split( ',' ).map( Number );
		bbox[ 0 ] = Math.min( bbox[ 0 ], s ); bbox[ 1 ] = Math.min( bbox[ 1 ], w );
		bbox[ 2 ] = Math.max( bbox[ 2 ], n ); bbox[ 3 ] = Math.max( bbox[ 3 ], e );

	}
	const layers = convert( osm );

	const out = {
		meta: {
			source: 'OpenStreetMap contributors, via the Overpass API',
			license: 'ODbL 1.0',
			osm_base: osm.osm3s?.timestamp_osm_base,
			bbox: [ bbox[ 1 ], bbox[ 0 ], bbox[ 3 ], bbox[ 2 ] ], // west, south, east, north
			query: `demo/data/${ dataset }.overpassql`,
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
	if ( layers.indoor ) {

		const byClass = {}, levels = new Set();
		for ( const f of layers.indoor.features ) {

			byClass[ f.properties.class ] = ( byClass[ f.properties.class ] ?? 0 ) + 1;
			if ( f.properties.levels ) for ( const l of f.properties.levels.split( ';' ) ) levels.add( l );

		}

		console.log( `indoor: ${ Object.entries( byClass ).map( ( [ k, n ] ) => `${ k } ${ n }` ).join( ', ' ) }; levels ${ [ ...levels ].map( Number ).sort( ( a, b ) => a - b ).join( ' ' ) }` );

	}

}

main().catch( error => {

	console.error( error );
	process.exit( 1 );

} );
