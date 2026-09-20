// CI screenshot: renders both demos with the offline stub tile source and
// saves deterministic PNGs to screenshots/. No external tile host is hit.
import { mkdirSync } from 'fs';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = new URL( '..', import.meta.url ).pathname;
mkdirSync( `${ root }/screenshots`, { recursive: true } );

const server = await createServer( { root, server: { host: '127.0.0.1', port: 5199, strictPort: true } } );
await server.listen();
console.log( 'vite serving', server.resolvedUrls?.local );

const browser = await puppeteer.launch( {
	headless: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--hide-scrollbars' ],
	defaultViewport: { width: 800, height: 500 },
} );

let failed = false;
for ( const name of [ 'globe', 'planar' ] ) {

	const page = await browser.newPage();
	page.on( 'pageerror', e => {

		console.error( `[${ name }] page error:`, String( e ) );
		failed = true;

	} );

	await page.goto( `http://127.0.0.1:5199/demo/${ name }.html?tiles=stub`, { waitUntil: 'domcontentloaded' } );

	try {

		await page.waitForFunction( 'window.__SHOT_READY === true', { timeout: 60000, polling: 100 } );

	} catch {

		console.error( `[${ name }] never became stable` );
		failed = true;

	}

	await page.screenshot( { path: `${ root }/screenshots/${ name }.png` } );
	console.log( `[${ name }] screenshot saved` );
	await page.close();

}

await browser.close();
await server.close();
process.exit( failed ? 1 : 0 );
