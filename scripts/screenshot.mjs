// CI screenshot: renders the demos with the offline stub tile source and the
// Louvre extract and saves deterministic PNGs to screenshots/. Only the
// standalone page, when the library is built, hits a tile host (OpenFreeMap).
// SHOT_DIST=1 serves the production build in dist/ (with its base path)
// instead of the sources, to check a Pages build before it deploys.
// SHOT_ONLY=name,name renders just those shots while a view is adjusted.
import { existsSync, mkdirSync } from 'fs';
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

// raster demos on the stub source, then the vector demo on the Louvre
// extract (globe and planar, tilted and straight down) and on the stub city
const SHOTS = [
	{ name: 'globe', query: '' },
	{ name: 'planar', query: '' },
	{ name: 'globe-tilted', page: 'globe', query: '&lat=48.8566&lon=2.3522&alt=1500&heading=30&pitch=60' },
	{ name: 'vector-louvre', page: 'vector', query: '&data=louvre' },
	{ name: 'vector-louvre-planar', page: 'vector', query: '&data=louvre&mode=planar' },
	{ name: 'vector-louvre-top', page: 'vector', query: '&data=louvre&alt=1400&heading=0&pitch=0' },
	{ name: 'vector-louvre-close', page: 'vector', query: '&data=louvre&lat=48.8608&lon=2.3362&alt=420&heading=-35&pitch=62' },
	{ name: 'vector-stub', page: 'vector', query: '&data=stub&alt=1200&heading=30&pitch=55' },
	{ name: 'objects', query: '' },
	{ name: 'objects-planar', page: 'objects', query: '&mode=planar' },
	{ name: 'objects-close', page: 'objects', query: '&lat=48.8613&lon=2.3333&alt=230&heading=80&pitch=65&objectHeading=250' },
];

// live shots on OpenFreeMap's Liberty style (SHOT_LIVE=0 skips them): the
// vector demo, and the standalone page once the library is built. A full
// city style is ~1000 draw calls, more than software rendering settles in a
// minute, so these are saved as they stand and do not fail the run.
if ( process.env.SHOT_LIVE !== '0' ) {

	SHOTS.push( { name: 'vector-openfreemap', page: 'vector', query: '&data=openfreemap', live: true } );
	if ( existsSync( `${ root }/build/threejs-maplibre.js` ) ) SHOTS.push( { name: 'standalone', query: '', live: true } );

}

const only = process.env.SHOT_ONLY ? process.env.SHOT_ONLY.split( ',' ) : null;

let failed = false;
for ( const { name, page: pageName = name, query, live = false } of SHOTS ) {

	if ( only && ! only.includes( name ) ) continue;

	const page = await browser.newPage();
	page.on( 'pageerror', e => {

		console.error( `[${ name }] page error:`, e.stack ?? String( e ) );
		failed = true;

	} );
	page.on( 'console', message => {

		if ( message.type() === 'error' || message.type() === 'warning' ) console.log( `[${ name }] console.${ message.type() }: ${ message.text() }` );

	} );

	await page.goto( `${ base }demo/${ pageName }.html?tiles=stub${ query }`, { waitUntil: 'domcontentloaded' } );

	try {

		await page.waitForFunction( 'window.__SHOT_READY === true', { timeout: 60000, polling: 100 } );

	} catch {

		console.error( `[${ name }] never became stable${ live ? ' (live shot, not a failure)' : '' }` );
		if ( ! live ) failed = true;

	}

	await page.screenshot( { path: `${ root }/screenshots/${ name }.png` } );
	const hud = await page.evaluate( () => document.getElementById( 'info' )?.textContent ?? '' );
	console.log( `[${ name }] screenshot saved: ${ hud }` );
	await page.close();

}

await browser.close();
await ( server.close ? server.close() : new Promise( r => server.httpServer.close( r ) ) );
process.exit( failed ? 1 : 0 );
