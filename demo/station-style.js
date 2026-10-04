// The style of the indoor demo: the Louvre style's streets and footprints
// with its extruded buildings left out (they would roof the interior), plus
// two layers over the extract's "indoor" source layer that this engine
// builds per level: floors as slabs, walls as runs. Both are MapLibre
// fill-extrusion layers with a metadata key; a MapLibre map would draw them
// as flat-topped extrusions of no height and ignore the levels.

import { LOUVRE_STYLE } from './louvre-style.js';

const CLASS_COLOR = [ 'match', [ 'get', 'class' ], 'room', '#e9dcc5', 'corridor', '#d6d6d2', 'area', '#dfe5d1', 'level', '#f3f1ec', '#dddddd' ];

export const STATION_STYLE = {
	...LOUVRE_STYLE,
	name: 'station',
	layers: [
		...LOUVRE_STYLE.layers.filter( layer => layer.id !== 'building-3d' ),
		{
			id: 'indoor-floor', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'indoor',
			minzoom: 14,
			filter: [ 'in', [ 'get', 'class' ], [ 'literal', [ 'room', 'corridor', 'area' ] ] ],
			metadata: { 'threejs-maplibre:indoor': 'floor', 'threejs-maplibre:level-height': 3 },
			paint: { 'fill-extrusion-color': CLASS_COLOR, 'fill-extrusion-height': 0, 'fill-extrusion-base': 0 },
		},
		{
			id: 'indoor-wall', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'indoor',
			minzoom: 14,
			filter: [ 'in', [ 'get', 'class' ], [ 'literal', [ 'room', 'wall' ] ] ],
			metadata: { 'threejs-maplibre:indoor': 'wall', 'threejs-maplibre:level-height': 3, 'threejs-maplibre:wall-height': 2.5 },
			paint: { 'fill-extrusion-color': '#f7f4ee', 'fill-extrusion-height': 0, 'fill-extrusion-base': 0 },
		},
	],
};
