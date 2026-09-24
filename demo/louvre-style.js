// The style of the Louvre demo: a MapLibre style over the OpenMapTiles layer
// names that demo/data/louvre.json keeps, plus the raw OSM tags the extract
// preserves (building:colour, building:part, hide_3d). It renders equally on
// the stub city; OpenFreeMap tiles carry the same layers but not the raw
// tags, so there the buildings fall back to the default colour.

const ROAD_WIDTH = ( base, top ) => [ 'interpolate', [ 'exponential', 1.5 ], [ 'zoom' ], 12, base, 20, top ];

// Per-class widths under one zoom interpolation, since the style spec allows
// a single zoom expression per property: byClass is [ [ classes, [ base, top ] ], ... ].
function classWidth( byClass, fallback ) {

	const stop = i => {

		const match = [ 'match', [ 'get', 'class' ] ];
		for ( const [ classes, pair ] of byClass ) match.push( classes, pair[ i ] );
		match.push( fallback[ i ] );
		return match;

	};

	return [ 'interpolate', [ 'exponential', 1.5 ], [ 'zoom' ], 12, stop( 0 ), 20, stop( 1 ) ];

}

// wall colour from the OSM tags, the way OSM2World reads them: an explicit
// colour first, then the material, then the building type
const BUILDING_COLOR = [
	'case',
	[ 'has', 'building:colour' ], [ 'to-color', [ 'get', 'building:colour' ], '#dbd3c8' ],
	[ 'has', 'building:facade:colour' ], [ 'to-color', [ 'get', 'building:facade:colour' ], '#dbd3c8' ],
	[ 'has', 'building:material' ],
	[ 'match', [ 'get', 'building:material' ],
		[ 'stone', 'limestone' ], '#e0d8cb',
		'brick', '#bd8672',
		'glass', '#b3cad8',
		'concrete', '#cbc7c1',
		[ 'metal', 'steel' ], '#b7babd',
		'wood', '#c6a27a',
		'#dbd3c8',
	],
	[ 'match', [ 'get', 'building' ],
		[ 'church', 'cathedral', 'chapel' ], '#cdbfae',
		[ 'roof', 'shelter', 'kiosk' ], '#e6e0d6',
		'#dbd3c8',
	],
];

export const LOUVRE_STYLE = {
	version: 8,
	name: 'louvre',
	sources: {
		openmaptiles: { type: 'vector', tiles: [ 'louvre://{z}/{x}/{y}.pbf' ], minzoom: 0, maxzoom: 16 },
	},
	layers: [
		{ id: 'background', type: 'background', paint: { 'background-color': '#ebe7df' } },
		{
			id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
			paint: {
				'fill-color': [ 'match', [ 'get', 'class' ],
					[ 'grass', 'meadow', 'village_green', 'recreation_ground', 'pitch' ], '#d5e8c0',
					[ 'cemetery' ], '#cfdcc5',
					[ 'pedestrian' ], '#e3dfd6',
					'#e6e2da',
				],
			},
		},
		{
			id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
			paint: { 'fill-color': '#c9e2a8', 'fill-opacity': 0.9 },
		},
		{
			id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
			paint: { 'fill-color': '#9cc4e6' },
		},
		{
			id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway',
			paint: { 'line-color': '#8fb8de', 'line-width': ROAD_WIDTH( 1, 6 ) },
		},
		{
			id: 'pedestrian-area', type: 'fill', source: 'openmaptiles', 'source-layer': 'transportation',
			filter: [ 'all', [ '==', [ 'geometry-type' ], 'Polygon' ], [ '==', [ 'get', 'class' ], 'path' ] ],
			paint: { 'fill-color': '#e9e5dd' },
		},
		{
			id: 'path', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
			minzoom: 14,
			filter: [ 'all', [ '==', [ 'geometry-type' ], 'LineString' ], [ '==', [ 'get', 'class' ], 'path' ] ],
			paint: { 'line-color': '#f7f4ee', 'line-width': ROAD_WIDTH( 0.5, 6 ) },
		},
		{
			id: 'road-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
			filter: [ 'all', [ '==', [ 'geometry-type' ], 'LineString' ], [ '!', [ 'in', [ 'get', 'class' ], [ 'literal', [ 'path', 'track' ] ] ] ] ],
			layout: { 'line-join': 'round' },
			paint: {
				'line-color': '#c7bfb3',
				'line-width': classWidth( [
					[ [ 'motorway', 'trunk', 'primary' ], [ 3, 34 ] ],
					[ [ 'secondary', 'tertiary' ], [ 2.5, 28 ] ],
					[ [ 'service' ], [ 1, 12 ] ],
				], [ 1.5, 20 ] ),
			},
		},
		{
			id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
			filter: [ 'all', [ '==', [ 'geometry-type' ], 'LineString' ], [ '!', [ 'in', [ 'get', 'class' ], [ 'literal', [ 'path', 'track' ] ] ] ] ],
			layout: { 'line-join': 'round' },
			paint: {
				'line-color': [ 'match', [ 'get', 'class' ],
					[ 'motorway', 'trunk', 'primary' ], '#fbe3a3',
					[ 'secondary', 'tertiary' ], '#fdf2d2',
					'#ffffff',
				],
				'line-width': classWidth( [
					[ [ 'motorway', 'trunk', 'primary' ], [ 2, 30 ] ],
					[ [ 'secondary', 'tertiary' ], [ 1.5, 24 ] ],
					[ [ 'service' ], [ 0.5, 8 ] ],
				], [ 1, 16 ] ),
			},
		},
		{
			id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building',
			maxzoom: 14,
			paint: { 'fill-color': '#d3cabf', 'fill-outline-color': '#bfb5a8' },
		},
		{
			id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building',
			minzoom: 14,
			filter: [ '!', [ 'has', 'hide_3d' ] ],
			paint: {
				'fill-extrusion-color': BUILDING_COLOR,
				'fill-extrusion-height': [ 'get', 'render_height' ],
				'fill-extrusion-base': [ 'get', 'render_min_height' ],
			},
		},
		{
			id: 'place', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
			layout: { 'text-field': [ 'get', 'name' ], 'text-size': 14 },
			paint: { 'text-color': '#333' },
		},
	],
};
