import { createTileProjection } from './TileProjection.js';
import { appendRoofedExtrusion, hasWalls, roofColours, roofFromTags } from './buildRoofs.js';
import { FLOOR_THICKNESS, appendFillWithHoles, appendFloor, appendFloorWithHoles, appendRamp, appendShaft, appendWallRun, featureLevels, stairwell } from './buildIndoor.js';
import { appendExtrusion, appendFill, featurePolygons } from './buildPolygons.js';
import { appendLine, featureLines } from './buildLines.js';
import { EXTRUDE_SCALE, PROPS_SCALE, quantize } from './quantize.js';

// Turns a decoded tile into one geometry block per style layer: attribute
// arrays ready to become BufferAttributes on the main thread. Runs in the
// Worker (or inline without one).
//
// Property values are evaluated at the tile's zoom. What depends on the
// feature ('source' and 'composite' kinds) is baked per vertex; what depends
// on zoom only ('camera' kind) or on nothing ('constant') is left to a
// per-frame uniform on the main thread, with the baked value set to 1, so the
// shader computes value = baked * uniform. A 'composite' value is therefore
// frozen at the tile's zoom, the one known limitation of this scheme.
//
// Every layer is built for every tile that carries its data, evaluated at the
// tile's zoom clamped into the layer's zoom range; whether a block is drawn
// is decided per frame from the map zoom (VectorTileMap). One view mixes
// tiles of several zooms (screen-space error, pitch), so a layer can not be
// tied to the tile zoom the way MapLibre does it: a far z13 tile must still
// carry the extrusions a minzoom 14 layer shows once the map is past 14.

const WHITE = [ 255, 255, 255, 255 ];
const OPAQUE_WHITE = { rgb: [ 1, 1, 1, 1 ] };
const BUILT_TYPES = new Set( [ 'fill', 'line', 'fill-extrusion' ] );

function isBaked( kind ) {

	return kind === 'source' || kind === 'composite';

}

// style colors are sRGB; vertex colors are read as linear by three.js
function srgbToLinear( c ) {

	return c < 0.04045 ? c * 0.0773993808 : Math.pow( c * 0.9478672986 + 0.0521327014, 2.4 );

}

function toRGBA( color, alpha ) {

	const [ r, g, b, a ] = color.rgb;
	return [
		Math.round( srgbToLinear( r ) * 255 ),
		Math.round( srgbToLinear( g ) * 255 ),
		Math.round( srgbToLinear( b ) * 255 ),
		Math.round( a * alpha * 255 ),
	];

}

function newBlock( layer, index, type, glass = false ) {

	return {
		id: layer.id, index, type, glass,
		positions: [], colors: [], indices: [], extrudes: [], sides: [], props: [],
		vertexCount: 0, features: 0, triangles: 0,
	};
}

function finishBlock( block ) {

	if ( block.vertexCount === 0 ) return null;

	const out = {
		id: block.id,
		index: block.index,
		type: block.type,
		glass: block.glass,
		level: block.level,
		indoor: block.indoor,
		base: block.base,
		features: block.features,
		triangles: block.triangles,
		vertices: block.vertexCount,
		positions: new Float32Array( block.positions ),
		colors: new Uint8Array( block.colors ),
		indices: block.vertexCount > 65535 ? new Uint32Array( block.indices ) : new Uint16Array( block.indices ),
	};

	// a line vertex is the one this builds most of, so its attributes are
	// quantized: a direction and two side flags need nothing like a float each
	if ( block.type === 'line' ) {

		out.extrudes = quantize( block.extrudes, EXTRUDE_SCALE );
		out.sides = new Int8Array( block.sides );
		out.props = quantize( block.props, PROPS_SCALE );

	}

	return out;

}

