import { BatchedMesh, BufferAttribute, BufferGeometry, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Object3D, SRGBColorSpace, Vector3 } from 'three';
import { VectorTileLoader } from '../core/VectorTileLoader.js';
import { EARTH_RADIUS, metersToNormalized, normalizedToLatitude } from '../math/WebMercator.js';
import { geocentricHeight, rayEllipsoidIntersection } from '../math/Ellipsoid.js';
import { TileTree } from './TileTree.js';
import { VectorLineMaterial } from './VectorLineMaterial.js';

const DEG2RAD = Math.PI / 180;
const _hit = new Vector3();
const _camPos = new Vector3();
const _dir = new Vector3();
const _offset = new Vector3();
const _matrix = new Matrix4();
const _geometry = new BufferGeometry(); // staging for BatchedMesh.addGeometry

// A layer's batch starts at twice the first tile it holds, never below
// these, and grows by GROWTH when a tile does not fit. A style layer that
// draws a handful of features keeps a handful of kilobytes, which matters
// on a style with a hundred layers.
const BATCH_INSTANCES = 32;
const MIN_VERTICES = 1 << 12;
const MIN_INDICES = 1 << 14;
const GROWTH = 1.5;

// Vector tiles styled by a MapLibre style, on the shared quadtree. The
// content of a tile is the set of geometry blocks the Worker built for it
// (one per style layer with something to draw). Each layer owns one
// BatchedMesh: uploading a tile copies its blocks into the layers' batches,
// drawing it adds one instance per block, placed at the tile center, so a
// layer costs one draw call however many tiles it spans. Materials carry
// what the style evaluates from zoom alone: every frame the map zoom is
// derived from the camera (MapLibre's convention: a 512 px tile at integer
// zoom) and the camera-kind properties of each layer are re-evaluated into
// uniforms. Draw order follows the style: batches render in layer order,
// extrusions opaque with depth, fills and lines without depth writes so
// coplanar layers stack instead of fighting.
//
// Instance matrices are float32 on the GPU, so tile centers are not stored
// in ECEF (millions of meters, half a meter of precision) but relative to a
// floating origin that follows the camera: the batches sit at the origin and
// every instance holds its tile center minus the origin. When the camera
// gets more than originRadius away, the origin moves and the matrices are
// rewritten, a few dozen at a time.

export class VectorTileMap extends TileTree {

	constructor( source, style, {
		sourceId = null,
		workers = 2,
		createWorker,
		fadeDuration = 0, // vector tiles pop in, as in MapLibre
		// geometry has no texels to blur: a tile serves until its 512 texels
		// span more than 2 px each, the zoom MapLibre would fetch it at
		maxScreenTexel = 2,
		...options
	} = {} ) {

		super( source, { fadeDuration, maxScreenTexel, ...options } );

		this.style = style;
		this.sourceId = sourceId ?? Object.keys( style.sources )[ 0 ] ?? 'vector';
		this.zoom = 0; // map zoom derived from the camera, for camera-kind properties

		this._loader = new VectorTileLoader( { workers, createWorker } );
		this._loader.configure( { style, sourceId: this.sourceId, mode: this.mode } );
		this._materials = new Map(); // block key -> { material, layer, type, outline, batch, instances }
		this._origin = new Vector3(); // layer-local; where the batches sit
		this.originRadius = 10000; // meters the camera may move before the origin follows

		// cumulative: tiles built so far and the Worker time they took
		this.stats.built = 0;
		this.stats.buildMs = 0;
		// bytes the layer batches reserve, and what the tiles in them occupy
		this.stats.batchBytes = 0;
		this.stats.geometryBytes = 0;

	}

	// --- content hooks ------------------------------------------------------

	_load( record ) {

		const url = this.source.tileUrl( record.x, record.y, record.z );
		return this._loader.load( record.key, url, record ).then( built => {

			this.stats.built ++;
			this.stats.buildMs += built.stats.buildMs;
			built.uploaded = false;
			return built;

		} );

	}

	_abortLoad( record ) {

		this._loader.abort( record.key );

	}

