import { existsSync, readFileSync } from 'fs';
import { createContext, runInContext } from 'vm';
import { describe, expect, it } from 'vitest';
import * as source from '../src/index.js';

// The built files (npm run build): skipped when there is no build/, CI
// builds before it tests.
const build = new URL( '../build/', import.meta.url );
const built = existsSync( new URL( 'threejs-maplibre.module.js', build ) ) && existsSync( new URL( 'threejs-maplibre.js', build ) );

describe.skipIf( ! built )( 'library build', () => {

	it( 'ships the module build with the API of src/index.js and three left external', async () => {

		const module = await import( new URL( 'threejs-maplibre.module.js', build ).href );
		expect( Object.keys( module ).sort() ).toEqual( Object.keys( source ).sort() );
		expect( module.VERSION ).toBe( source.VERSION );
		const code = readFileSync( new URL( 'threejs-maplibre.module.js', build ), 'utf8' );
		expect( code ).toMatch( /from ?["']three["']/ );
		expect( code ).not.toMatch( /from ?["']three\/src/ ); // Earcut is bundled, import maps only know 'three'
		expect( code ).toContain( 'new Blob(' ); // the Worker travels inline

	} );

	it( 'ships the standalone build as a UMD global carrying its three', () => {

		const code = readFileSync( new URL( 'threejs-maplibre.js', build ), 'utf8' );
		expect( code ).not.toMatch( /require\(["']three["']\)/ );
		// loaded the way a script tag would, in a bare context
		const sandbox = createContext( { AbortController, TextDecoder, TextEncoder, URL, performance, console } );
		runInContext( `${ code }\n;globalThis.__api = threejsMaplibre;`, sandbox );
		const api = runInContext( '__api', sandbox );
		expect( api.VERSION ).toBe( source.VERSION );
		expect( typeof api.VectorTileMap ).toBe( 'function' );
		expect( typeof api.THREE.Scene ).toBe( 'function' );
		expect( Object.keys( api ).sort() ).toEqual( [ ...Object.keys( source ), 'THREE' ].sort() );

	} );

} );
