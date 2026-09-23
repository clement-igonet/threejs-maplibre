// A small MapLibre style over the OpenMapTiles schema, enough to exercise
// every honoured layer type against the stub city or OpenFreeMap.

export const STUB_STYLE = {
	version: 8,
	name: 'stub',
	sources: {
		openmaptiles: { type: 'vector', tiles: [ 'stub://{z}/{x}/{y}.pbf' ], minzoom: 0, maxzoom: 16 },
	},
	layers: [
		{ id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } },
		{
			id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
			paint: { 'fill-color': '#c8e6a4', 'fill-opacity': 0.8 },
		},
		{
			id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
			filter: [ '==', '$type', 'Polygon' ],
			paint: { 'fill-color': '#a0c8f0' },
		},
		{
			id: 'road-residential', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
			minzoom: 12,
			filter: [ 'in', 'class', 'residential', 'service', 'minor' ],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: { 'line-color': '#ffffff', 'line-width': [ 'interpolate', [ 'exponential', 1.5 ], [ 'zoom' ], 12, 1, 18, 12 ] },
		},
		{
			id: 'road-major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
			filter: [ 'in', 'class', 'primary', 'secondary', 'tertiary', 'trunk', 'motorway' ],
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': [ 'match', [ 'get', 'class' ], 'primary', '#fcd6a4', '#f7f0d9' ],
				'line-width': [ 'interpolate', [ 'exponential', 1.5 ], [ 'zoom' ], 8, 0.5, 18, 24 ],
			},
		},
		{
			id: 'building-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building',
			minzoom: 13,
			paint: {
				'fill-extrusion-color': '#d9d0c9',
				'fill-extrusion-height': [ 'get', 'render_height' ],
				'fill-extrusion-base': [ 'get', 'render_min_height' ],
				'fill-extrusion-opacity': 0.9,
			},
		},
		{
			id: 'place-city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
			filter: [ '==', 'class', 'city' ],
			layout: { 'text-field': '{name}', 'text-size': 14 },
			paint: { 'text-color': '#333' },
		},
	],
};