	get _pendingLoads() {

		return this._loader.pendingCount;

	}

	_isUploaded( built ) {

		return built.uploaded;

	}

	// Copies the blocks into their layers' batches. The GPU upload of the
	// written ranges happens at the next draw; what the budget meters is the
	// copy and the batch growth.
	_upload( built ) {

		built.slots = built.blocks.map( block => {

			const entry = this._entry( block );
			const batch = entry.batch;

			_geometry.setAttribute( 'position', new BufferAttribute( block.positions, 3 ) );
			_geometry.setIndex( new BufferAttribute( block.indices, 1 ) );

			if ( block.type === 'line' ) {

				_geometry.setAttribute( 'extrude', new BufferAttribute( block.extrudes, 3 ) );
				_geometry.setAttribute( 'lineSide', new BufferAttribute( block.sides, 2 ) );
				_geometry.setAttribute( 'lineProps', new BufferAttribute( block.props, 3 ) );
				_geometry.setAttribute( 'lineColor', new BufferAttribute( block.colors, 4, true ) );

			} else {

				_geometry.setAttribute( 'color', new BufferAttribute( block.colors, 4, true ) );
				if ( block.normals ) _geometry.setAttribute( 'normal', new BufferAttribute( block.normals, 3 ) );

			}

			this._reserve( batch, block.positions.length / 3, block.indices.length );
			const geometryId = batch.addGeometry( _geometry );

			for ( const name of Object.keys( _geometry.attributes ) ) _geometry.deleteAttribute( name );
			_geometry.setIndex( null );

			return { entry, geometryId };

		} );

		// the batches own the geometry now: the Worker's arrays can go, only
		// what a block was stays, for debugging
		built.blocks = built.blocks.map( ( { id, index, type } ) => ( { id, index, type } ) );
		built.uploaded = true;

	}

	// Makes room for a block at the end of the batch: repacks what deleted
	// tiles left behind, and grows the buffers when that is not enough.
	_reserve( batch, vertices, indices ) {

		if ( batch.unusedVertexCount >= vertices && batch.unusedIndexCount >= indices ) return;

		let usedVertices = 0, usedIndices = 0;
		for ( const info of batch._geometryInfo ) {

			if ( ! info.active ) continue;
			usedVertices += info.reservedVertexCount;
			usedIndices += info.reservedIndexCount;

		}

		let maxVertices = batch._maxVertexCount, maxIndices = batch._maxIndexCount;
		while ( maxVertices - usedVertices < vertices ) maxVertices = Math.ceil( maxVertices * GROWTH );
		while ( maxIndices - usedIndices < indices ) maxIndices = Math.ceil( maxIndices * GROWTH );
		if ( maxVertices !== batch._maxVertexCount || maxIndices !== batch._maxIndexCount ) batch.setGeometrySize( maxVertices, maxIndices );
		batch.optimize();

	}

	_disposeContent( built ) {

		if ( built.slots ) for ( const { entry, geometryId } of built.slots ) entry.batch.deleteGeometry( geometryId );
		built.slots = null;
		built.uploaded = false;

	}

	// The tile's object is a placeholder; what draws are its instances in
	// the layer batches.
	_createObject( record ) {

		const built = record.content;
		const object = new Object3D();
		object.matrixAutoUpdate = false;
		object.instances = built.slots.map( ( { entry, geometryId } ) => {

			const batch = entry.batch;
			if ( entry.instances >= batch.maxInstanceCount ) batch.setInstanceCount( Math.ceil( batch.maxInstanceCount * GROWTH ) );
			entry.instances ++;
			const id = batch.addInstance( geometryId );
			batch.setVisibleAt( id, false );
			this._placeInstance( batch, id, built.center );
			return { entry, id };

		} );

		return object;

	}

	_disposeObject( record ) {

		for ( const { entry, id } of record.object.instances ) {

			entry.batch.deleteInstance( id );
			entry.instances --;

		}

		record.object.instances = null;

	}

	_setVisible( record, visible ) {

		record.object.visible = visible;
		for ( const { entry, id } of record.object.instances ) entry.batch.setVisibleAt( id, visible );

	}

