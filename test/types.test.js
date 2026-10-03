import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as api from '../src/index.js';

// The hand-written declarations and the sources, kept in step: everything
// src/index.js exports is declared, and nothing is declared that it does
// not export. Whether the declared shapes are right is tsc's job, on
// types/check.ts (npm run types-check, the `types` CI job).
describe( 'types/index.d.ts', () => {

	const dts = readFileSync( new URL( '../types/index.d.ts', import.meta.url ), 'utf8' );
	const declared = new Set( [ ...dts.matchAll( /^export (?:declare )?(?:const|function|class) (\w+)/gm ) ].map( m => m[ 1 ] ) );

	it( 'declares every export of src/index.js', () => {

		const missing = Object.keys( api ).filter( name => ! declared.has( name ) );
		expect( missing ).toEqual( [] );

	} );

	it( 'declares nothing the sources do not export', () => {

		const extra = [ ...declared ].filter( name => ! ( name in api ) );
		expect( extra ).toEqual( [] );

	} );

} );
