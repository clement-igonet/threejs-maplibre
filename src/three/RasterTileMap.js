import { Mesh, MeshBasicMaterial } from 'three';
import { ImageTileLoader } from '../core/ImageTileLoader.js';
import { TileTree } from './TileTree.js';

// Raster tiles on the shared quadtree: the content of a tile is a decoded
// texture, its object a textured patch of the globe or plane. See TileTree
// for selection, refinement, caching and the upload budget.

export class RasterTileMap extends TileTree {

	constructor( source, { globeSegments = 16, ...options } = {} ) {

		super( source, options );

		this.globeSegments = globeSegments;
		this._loader = new ImageTileLoader();

	}

	_load( record ) {

		const url = this.source.tileUrl( record.x, record.y, record.z );
		return this._loader.load( record.key, url );

	}

	_abortLoad( record ) {

		this._loader.abort( record.key );

	}

	get _pendingLoads() {

		return this._loader.pendingCount;

	}

	_isUploaded( texture ) {

		return texture.userData.uploaded === true;

	}

	_upload( texture, renderer ) {

		renderer.initTexture( texture );
		texture.userData.uploaded = true;

	}

	_disposeContent( texture ) {

		texture.dispose();

	}

	_createObject( record ) {

		const segments = this.mode === 'globe' ? this.globeSegments : 1;
		const { geometry, center } = this._createPatch( record, segments );
		const material = new MeshBasicMaterial( {
			map: record.content,
			transparent: true,
			opacity: record.opacity,
			// deeper tiles draw over their coplanar ancestors during refinement
			polygonOffset: true,
			polygonOffsetFactor: - record.z,
			polygonOffsetUnits: - record.z,
		} );
		const mesh = new Mesh( geometry, material );
		mesh.position.copy( center );
		mesh.renderOrder = record.z;
		return mesh;

	}

	_disposeObject( record ) {

		record.object.geometry.dispose();
		record.object.material.dispose();

	}

	_setOpacity( record, opacity ) {

		record.object.material.opacity = opacity;

	}

	dispose() {

		this._loader.abortAll();
		super.dispose();

	}

}