	_placeInstance( batch, id, center ) {

		_offset.copy( center ).sub( this._origin );
		batch.setMatrixAt( id, _matrix.makeTranslation( _offset.x, _offset.y, _offset.z ) );

	}

	_setOpacity( record, opacity ) {} // eslint-disable-line no-unused-vars

	// --- materials ----------------------------------------------------------

	_entry( block ) {

		const key = `${ block.index }:${ block.type }`;
		let entry = this._materials.get( key );
		if ( entry ) return entry;

		const layer = this.style.layers[ block.index ];
		let material;

		if ( block.type === 'line' ) {

			material = new VectorLineMaterial();

		} else if ( block.type === 'fill-extrusion' ) {

			material = new MeshLambertMaterial( { vertexColors: true } );

		} else {

			material = new MeshBasicMaterial( { vertexColors: true, transparent: true, depthWrite: false } );

		}

		const batch = new BatchedMesh(
			BATCH_INSTANCES,
			Math.max( MIN_VERTICES, 2 * block.positions.length / 3 ),
			Math.max( MIN_INDICES, 2 * block.indices.length ),
			material,
		);
		batch.renderOrder = block.index;
		batch.frustumCulled = false; // the quadtree culls per tile already
		batch.perObjectFrustumCulled = false;
		batch.sortObjects = false;
		batch.matrixAutoUpdate = false;
		batch.position.copy( this._origin );
		batch.updateMatrix();
		this.add( batch );

		// an outline block is the line drawn around a fill layer
		const outline = layer.type === 'fill' && block.type === 'line';
		entry = { material, layer, type: block.type, outline, batch, instances: 0 };
		this._materials.set( key, entry );
		this._updateMaterial( entry );
		return entry;

	}

	// Evaluates the layer's camera-kind properties at the current zoom.
	_updateMaterial( { material, layer, type, outline } ) {

		const zoom = this.zoom;
		material.visible = zoom >= layer.minzoom && zoom < layer.maxzoom;

		if ( outline ) {

			material.color.setRGB( 1, 1, 1 );
			material.opacity = 1;
			material.uniforms.propScale.value.set( 1, 1, 1 );
			return;

		}

		const colorName = `${ type }-color`;
		const opacityName = `${ type }-opacity`;
		let alpha = 1;

		if ( ! isBaked( layer.kind( colorName ) ) ) {

			const [ r, g, b, a ] = layer.get( colorName, zoom ).rgb;
			material.color.setRGB( r, g, b, SRGBColorSpace );
			alpha = a;

		} else {

			material.color.setRGB( 1, 1, 1 );

		}

		if ( ! isBaked( layer.kind( opacityName ) ) ) alpha *= layer.get( opacityName, zoom );
		material.opacity = alpha;

		if ( type === 'fill-extrusion' ) {

			material.transparent = alpha < 1;

		} else if ( type === 'line' ) {

			material.uniforms.propScale.value.set(
				isBaked( layer.kind( 'line-width' ) ) ? 1 : layer.get( 'line-width', zoom ),
				isBaked( layer.kind( 'line-gap-width' ) ) ? 1 : layer.get( 'line-gap-width', zoom ),
				isBaked( layer.kind( 'line-offset' ) ) ? 1 : layer.get( 'line-offset', zoom ),
			);

		}

	}

	// --- per-frame ----------------------------------------------------------

	_beforeWalk( camera, renderer ) {

		this.zoom = this._cameraZoom( camera, renderer );
		this._followCamera( camera );
		this._measureBatches();

		const size = renderer.getSize ? renderer.getSize( _size ) : { height: renderer.domElement.height };
		const pixelScale = 2 * Math.tan( 0.5 * camera.fov * DEG2RAD ) / size.height;

		for ( const entry of this._materials.values() ) {

			this._updateMaterial( entry );
			if ( entry.type === 'line' ) entry.material.uniforms.pixelScale.value = pixelScale;

		}

	}

