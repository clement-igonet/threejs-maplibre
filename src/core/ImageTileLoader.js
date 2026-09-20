import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';

// Loads tile images as three.js textures with abortable fetches.
// load() returns a promise resolving to a texture; abort( key ) cancels an
// in-flight request (the promise rejects with an AbortError).

export class ImageTileLoader {

	constructor() {

		this._controllers = new Map();

	}

	get pendingCount() {

		return this._controllers.size;

	}

	async load( key, url ) {

		const controller = new AbortController();
		this._controllers.set( key, controller );

		try {

			const response = await fetch( url, { signal: controller.signal } );
			if ( ! response.ok ) {

				throw new Error( `ImageTileLoader: HTTP ${ response.status } for ${ url }` );

			}

			const blob = await response.blob();
			const bitmap = await createImageBitmap( blob, { imageOrientation: 'flipY' } );

			const texture = new CanvasTexture( bitmap );
			// the bitmap is already flipped at decode time, which is the fast
			// path for ImageBitmap uploads
			texture.flipY = false;
			texture.colorSpace = SRGBColorSpace;
			texture.minFilter = LinearMipmapLinearFilter;
			texture.magFilter = LinearFilter;
			texture.generateMipmaps = true;
			texture.anisotropy = 4;
			return texture;

		} finally {

			this._controllers.delete( key );

		}

	}

	abort( key ) {

		const controller = this._controllers.get( key );
		if ( controller ) {

			controller.abort();
			this._controllers.delete( key );

		}

	}

	abortAll() {

		for ( const controller of this._controllers.values() ) controller.abort();
		this._controllers.clear();

	}

}