export function buildTile( tile, style, { sourceId, x, y, z, mode = 'globe', datum } ) {

	const t0 = performance.now();
	const blocks = [];
	const stats = { features: 0, vertices: 0, triangles: 0, buildMs: 0 };
	let projection = null;

	for ( let index = 0; index < style.layers.length; index ++ ) {

		const layer = style.layers[ index ];
		if ( layer.source !== sourceId || ! BUILT_TYPES.has( layer.type ) || ! layer.visible || layer.patterned ) continue;

		const sourceLayer = tile.layers[ layer.sourceLayer ];
		if ( ! sourceLayer ) continue;

		const zoom = Math.min( Math.max( z, layer.minzoom ), Math.max( layer.minzoom, layer.maxzoom - 1 ) );

		if ( projection === null ) projection = createTileProjection( x, y, z, sourceLayer.extent, mode, datum );
		const extent = sourceLayer.extent;
		const type = layer.type;
		const block = newBlock( layer, index, type );
		const outline = type === 'fill' && layer.has( 'fill-outline-color' ) ? newBlock( layer, index, 'line' ) : null;
		// roofs: a metadata key, so the style stays one MapLibre reads
		const roofs = type === 'fill-extrusion' && layer.metadata && layer.metadata[ 'threejs-maplibre:roofs' ] ? { levelHeight: layer.metadata[ 'threejs-maplibre:level-height' ] ?? 2.5 } : null;
		// tile units per meter at this tile, for roofs sized from their footprint and doors in meters
		const unitsPerMeter = extent / ( 40075016.686 * Math.cos( tileCenterLatitude( y, z ) * Math.PI / 180 ) / ( 1 << z ) );
		let glass = null; // translucent features go in a block of their own
		// indoor: 'floor' or 'wall' from the metadata, built per level into a
		// block per level, so levels can be shown one at a time
		const indoor = type === 'fill-extrusion' && layer.metadata && layer.metadata[ 'threejs-maplibre:indoor' ] || null;
		const levelHeight = layer.metadata && layer.metadata[ 'threejs-maplibre:level-height' ] || 3;
		const wallHeight = layer.metadata && layer.metadata[ 'threejs-maplibre:wall-height' ] || levelHeight - 0.5;
		// a floor drawn under the others: a level's whole outline, there to
		// fill what lies between the mapped rooms, sits this many meters
		// lower so the rooms' own floors show on top of it
		const floorDrop = layer.metadata && layer.metadata[ 'threejs-maplibre:floor-drop' ] || 0;
		// the doors of this source layer, per level, as openings for the walls:
		// [ x, y, halfWidth ] in tile units (a door is 1.2 m unless tagged)
		const doorsByLevel = new Map();
		if ( indoor === 'wall' ) {

			for ( let f = 0; f < sourceLayer.featureCount; f ++ ) {

				if ( sourceLayer.types[ f ] !== 1 ) continue;
				const props = sourceLayer.properties[ f ];
				if ( props.class !== 'door' && props.class !== 'entrance' ) continue;
				const r = sourceLayer.featureStart[ f ], v = sourceLayer.ringStart[ r ];
				const width = parseFloat( props.width );
				const half = ( Number.isFinite( width ) ? width : 1.2 ) / 2 * unitsPerMeter;
				for ( const level of featureLevels( props ) ) {

					if ( ! doorsByLevel.has( level ) ) doorsByLevel.set( level, [] );
					doorsByLevel.get( level ).push( [ sourceLayer.positions[ 2 * v ], sourceLayer.positions[ 2 * v + 1 ], half ] );

				}

			}

		}

		// the entrances of the tile's indoor layer cut the buildings' ground
		// floor walls, so a street leads into a hall
		let entrances = null;
		if ( type === 'fill-extrusion' && ! indoor && tile.layers.indoor ) {

			const doors = tile.layers.indoor;
			for ( let f = 0; f < doors.featureCount; f ++ ) {

				if ( doors.types[ f ] !== 1 || doors.properties[ f ].class !== 'entrance' ) continue;
				const r = doors.featureStart[ f ], v = doors.ringStart[ r ];
				const width = parseFloat( doors.properties[ f ].width );
				( entrances ??= [] ).push( [ doors.positions[ 2 * v ], doors.positions[ 2 * v + 1 ], ( Number.isFinite( width ) ? width : 1.8 ) / 2 * unitsPerMeter, 2.5 ] );

			}

		}

		// the stairwells of the tile: every floor a staircase or escalator
		// climbs to gets a hole along it, 2 m wide, so it comes up through
		const holesByLevel = new Map();
		if ( ( indoor === 'floor' || type === 'fill' ) && tile.layers.transportation ) {

			const ways = tile.layers.transportation;
			for ( let f = 0; f < ways.featureCount; f ++ ) {

				const props = ways.properties[ f ];
				if ( ways.types[ f ] !== 2 || props.subclass !== 'steps' ) continue;
				const levels = featureLevels( props );
				if ( levels.length < 2 ) continue;
				const quads = featureLines( ways, f, extent ).flatMap( run => stairwell( run.points, 2 * unitsPerMeter ) );
				for ( const level of levels.slice( 1 ) ) {

					if ( ! holesByLevel.has( level ) ) holesByLevel.set( level, [] );
					holesByLevel.get( level ).push( ...quads );

				}

			}

		}

		// the walls buildings share: a wall asks what other extrusions of the
		// layer stand a quarter meter off it, on either side, and gets their
		// [ base, height ]. Parts of one building that meet corner to corner,
		// and parts where one's corner sits along the other's wall, alike.
		const neighbours = type === 'fill-extrusion' && ! indoor ? indexExtrusions( sourceLayer, layer, zoom, extent ) : null;
		const probe = 0.25 * unitsPerMeter;
		let coveredFor = () => null;
		if ( neighbours ) coveredFor = self => ( ax, ay, bx, by ) => {

			const len = Math.hypot( bx - ax, by - ay );
			if ( len === 0 ) return null;
			const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2, nx = - ( by - ay ) / len * probe, ny = ( bx - ax ) / len * probe;
			const spans = [ ...neighbours.at( mx + nx, my + ny, self ), ...neighbours.at( mx - nx, my - ny, self ) ];
			return spans.length ? spans : null;

		};

		const levelBlocks = new Map();
		const levelBlock = level => {

			let b = levelBlocks.get( level );
			if ( ! b ) {

				b = newBlock( layer, index, type );
				b.level = level;
				b.indoor = indoor; // floor, wall, steps or lift: how a character meets it
				b.base = level * levelHeight; // where the level's floor is
				levelBlocks.set( level, b );

			}

			return b;

		};

		// what is baked per vertex for this layer
		const colorName = `${ type }-color`;
		const opacityName = `${ type }-opacity`;
		const bakeColor = isBaked( layer.kind( colorName ) );
		const bakeOpacity = isBaked( layer.kind( opacityName ) );
		const bakeProps = type === 'line' && [ 'line-width', 'line-gap-width', 'line-offset' ].map( name => isBaked( layer.kind( name ) ) );
		const gapSigns = type === 'line' && layer.has( 'line-gap-width' ) ? [ - 1, 1 ] : [ 0 ];

		for ( let f = 0; f < sourceLayer.featureCount; f ++ ) {

			const feature = { type: sourceLayer.types[ f ], properties: sourceLayer.properties[ f ], id: sourceLayer.ids[ f ] };
			if ( ! layer.matches( zoom, feature ) ) continue;

			let rgba = WHITE;
			if ( bakeColor || bakeOpacity ) {

				rgba = toRGBA(
					bakeColor ? layer.get( colorName, zoom, feature ) : OPAQUE_WHITE,
					bakeOpacity ? layer.get( opacityName, zoom, feature ) : 1
				);

			}

			let triangles = 0;

			if ( type === 'fill' ) {

				if ( feature.type !== 3 ) continue;
				// the street over a staircase down to level -1 or below gets
				// the hole the station's floors get, so the stairs open up
				const streetHoles = holesByLevel.get( 0 );
				for ( const polygon of featurePolygons( sourceLayer, f, extent ) ) {

					triangles += streetHoles ? appendFillWithHoles( block, polygon, projection, rgba, 0, streetHoles ) : appendFill( block, polygon, projection, rgba );
					if ( outline ) {

						const outlineRGBA = toRGBA( layer.get( 'fill-outline-color', zoom, feature ), 1 );
						for ( const ring of polygon ) {

							const points = ring.concat( [ ring[ 0 ], ring[ 1 ] ] );
							outline.triangles += appendLine( outline, { points, startEdge: null, endEdge: null }, projection, outlineRGBA, [ 1, 0, 0 ] );

						}

					}

				}

			} else if ( indoor ) {

				const levels = featureLevels( feature.properties );
				if ( levels.length === 0 ) continue;
				const polygons = feature.type === 3 ? featurePolygons( sourceLayer, f, extent ) : null;
				const runs = feature.type === 2 ? featureLines( sourceLayer, f, extent ) : null;

				if ( indoor === 'steps' || indoor === 'lift' ) {

					// a staircase climbs from its lowest level to its highest
					// (down the way when incline=down), a lift shaft spans them;
					// both are built into every level they serve, so each level
					// shows its own way up
					const lo = levels[ 0 ], hi = levels[ levels.length - 1 ];
					if ( indoor === 'steps' && runs && hi > lo ) {

						const down = feature.properties.incline === 'down';
						for ( const run of runs ) {

							for ( const level of levels ) {

								const target = levelBlock( level );
								const t = appendRamp( target, run.points, projection, rgba, 1.5 * unitsPerMeter, ( down ? hi : lo ) * levelHeight + FLOOR_THICKNESS, ( down ? lo : hi ) * levelHeight + FLOOR_THICKNESS );
								if ( t > 0 ) { target.triangles += t; target.features ++; }

							}

						}

					} else if ( indoor === 'lift' && feature.type === 1 ) {

						const r = sourceLayer.featureStart[ f ], v = sourceLayer.ringStart[ r ];
						for ( const level of levels ) {

							const target = levelBlock( level );
							const t = appendShaft( target, sourceLayer.positions[ 2 * v ], sourceLayer.positions[ 2 * v + 1 ], projection, rgba, 2 * unitsPerMeter, lo * levelHeight, hi * levelHeight + wallHeight );
							if ( t > 0 ) { target.triangles += t; target.features ++; }

						}

					}

					continue;

				}

				if ( feature.type === 1 ) continue;
				for ( const level of levels ) {

					const target = levelBlock( level );
					const base = level * levelHeight;
					let t = 0;
					if ( indoor === 'floor' && polygons ) {

						const base = level * levelHeight - floorDrop;

						const holes = holesByLevel.get( level );
						for ( const polygon of polygons ) t += holes ? appendFloorWithHoles( target, polygon, projection, rgba, base, holes ) : appendFloor( target, polygon, projection, rgba, base );

					} else if ( indoor === 'wall' ) {

						const openings = doorsByLevel.get( level ) ?? null;
						if ( polygons ) for ( const polygon of polygons ) for ( const ring of polygon ) t += appendWallRun( target, ring, projection, rgba, base, base + wallHeight, true, openings );
						if ( runs ) for ( const run of runs ) t += appendWallRun( target, run.points, projection, rgba, base, base + wallHeight, false, openings );

					}

					if ( t > 0 ) {

						target.triangles += t;
						target.features ++;

					}

				}

			} else if ( type === 'fill-extrusion' ) {

				if ( feature.type !== 3 ) continue;
				const height = layer.get( 'fill-extrusion-height', zoom, feature );
				const base = layer.get( 'fill-extrusion-base', zoom, feature );
				// Simple 3D Buildings, when the layer asks for them: the roof
				// shape and colours from the feature's own tags
				const roof = roofs ? roofFromTags( feature.properties, height, roofs.levelHeight ) : null;
				const colours = roofs ? roofColours( feature.properties, rgba ) : null;
				const target = colours && colours.glass ? ( glass ?? ( glass = newBlock( layer, index, type, true ) ) ) : block;
				for ( const polygon of featurePolygons( sourceLayer, f, extent ) ) {

					if ( roof ) {

						const t = appendRoofedExtrusion( target, polygon, projection, colours, base, height, roof, unitsPerMeter, coveredFor( f ) );
						triangles += t;
						if ( target !== block ) { target.triangles += t; block.triangles -= t; }

					} else if ( colours ) {

						// a flat building=roof is a slab under its top, as OSM2World draws it
						const slabBase = hasWalls( feature.properties ) ? base : Math.max( base, height - 0.3 );
						const t = appendExtrusion( target, polygon, projection, colours.wall, slabBase, height, colours.roof, entrances, coveredFor( f ) );
						triangles += t;
						if ( target !== block ) { target.triangles += t; block.triangles -= t; }

					} else {

						triangles += appendExtrusion( block, polygon, projection, rgba, base, height, rgba, entrances, coveredFor( f ) );

					}

				}

			} else {

				if ( feature.type === 1 ) continue;
				const props = [
					bakeProps[ 0 ] ? layer.get( 'line-width', zoom, feature ) : 1,
					bakeProps[ 1 ] ? layer.get( 'line-gap-width', zoom, feature ) : 1,
					bakeProps[ 2 ] ? layer.get( 'line-offset', zoom, feature ) : 1,
				];
				const options = {
					join: layer.get( 'line-join', zoom, feature ),
					miterLimit: layer.get( 'line-miter-limit', zoom, feature ),
					gapSigns,
				};
				// polygon rings are drawn as closed lines
				const runs = feature.type === 3
					? featurePolygons( sourceLayer, f, extent ).flat().map( ring => ( { points: ring.concat( [ ring[ 0 ], ring[ 1 ] ] ), startEdge: null, endEdge: null } ) )
					: featureLines( sourceLayer, f, extent );
				for ( const run of runs ) triangles += appendLine( block, run, projection, rgba, props, options );

			}

			if ( triangles > 0 ) {

				block.features ++;
				block.triangles += triangles;

			}

		}

		for ( const b of [ block, outline, glass, ...levelBlocks.values() ] ) {

			const finished = b && finishBlock( b );
			if ( finished ) {

				blocks.push( finished );
				stats.features += finished.features;
				stats.vertices += finished.vertices;
				stats.triangles += finished.triangles;

			}

		}

	}

	stats.buildMs = performance.now() - t0;
	return { blocks, stats, center: projection ? projection.center : null };

}

