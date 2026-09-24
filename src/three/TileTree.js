import { Box3, Frustum, Group, Matrix4, Vector3 } from 'three';
import { LRUTileCache } from '../core/LRUTileCache.js';
import { normalizedToLatitude, texelSizeMeters } from '../math/WebMercator.js';
import { createGlobePatch, createPlanarPatch } from './TilePatchGeometry.js';

const DEG2RAD = Math.PI / 180;
const _matrix = new Matrix4();
const _frustum = new Frustum();
const _camLocal = new Vector3();

// The Web Mercator quadtree shared by the raster and vector engines. How a
// frame decides what to draw:
// 1. A quadtree walk from the root tiles selects the leaf set: a tile is
//    split while one of its texels projects to more than "maxScreenTexel"
//    pixels on screen (screen-space error), down to the source's maxZoom.
// 2. A second walk renders the selection with replace refinement: a selected
//    tile draws once its content is loaded, uploaded and faded in; until
//    every child of an inner node covers its area, the nearest ready ancestor
//    keeps drawing underneath so refinement never opens holes.
// 3. Tiles that left the selection keep their content in an LRU cache;
//    in-flight requests for tiles that left the selection are aborted.
// 4. Content reaches the GPU through a per-frame time budget: a tile whose
//    content is not uploaded yet counts as not ready, so its ancestor keeps
//    drawing and a burst of arrivals never stalls one frame.
//
// Subclasses provide the content: what to load for a tile, how to upload it,
// which object to draw and how to fade it.

export class TileTree extends Group {

	constructor( source, {
		mode = 'globe', // 'globe' | 'planar'
		maxScreenTexel = 1.4, // split while a texel covers more than this many pixels
		fadeDuration = 200, // ms; 0 draws a tile as soon as it is ready
		cacheSize = 512,
		retainFrames = 60, // frames an unused tile keeps its object
		uploadBudgetMs = 2, // uploads per frame stop once this is spent (at least one)
	} = {} ) {

		super();

		this.source = source;
		this.mode = mode;
		this.maxScreenTexel = maxScreenTexel;
		this.fadeDuration = fadeDuration;
		this.retainFrames = retainFrames;
		this.uploadBudgetMs = uploadBudgetMs;

		this._cache = new LRUTileCache( {
			capacity: cacheSize,
			onEvict: ( key, content ) => this._disposeContent( content ),
		} );
		this._records = new Map();
		this._frame = 0;
		this._shown = new Set();
		this._uploadQueue = [];

		// stats for tests, demos and CI budgets
		this.stats = { selected: 0, rendered: 0, loading: 0, culled: 0, created: 0, uploaded: 0, uploadMs: 0 };

	}

	// --- content hooks ------------------------------------------------------

	// Promise of the tile's content (a texture, built geometry, ...).
	_load( record ) { // eslint-disable-line no-unused-vars

		throw new Error( 'TileTree: _load() must be implemented.' );

	}

	_abortLoad( record ) {} // eslint-disable-line no-unused-vars

	get _pendingLoads() {

		return 0;

	}

	_isUploaded( content ) { // eslint-disable-line no-unused-vars

		return true;

	}

	_upload( content, renderer ) {} // eslint-disable-line no-unused-vars

	_disposeContent( content ) {} // eslint-disable-line no-unused-vars

	// Creates record.object (added to this group, initially invisible).
	_createObject( record ) { // eslint-disable-line no-unused-vars

		throw new Error( 'TileTree: _createObject() must be implemented.' );

	}

	_disposeObject( record ) { // eslint-disable-line no-unused-vars

	}

	_setOpacity( record, opacity ) {} // eslint-disable-line no-unused-vars

	// Ground size in meters of one "texel" of the tile, for the split test.
	_texelSize( record ) {

		return texelSizeMeters( record.z, record.centerLat, this.source.tileResolution );

	}

	// --- record management -------------------------------------------------

	_key( x, y, z ) {

		return `${ z }/${ x }/${ y }`;

	}

