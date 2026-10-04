import { createTileProjection } from './TileProjection.js';
import { appendRoofedExtrusion, roofColours, roofFromTags } from './buildRoofs.js';
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
		let glass = null; // translucent features go in a block of their own
		// tile units per meter at this tile, for roofs sized from their footprint
		const unitsPerMeter = extent / ( 40075016.686 * Math.cos( tileCenterLatitude( y, z ) * Math.PI / 180 ) / ( 1 << z ) );

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
				for ( const polygon of featurePolygons( sourceLayer, f, extent ) ) {

					triangles += appendFill( block, polygon, projection, rgba );
					if ( outline ) {

						const outlineRGBA = toRGBA( layer.get( 'fill-outline-color', zoom, feature ), 1 );
						for ( const ring of polygon ) {

							const points = ring.concat( [ ring[ 0 ], ring[ 1 ] ] );
							outline.triangles += appendLine( outline, { points, startEdge: null, endEdge: null }, projection, outlineRGBA, [ 1, 0, 0 ] );

						}

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

						const t = appendRoofedExtrusion( target, polygon, projection, colours, base, height, roof, unitsPerMeter );
						triangles += t;
						if ( target !== block ) { target.triangles += t; block.triangles -= t; }

					} else if ( colours ) {

						const t = appendExtrusion( target, polygon, projection, colours.wall, base, height, colours.roof );
						triangles += t;
						if ( target !== block ) { target.triangles += t; block.triangles -= t; }

					} else {

						triangles += appendExtrusion( block, polygon, projection, rgba, base, height );

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

		for ( const b of [ block, outline, glass ] ) {

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
