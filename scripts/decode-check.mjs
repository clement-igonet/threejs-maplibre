// Runs bench/decode.html in headless Chrome: the stub city's tiles at z14, 15
// and 16 decoded through real Workers and inline, printing a markdown table
// of wall time per tile. Exits 1 if a run fails or decodes no features.
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = new URL( '..', import.meta.url ).pathname;
const server = await createServer( { root, server: { host: '127.0.0.1', port: 5196, strictPort: true }, logLevel: 'warn' } );
await server.listen();
const browser = await puppeteer.launch( { headless: true, args: [ '--no-sandbox', '--disable-dev-shm-usage' ] } );

let failed = false;
const rows = [];

for ( const workers of [ 2, 0 ] ) {

	for ( const z of [ 14, 15, 16 ] ) {

		const page = await browser.newPage();
		page.on( 'pageerror', e => {

			console.error( 'page error:', String( e ) );
			failed = true;

		} );
		await page.goto( `http://127.0.0.1:5196/bench/decode.html?z=${ z }&workers=${ workers }`, { waitUntil: 'domcontentloaded' } );

		try {

			await page.waitForFunction( 'window.__DECODE !== undefined', { timeout: 60000 } );
			const r = await page.evaluate( 'window.__DECODE' );
			if ( r.features === 0 ) failed = true;
			rows.push( `| z${ r.z } | ${ workers ? `${ workers } workers` : 'inline' } | ${ r.tiles } | ${ ( r.bytes / 1024 ).toFixed( 0 ) } kB | ${ r.features } | ${ r.vertices } | ${ r.ms } ms | ${ r.perTileMs } ms |` );

		} catch ( e ) {

			console.error( `z${ z } workers=${ workers } did not finish:`, String( e ) );
			failed = true;

		}

		await page.close();

	}

}

await browser.close();
await server.close();
console.log( '| zoom | decode | tiles | bytes | features | vertices | total | per tile |\n|---|---|---|---|---|---|---|---|\n' + rows.join( '\n' ) );
process.exit( failed ? 1 : 0 );
