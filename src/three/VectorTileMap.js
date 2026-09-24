import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SRGBColorSpace, Vector3 } from 'three';
import { VectorTileLoader } from '../core/VectorTileLoader.js';
import { EARTH_RADIUS, metersToNormalized, normalizedToLatitude } from '../math/WebMercator.js';
import { geocentricHeight, rayEllipsoidIntersection } from '../math/Ellipsoid.js';
import { TileTree } from './TileTree.js';
import { VectorLineMaterial } from './VectorLineMaterial.js';

const DEG2RAD = Math.PI / 180;
const _hit = new Vector3();
const _camPos = new Vector3();
const _dir = new Vector3();

// Vector tiles styled by a MapLibre style, on the shared quadtree. The
// content of a tile is the set of geometry blocks the Worker built for it
// (one per style layer with something to draw); its object is a Group of
// meshes placed at the tile center, one mesh per block, sharing the layer's
// material. Materials carry what the style evaluates from zoom alone: every
// frame the map zoom is derived from the camera (MapLibre's convention: a 512
// px tile at integer zoom) and the camera-kind properties of each layer are
// re-evaluated into uniforms. Draw order follows the style: meshes render in
// layer order, extrusions opaque with depth, fills and lines without depth
// writes so coplanar layers stack instead of fighting.

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
		this._materials = new Map(); // block key -> { material, layer, type }

		// cumulative: tiles built so far and the Worker time they took
		this.stats.built = 0;
		this.stats.buildMs = 0;

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

	// Wraps the blocks' arrays into geometries. The GPU upload itself happens
	// at the tile's first draw; what the budget meters is the attribute setup.
	_upload( built ) {

		built.geometries = built.blocks.map( block => {

			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new BufferAttribute( block.positions, 3 ) );
			geometry.setIndex( new BufferAttribute( block.indices, 1 ) );

			if ( block.type === 'line' ) {

				geometry.setAttribute( 'extrude', new BufferAttribute( block.extrudes, 3 ) );
				geometry.setAttribute( 'lineSide', new BufferAttribute( block.sides, 2 ) );
				geometry.setAttribute( 'lineProps', new BufferAttribute( block.props, 3 ) );
				geometry.setAttribute( 'lineColor', new BufferAttribute( block.colors, 4, true ) );

			} else {

				geometry.setAttribute( 'color', new BufferAttribute( block.colors, 4, true ) );
				if ( block.normals ) geometry.setAttribute( 'normal', new BufferAttribute( block.normals, 3 ) );

			}

			geometry.computeBoundingSphere();
			return geometry;

		} );

		built.uploaded = true;

	}

	_disposeContent( built ) {

		if ( built.geometries ) for ( const geometry of built.geometries ) geometry.dispose();
		built.geometries = null;
		built.uploaded = false;

	}

	_createObject( record ) {

		const built = record.content;
		const group = new Group();
		if ( built.center ) group.position.copy( built.center ); // null when nothing was built

		built.blocks.forEach( ( block, i ) => {

			const mesh = new Mesh( built.geometries[ i ], this._material( block ) );
			mesh.renderOrder = block.index;
			group.add( mesh );

		} );

		return group;

	}

	_disposeObject( record ) {

		record.object.clear(); // geometries belong to the content, materials to the layer

	}

	_setOpacity( record, opacity ) {} // eslint-disable-line no-unused-vars

	// --- materials ----------------------------------------------------------

	_material( block ) {

		const key = `${ block.index }:${ block.type }`;
		let entry = this._materials.get( key );
		if ( entry ) return entry.material;

		const layer = this.style.layers[ block.index ];
		let material;

		if ( block.type === 'line' ) {

			material = new VectorLineMaterial();

		} else if ( block.type === 'fill-extrusion' ) {

			material = new MeshLambertMaterial( { vertexColors: true } );

		} else {

			material = new MeshBasicMaterial( { vertexColors: true, transparent: true, depthWrite: false } );

		}

		// an outline block is the line drawn around a fill layer
		const outline = layer.type === 'fill' && block.type === 'line';
		entry = { material, layer, type: block.type, outline };
		this._materials.set( key, entry );
		this._updateMaterial( entry );
		return material;

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

		const size = renderer.getSize ? renderer.getSize( _size ) : { height: renderer.domElement.height };
		const pixelScale = 2 * Math.tan( 0.5 * camera.fov * DEG2RAD ) / size.height;

		for ( const entry of this._materials.values() ) {

			this._updateMaterial( entry );
			if ( entry.type === 'line' ) entry.material.uniforms.pixelScale.value = pixelScale;

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
		for ( const { material } of this._materials.values() ) material.dispose();
		this._materials.clear();

	}

}

const _size = { width: 0, height: 0, set( w, h ) { this.width = w; this.height = h; return this; } };

function isBaked( kind ) {

	return kind === 'source' || kind === 'composite';

}
