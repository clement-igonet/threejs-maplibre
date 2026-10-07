import { createTileProjection } from './TileProjection.js';
import { appendRoofedExtrusion, hasWalls, roofColours, roofFromTags } from './buildRoofs.js';
import { pointInRing, ringCentroid } from '../indoor/IndoorGraph.js';
import { FLOOR_THICKNESS, LIFT_DOOR_HEIGHT, LIFT_DOOR_WIDTH, STAIR_WIDTH, STAIRWELL_WIDTH, WALL_INSET, appendFillWithHoles, insetRing, appendFloor, appendFloorWithHoles, appendRail, appendRamp, appendShaft, appendSteps, appendWallRun, featureLevels, stairwell } from './buildIndoor.js';
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

// a balustrade's height over the stairs: more than a jump (0.8 m at the
// walk demo's gravity), so the stairs keep the character on them
export const RAIL_HEIGHT = 1.1;

export function buildTile( tile, style, { sourceId, x, y, z, mode = 'globe', datum } ) {

	const t0 = performance.now();
	const blocks = [];
	const escalators = []; // the moving stairs, for the walk: runs in the built frame
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

		// and a footway that crosses a building's outline at street level
		// enters it, whether or not OSM marks the entrance: an opening 2 m
		// wide where it crosses (the glass bubble over the Cour de Rome
		// escalators at Saint-Lazare has footways in and no entrance node)
		if ( type === 'fill-extrusion' && ! indoor && tile.layers.transportation ) {

			const ways = tile.layers.transportation;
			const segments = [];
			for ( let f = 0; f < ways.featureCount; f ++ ) {

				const props = ways.properties[ f ];
				if ( ways.types[ f ] !== 2 || props.class !== 'path' ) continue;
				const levels = featureLevels( props );
				if ( levels.length > 0 && ! levels.includes( 0 ) ) continue;
				for ( const run of featureLines( ways, f, extent ) ) {

					const p = run.points;
					for ( let i = 0; i + 3 < p.length; i += 2 ) segments.push( [ p[ i ], p[ i + 1 ], p[ i + 2 ], p[ i + 3 ] ] );

				}

			}

			if ( segments.length > 0 ) for ( let f = 0; f < sourceLayer.featureCount; f ++ ) {

				if ( sourceLayer.types[ f ] !== 3 ) continue;
				for ( const polygon of featurePolygons( sourceLayer, f, extent ) ) {

					const ring = polygon[ 0 ];
					let minX = Infinity, minY = Infinity, maxX = - Infinity, maxY = - Infinity;
					for ( let i = 0; i < ring.length; i += 2 ) { minX = Math.min( minX, ring[ i ] ); maxX = Math.max( maxX, ring[ i ] ); minY = Math.min( minY, ring[ i + 1 ] ); maxY = Math.max( maxY, ring[ i + 1 ] ); }
					for ( const [ ax, ay, bx, by ] of segments ) {

						if ( Math.max( ax, bx ) < minX || Math.min( ax, bx ) > maxX || Math.max( ay, by ) < minY || Math.min( ay, by ) > maxY ) continue;
						const n = ring.length / 2;
						for ( let i = 0; i < n; i ++ ) {

							const j = ( i + 1 ) % n;
							const hit = segmentCrossing( ax, ay, bx, by, ring[ 2 * i ], ring[ 2 * i + 1 ], ring[ 2 * j ], ring[ 2 * j + 1 ] );
							if ( hit ) ( entrances ??= [] ).push( [ hit[ 0 ], hit[ 1 ], 1.0 * unitsPerMeter, 2.5 ] );

						}

					}

				}

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
				const quads = featureLines( ways, f, extent ).flatMap( run => stairwell( run.points, STAIRWELL_WIDTH * unitsPerMeter ) );
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
		const levelBlock = ( level, kind = indoor ) => {

			const key = kind === indoor ? level : `${ level }:${ kind }`;
			let b = levelBlocks.get( key );
			if ( ! b ) {

				b = newBlock( layer, index, type );
				b.level = level;
				b.indoor = kind; // floor, wall, steps, lift or rail: how a character meets it
				b.base = level * levelHeight; // where the level's floor is
				levelBlocks.set( key, b );

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
						// an escalator (conveying=*) is a smooth ramp that moves the
						// character (see escalators below); stairs are steps
						const conveying = feature.properties.conveying;
						const escalator = conveying !== undefined && conveying !== 'no';
						for ( const run of runs ) {

							const z0 = ( down ? hi : lo ) * levelHeight + FLOOR_THICKNESS, z1 = ( down ? lo : hi ) * levelHeight + FLOOR_THICKNESS;
							if ( escalator ) {

								// the run in the built frame, with its heights, its half
								// width in that frame, and which way the belt goes:
								// 1 along the way, -1 against it, 0 whichever way one faces
								const p = run.points, positions = [], v = [ 0, 0, 0 ];
								const lengths = [ 0 ];
								for ( let i = 2; i < p.length; i += 2 ) lengths.push( lengths[ lengths.length - 1 ] + Math.hypot( p[ i ] - p[ i - 2 ], p[ i + 1 ] - p[ i - 1 ] ) );
								const total = lengths[ lengths.length - 1 ] || 1;
								for ( let i = 0; i < p.length; i += 2 ) { projection.project( p[ i ], p[ i + 1 ], z0 + ( z1 - z0 ) * lengths[ i / 2 ] / total, v ); positions.push( v[ 0 ], v[ 1 ], v[ 2 ] ); }
								projection.project( p[ 0 ], p[ 1 ], 0, v ); const ax = v[ 0 ], az = v[ 2 ];
								projection.project( p[ 0 ] + unitsPerMeter, p[ 1 ], 0, v );
								const scenePerMeter = Math.hypot( v[ 0 ] - ax, v[ 2 ] - az ) || 1;
								escalators.push( { positions, halfWidth: STAIR_WIDTH / 2 * scenePerMeter, direction: conveying === 'forward' ? 1 : conveying === 'backward' ? - 1 : 0 } );

							}

							for ( const level of levels ) {

								const target = levelBlock( level );
								const t = escalator ? appendRamp( target, run.points, projection, rgba, STAIR_WIDTH * unitsPerMeter, z0, z1 ) : appendSteps( target, run.points, projection, rgba, STAIR_WIDTH * unitsPerMeter, z0, z1 );
								if ( t > 0 ) { target.triangles += t; target.features ++; }
								// the balustrades, in a block of their own: solid from
								// every side, where the ramp holds from above only
								const rails = levelBlock( level, 'rail' );
								const tr = appendRail( rails, run.points, projection, rgba, STAIR_WIDTH * unitsPerMeter, z0, z1, RAIL_HEIGHT );
								if ( tr > 0 ) { rails.triangles += tr; rails.features ++; }

							}

						}

					} else if ( indoor === 'lift' && feature.type === 1 ) {

						const r = sourceLayer.featureStart[ f ], v = sourceLayer.ringStart[ r ];
						const lx = sourceLayer.positions[ 2 * v ], ly = sourceLayer.positions[ 2 * v + 1 ];
						// the doorway faces the middle of the room the lift stands in
						// (its space in OSM, a room tagged elevator as a rule), or
						// north when it stands in none
						const opening = { side: 0, levels, levelHeight, doorWidth: LIFT_DOOR_WIDTH * unitsPerMeter, doorHeight: LIFT_DOOR_HEIGHT };
						const rooms = tile.layers.indoor;
						if ( rooms ) for ( let g = 0; g < rooms.featureCount; g ++ ) {

							if ( rooms.types[ g ] !== 3 ) continue;
							const cls = rooms.properties[ g ].class;
							if ( cls !== 'room' && cls !== 'area' && cls !== 'corridor' ) continue;
							const ring = featurePolygons( rooms, g, extent )[ 0 ]?.[ 0 ];
							if ( ! ring || ! pointInRing( lx, ly, ring ) ) continue;
							const [ cx, cy ] = ringCentroid( ring );
							const dx = cx - lx, dy = cy - ly;
							opening.side = Math.abs( dx ) > Math.abs( dy ) ? ( dx > 0 ? 1 : 3 ) : ( dy > 0 ? 2 : 0 );
							break;

						}

						for ( const level of levels ) {

							const target = levelBlock( level );
							const t = appendShaft( target, lx, ly, projection, rgba, 2 * unitsPerMeter, lo * levelHeight, hi * levelHeight + wallHeight, opening );
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
						// a room's walls 5 cm inside its ring: on the ring they share
						// a plane with the building's facade and the next room's walls
						if ( polygons ) for ( const polygon of polygons ) for ( const ring of polygon ) t += appendWallRun( target, insetRing( ring, WALL_INSET * unitsPerMeter ), projection, rgba, base, base + wallHeight, true, openings );
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
	return { blocks, stats, center: projection ? projection.center : null, escalators };

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
// Where two segments cross, [ x, y ], or null when they do not
function segmentCrossing( ax, ay, bx, by, cx, cy, dx, dy ) {

	const r1x = bx - ax, r1y = by - ay, r2x = dx - cx, r2y = dy - cy;
	const den = r1x * r2y - r1y * r2x;
	if ( Math.abs( den ) < 1e-12 ) return null;
	const t = ( ( cx - ax ) * r2y - ( cy - ay ) * r2x ) / den;
	const u = ( ( cx - ax ) * r1y - ( cy - ay ) * r1x ) / den;
	if ( t < 0 || t > 1 || u < 0 || u > 1 ) return null;
	return [ ax + r1x * t, ay + r1y * t ];

}

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

