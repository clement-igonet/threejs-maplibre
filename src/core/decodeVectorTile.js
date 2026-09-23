import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

// Decodes an MVT buffer into flat, transferable arrays: one block per source
// layer, with every feature's rings stored end to end in a single Int32Array
// of tile coordinates (0..extent, y down, possibly outside the tile by the
// source's buffer). This is the shape the geometry builders consume and what
// a Worker hands back to the main thread without copying.
//
//   layer.types[ f ]                    1 point, 2 line, 3 polygon
//   layer.ids[ f ]                      feature id or NaN
//   layer.properties[ f ]               attribute object
//   rings of feature f                  featureStart[ f ] .. featureStart[ f + 1 ]
//   vertices of ring r                  ringStart[ r ] .. ringStart[ r + 1 ]
//   vertex v                            positions[ 2 * v ], positions[ 2 * v + 1 ]
//
// Polygon rings keep their MVT winding (exterior clockwise, holes counter
// clockwise in tile space); classifying them is the builders' job.

export function decodeVectorTile( buffer ) {

	const tile = new VectorTile( new Pbf( buffer ) );
	const layers = {};

	for ( const name in tile.layers ) {

		const source = tile.layers[ name ];
		const count = source.length;
		const types = new Uint8Array( count );
		const ids = new Float64Array( count );
		const properties = new Array( count );
		const featureStart = new Uint32Array( count + 1 );
		const geometries = new Array( count );
		let ringCount = 0;
		let vertexCount = 0;

		for ( let f = 0; f < count; f ++ ) {

			const feature = source.feature( f );
			const rings = feature.loadGeometry();
			types[ f ] = feature.type;
			ids[ f ] = feature.id === undefined ? NaN : feature.id;
			properties[ f ] = feature.properties;
			geometries[ f ] = rings;
			featureStart[ f ] = ringCount;
			ringCount += rings.length;
			for ( const ring of rings ) vertexCount += ring.length;

		}

		featureStart[ count ] = ringCount;

		const ringStart = new Uint32Array( ringCount + 1 );
		const positions = new Int32Array( 2 * vertexCount );
		let r = 0;
		let v = 0;

		for ( let f = 0; f < count; f ++ ) {

			for ( const ring of geometries[ f ] ) {

				ringStart[ r ++ ] = v;
				for ( const point of ring ) {

					positions[ 2 * v ] = point.x;
					positions[ 2 * v + 1 ] = point.y;
					v ++;

				}

			}

		}

		ringStart[ ringCount ] = v;

		layers[ name ] = {
			name,
			extent: source.extent,
			version: source.version,
			featureCount: count,
			types, ids, properties, featureStart, ringStart, positions,
		};

	}

	return { layers };

}

// The ArrayBuffers to hand over with postMessage.
export function vectorTileTransferables( tile ) {

	const list = [];
	for ( const name in tile.layers ) {

		const layer = tile.layers[ name ];
		list.push( layer.types.buffer, layer.ids.buffer, layer.featureStart.buffer, layer.ringStart.buffer, layer.positions.buffer );

	}

	return list;

}

// Iterates one feature's rings as arrays of [x, y] pairs; convenient for
// tests and small consumers, not for the builders (they index the arrays).
export function featureRings( layer, f ) {

	const rings = [];
	for ( let r = layer.featureStart[ f ]; r < layer.featureStart[ f + 1 ]; r ++ ) {

		const ring = [];
		for ( let v = layer.ringStart[ r ]; v < layer.ringStart[ r + 1 ]; v ++ ) {

			ring.push( [ layer.positions[ 2 * v ], layer.positions[ 2 * v + 1 ] ] );

		}

		rings.push( ring );

	}

	return rings;

}