	_getRecord( x, y, z ) {

		const key = this._key( x, y, z );
		let record = this._records.get( key );
		if ( ! record ) {

			const centerLat = normalizedToLatitude( ( y + 0.5 ) / ( 1 << z ) );
			record = {
				key, x, y, z, centerLat,
				state: 'empty', // empty | loading | ready | failed
				object: null,
				content: null,
				opacity: 0,
				bounds: null,
				lastUsed: 0,
				queued: false,
			};
			this._records.set( key, record );

		}

		return record;

	}

	_getBounds( record ) {

		if ( record.bounds === null ) {

			// sample the patch surface so globe curvature is inside the box
			const { geometry, center } = this._createPatch( record, this.mode === 'globe' ? 4 : 1 );
			geometry.boundingBox.translate( center );
			record.bounds = new Box3().copy( geometry.boundingBox );
			geometry.dispose();

		}

		return record.bounds;

	}

	_createPatch( record, segments ) {

		const { x, y, z } = record;
		return this.mode === 'globe'
			? createGlobePatch( x, y, z, segments )
			: createPlanarPatch( x, y, z, segments );

	}

	// --- loading ------------------------------------------------------------

	_ensureLoaded( record ) {

		if ( record.state !== 'empty' ) return;

		const cached = this._cache.get( record.key );
		if ( cached ) {

			record.content = cached;
			record.state = 'ready';
			return;

		}

		record.state = 'loading';
		this._load( record ).then( content => {

			record.content = content;
			record.state = 'ready';

		} ).catch( error => {

			// aborted requests go back to empty so they can be re-requested
			record.state = error.name === 'AbortError' ? 'empty' : 'failed';

		} );

	}

	_ensureObject( record ) {

		if ( record.object ) return;

		const object = this._createObject( record );
		object.visible = false;
		record.object = object;
		this.add( object );
		this.stats.created ++;

	}

	_releaseObject( record ) {

		if ( ! record.object ) return;

		this.remove( record.object );
		this._disposeObject( record );
		record.object = null;
		record.opacity = 0;
		this._parkContent( record );

	}

	// keep the loaded content around for a while
	_parkContent( record ) {

		if ( record.content ) {

			this._cache.set( record.key, record.content );
			record.content = null;
			record.state = 'empty';

		}

	}

	// --- per-frame update ---------------------------------------------------

	update( camera, renderer, deltaMs = 16 ) {

		const stats = this.stats;
		stats.selected = 0;
		stats.rendered = 0;
		stats.culled = 0;
		stats.created = 0;

		this._frame ++;
		this.updateWorldMatrix( true, false );

		// camera and frustum in layer-local space
		_matrix.copy( this.matrixWorld ).invert();
		_camLocal.setFromMatrixPosition( camera.matrixWorld ).applyMatrix4( _matrix );
		_matrix.multiplyMatrices( camera.matrixWorldInverse, this.matrixWorld );
		_matrix.premultiply( camera.projectionMatrix );
		_frustum.setFromProjectionMatrix( _matrix );

		const screenHeight = renderer.domElement.height;
		const sseScale = screenHeight / ( 2 * Math.tan( 0.5 * camera.fov * DEG2RAD ) );

		this._beforeWalk( camera, renderer );

		// 1. select the leaf set
		const selection = [];
		const n = 1 << this.source.minZoom;
		for ( let y = 0; y < n; y ++ ) {

			for ( let x = 0; x < n; x ++ ) {

				const node = this._select( x, y, this.source.minZoom, sseScale );
				if ( node ) selection.push( node );

			}

		}

		// 2. render with replace refinement
		const shownNow = new Set();
		for ( const node of selection ) this._render( node, shownNow, deltaMs );

		// hide objects that were shown last frame but not this one
		for ( const record of this._shown ) {

			if ( ! shownNow.has( record ) && record.object ) record.object.visible = false;

		}

		this._shown = shownNow;

		// 3. upload content that the walk asked for, within the time budget
		this._uploadPending( renderer );

		// 4. sweep: abort stale loads, drop stale objects
		for ( const record of this._records.values() ) {

			const stale = this._frame - record.lastUsed;
			if ( record.state === 'loading' && stale > 0 ) this._abortLoad( record );
			if ( stale > this.retainFrames ) {

				if ( record.object ) this._releaseObject( record );
				else this._parkContent( record ); // loaded but never drawn

			}

		}

		stats.loading = this._pendingLoads;

	}

