// CI screenshot: renders both demos with the offline stub tile source and
// saves deterministic PNGs to screenshots/. No external tile host is hit.
// SHOT_DIST=1 serves the production build in dist/ (with its base path)
// instead of the sources, to check a Pages build before it deploys.
import { mkdirSync } from 'fs';
import { createServer, preview } from 'vite';
import puppeteer from 'puppeteer';

const root = new URL( '..', import.meta.url ).pathname;
mkdirSync( `${ root }/screenshots`, { recursive: true } );

const serverOptions = { host: '127.0.0.1', port: 5199, strictPort: true };
const server = process.env.SHOT_DIST
	? await preview( { root, preview: serverOptions } )
	: await ( await createServer( { root, server: serverOptions } ) ).listen();
const base = server.resolvedUrls.local[ 0 ];
console.log( 'vite serving', base );

const browser = await puppeteer.launch( {
	headless: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--hide-scrollbars' ],
	defaultViewport: { width: 800, height: 500 },
} );

// a third shot of the globe tilted over Paris, for the controls
const SHOTS = [
	{ name: 'globe', query: '' },
	{ name: 'planar', query: '' },
	{ name: 'globe-tilted', page: 'globe', query: '&lat=48.8566&lon=2.3522&alt=1500&heading=30&pitch=60' },
];

let failed = false;
for ( const { name, page: pageName = name, query } of SHOTS ) {

	const page = await browser.newPage();
	page.on( 'pageerror', e => {

		console.error( `[${ name }] page error:`, String( e ) );
		failed = true;

	} );

	await page.goto( `${ base }demo/${ pageName }.html?tiles=stub${ query }`, { waitUntil: 'domcontentloaded' } );

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
await ( server.close ? server.close() : new Promise( r => server.httpServer.close( r ) ) );
process.exit( failed ? 1 : 0 );
