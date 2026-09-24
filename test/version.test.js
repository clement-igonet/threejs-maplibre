import { readFileSync } from 'fs';
import { expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

it( 'exports the package version', () => {

	const { version } = JSON.parse( readFileSync( new URL( '../package.json', import.meta.url ) ) );
	expect( VERSION ).toBe( version );

} );