	_beforeWalk( camera, renderer ) {} // eslint-disable-line no-unused-vars

	_uploadPending( renderer ) {

		const queue = this._uploadQueue;
		const stats = this.stats;
		stats.uploaded = 0;
		stats.uploadMs = 0;
		const t0 = performance.now();

		while ( queue.length > 0 && ( stats.uploaded === 0 || performance.now() - t0 < this.uploadBudgetMs ) ) {

			const record = queue.shift();
			record.queued = false;
			// no longer wanted, or evicted meanwhile: it re-queues if it comes back
			if ( record.lastUsed !== this._frame || record.state !== 'ready' ) continue;

			this._upload( record.content, renderer );
			stats.uploaded ++;

		}

		stats.uploadMs = performance.now() - t0;

	}

	_select( x, y, z, sseScale ) {

		const record = this._getRecord( x, y, z );

		if ( ! _frustum.intersectsBox( this._getBounds( record ) ) ) {

			this.stats.culled ++;
			return null;

		}

		const distance = Math.max( this._getBounds( record ).distanceToPoint( _camLocal ), 1 );
		const errPx = this._texelSize( record ) * sseScale / distance;

		if ( errPx > this.maxScreenTexel && z < this.source.maxZoom ) {

			const children = [];
			for ( let dy = 0; dy < 2; dy ++ ) {

				for ( let dx = 0; dx < 2; dx ++ ) {

					const child = this._select( 2 * x + dx, 2 * y + dy, z + 1, sseScale );
					if ( child ) children.push( child );

				}

			}

			// all children culled: this tile is out of view too
			if ( children.length === 0 ) return null;
			return { record, children };

		}

		this.stats.selected ++;
		return { record, children: null };

	}

	// returns true when the node's area is fully covered by drawn pixels
	_render( node, shownNow, deltaMs ) {

		const record = node.record;
		record.lastUsed = this._frame;

		if ( node.children ) {

			let covered = true;
			for ( const child of node.children ) {

				covered = this._render( child, shownNow, deltaMs ) && covered;

			}

			// culled children leave their area uncovered on purpose:
			// covered only matters where something will be looked at
			if ( covered ) return true;

			// backfill: keep this tile under not-yet-ready children
			return this._draw( record, shownNow, deltaMs );

		}

		return this._draw( record, shownNow, deltaMs );

	}

	_draw( record, shownNow, deltaMs ) {

		this._ensureLoaded( record );
		if ( record.state !== 'ready' ) return false;

		if ( ! this._isUploaded( record.content ) ) {

			if ( ! record.queued ) {

				record.queued = true;
				this._uploadQueue.push( record );

			}

			return false;

		}

		this._ensureObject( record );

		const object = record.object;
		object.visible = true;
		shownNow.add( record );
		this.stats.rendered ++;

		if ( record.opacity < 1 ) {

			record.opacity = this.fadeDuration > 0
				? Math.min( 1, record.opacity + deltaMs / this.fadeDuration )
				: 1;
			this._setOpacity( record, record.opacity );

		}

		// covered only once fully opaque so the ancestor stays during the fade
		return record.opacity >= 1;

	}

	dispose() {

		for ( const record of this._records.values() ) {

			this._abortLoad( record );
			if ( record.object ) {

				this.remove( record.object );
				this._disposeObject( record );
				record.object = null;

			}

			if ( record.content ) this._disposeContent( record.content );

		}

		this._records.clear();
		this._cache.clear();
		this._shown.clear();

	}

}