	// What the batches cost: the buffers they reserve against the geometry
	// the tiles in them actually occupy. The gap is the room left for the
	// tiles still to come.
	_measureBatches() {

		let reserved = 0, used = 0;

		for ( const { batch } of this._materials.values() ) {

			const geometry = batch.geometry;
			let vertexBytes = 0;

			for ( const attribute of Object.values( geometry.attributes ) ) {

				reserved += attribute.array.byteLength;
				vertexBytes += attribute.itemSize * attribute.array.BYTES_PER_ELEMENT;

			}

			const indexBytes = geometry.index ? geometry.index.array.BYTES_PER_ELEMENT : 0;
			if ( geometry.index ) reserved += geometry.index.array.byteLength;

			for ( const info of batch._geometryInfo ) {

				if ( info.active ) used += info.vertexCount * vertexBytes + info.indexCount * indexBytes;

			}

		}

		this.stats.batchBytes = reserved;
		this.stats.geometryBytes = used;

	}

	// Moves the origin to the camera once it has drifted originRadius away,
	// rewriting the batches' positions and every instance matrix.
	_followCamera( camera ) {

		_camPos.setFromMatrixPosition( camera.matrixWorld ).applyMatrix4( _matrix.copy( this.matrixWorld ).invert() );
		if ( _camPos.distanceTo( this._origin ) < this.originRadius ) return;

		this._origin.copy( _camPos );
		for ( const { batch } of this._materials.values() ) {

			batch.position.copy( this._origin );
			batch.updateMatrix();

		}

		for ( const record of this._records.values() ) {

			if ( ! record.object ) continue;
			for ( const { entry, id } of record.object.instances ) this._placeInstance( entry.batch, id, record.content.center );

		}

	}

	// MapLibre zoom of the view: the ground under the view center is found
	// (plane in planar mode, sphere on the globe), the meters one pixel covers
	// there give the zoom at which a 512 px tile spans that many meters.
	_cameraZoom( camera, renderer ) {

		this.updateWorldMatrix( true, false );
		_camPos.setFromMatrixPosition( camera.matrixWorld );
		_dir.set( 0, 0, - 1 ).transformDirection( camera.matrixWorld );

		let distance, latitude;

		if ( this.mode === 'planar' ) {

			const t = _dir.y < 0 ? - _camPos.y / _dir.y : Infinity;
			distance = Number.isFinite( t ) ? t : _camPos.y;
			_hit.copy( _camPos ).addScaledVector( _dir, Number.isFinite( t ) ? t : 0 );
			const [ , ny ] = metersToNormalized( _hit.x, - _hit.z );
			latitude = normalizedToLatitude( Math.min( Math.max( ny, 0 ), 1 ) );

		} else {

			if ( rayEllipsoidIntersection( _camPos, _dir, _hit ) ) {

				distance = _hit.distanceTo( _camPos );

			} else {

				// looking past the globe: use the nearest point of the surface
				distance = Math.max( geocentricHeight( _camPos ), 1 );
				_hit.copy( _camPos );

			}

			latitude = Math.asin( Math.min( Math.max( _hit.y / _hit.length(), - 1 ), 1 ) ) / DEG2RAD;

		}

		const size = renderer.getSize ? renderer.getSize( _size ) : { height: renderer.domElement.height };
		const unitsPerPixel = distance * 2 * Math.tan( 0.5 * camera.fov * DEG2RAD ) / size.height;
		// planar units are Mercator meters already; ground meters on the globe
		// stretch by 1 / cos( latitude ) in Mercator
		const mercatorPerPixel = this.mode === 'planar' ? unitsPerPixel : unitsPerPixel / Math.cos( latitude * DEG2RAD );
		return Math.log2( 2 * Math.PI * EARTH_RADIUS / ( mercatorPerPixel * 512 ) );

	}

	dispose() {

		this._loader.dispose();
		super.dispose();
		for ( const { material, batch } of this._materials.values() ) {

			this.remove( batch );
			batch.dispose();
			material.dispose();

		}

		this._materials.clear();

	}

}

const _size = { width: 0, height: 0, set( w, h ) { this.width = w; this.height = h; return this; } };

function isBaked( kind ) {

	return kind === 'source' || kind === 'composite';

}