// The ArrayBuffers to hand over with postMessage.
export function builtTileTransferables( built ) {

	const list = [];
	for ( const block of built.blocks ) {

		for ( const key of [ 'positions', 'colors', 'indices', 'extrudes', 'sides', 'props' ] ) {

			if ( block[ key ] ) list.push( block[ key ].buffer );

		}

	}

	return list;

}

function tileCenterLatitude( y, z ) {

	const n = Math.PI - 2 * Math.PI * ( y + 0.5 ) / ( 1 << z );
	return Math.atan( 0.5 * ( Math.exp( n ) - Math.exp( - n ) ) ) * 180 / Math.PI;

}

// The extrusions of a layer in a tile, for asking which stand at a point:
// their polygons in tile units with their [ base, height ], in a 16 x 16
// grid of the tile so a query looks at a handful.
function indexExtrusions( sourceLayer, layer, zoom, extent ) {

	const cells = 16, size = extent / cells, grid = new Map();
	const items = [];
	for ( let f = 0; f < sourceLayer.featureCount; f ++ ) {

		if ( sourceLayer.types[ f ] !== 3 ) continue;
		const feature = { type: 3, properties: sourceLayer.properties[ f ], id: sourceLayer.ids[ f ] };
		if ( ! layer.matches( zoom, feature ) ) continue;
		const span = [ layer.get( 'fill-extrusion-base', zoom, feature ), layer.get( 'fill-extrusion-height', zoom, feature ) ];
		for ( const polygon of featurePolygons( sourceLayer, f, extent ) ) {

			let minX = Infinity, minY = Infinity, maxX = - Infinity, maxY = - Infinity;
			for ( let i = 0; i < polygon[ 0 ].length; i += 2 ) { minX = Math.min( minX, polygon[ 0 ][ i ] ); maxX = Math.max( maxX, polygon[ 0 ][ i ] ); minY = Math.min( minY, polygon[ 0 ][ i + 1 ] ); maxY = Math.max( maxY, polygon[ 0 ][ i + 1 ] ); }
			const item = { f, span, polygon, minX, minY, maxX, maxY };
			items.push( item );
			for ( let cx = Math.max( 0, Math.floor( minX / size ) ); cx <= Math.min( cells - 1, Math.floor( maxX / size ) ); cx ++ ) {

				for ( let cy = Math.max( 0, Math.floor( minY / size ) ); cy <= Math.min( cells - 1, Math.floor( maxY / size ) ); cy ++ ) {

					const key = cx * cells + cy;
					if ( ! grid.has( key ) ) grid.set( key, [] );
					grid.get( key ).push( item );

				}

			}

		}

	}

	return {
		// the spans of the extrusions other than feature self containing x, y
		at( x, y, self ) {

			const cx = Math.floor( x / size ), cy = Math.floor( y / size );
			if ( cx < 0 || cy < 0 || cx >= cells || cy >= cells ) return [];
			const out = [];
			for ( const item of grid.get( cx * cells + cy ) ?? [] ) {

				if ( item.f === self || x < item.minX || x > item.maxX || y < item.minY || y > item.maxY ) continue;
				if ( insidePolygon( x, y, item.polygon ) ) out.push( item.span );

			}

			return out;

		},
	};

}

function insidePolygon( x, y, polygon ) {

	let inside = false;
	for ( let r = 0; r < polygon.length; r ++ ) {

		const ring = polygon[ r ], n = ring.length / 2;
		let inRing = false;
		for ( let i = 0, j = n - 1; i < n; j = i ++ ) {

			const xi = ring[ 2 * i ], yi = ring[ 2 * i + 1 ], xj = ring[ 2 * j ], yj = ring[ 2 * j + 1 ];
			if ( ( yi > y ) !== ( yj > y ) && x < ( xj - xi ) * ( y - yi ) / ( yj - yi ) + xi ) inRing = ! inRing;

		}

		if ( r === 0 ) inside = inRing; else if ( inRing ) inside = false;

	}

	return inside;

}

