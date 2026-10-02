// Bridge alignment: how far from MapLibre's own ground a three.js scene
// drawn through MapLibreLayer lands, in pixels, over zooms from the whole
// globe to street level, pitched and turned. Runs bench/bridge.html in
// headless Chrome for the globe and the mercator projections.
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { chromeExecutablePath } from './chrome.mjs';

const root = new URL( '..', import.meta.url ).pathname;
const server = await createServer( { root, server: { host: '127.0.0.1', port: 5193, strictPort: true }, logLevel: 'warn' } );
await server.listen();

const browser = await puppeteer.launch( {
	executablePath: chromeExecutablePath(),
	headless: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader' ],
	defaultViewport: { width: 800, height: 500 },
	protocolTimeout: 600000,
	timeout: 120000,
} );

// the globe up to 11, the blend to 12, mercator after: the band is sampled close
const ZOOMS = [ 2, 5, 8, 10, 10.5, 11, 11.25, 11.5, 11.75, 12, 13, 15, 17, 19 ];
const POSES = ZOOMS.flatMap( zoom => [ { zoom }, { zoom, pitch: 60, bearing: 30 } ] );

let failed = false;
for ( const projection of [ 'globe', 'mercator' ] ) {

	const page = await browser.newPage();
	page.on( 'pageerror', e => {

		console.error( `[${ projection }] ${ e.message }` );
		failed = true;

	} );
	await page.goto( `http://127.0.0.1:5193/bench/bridge.html?projection=${ projection }`, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( 'window.__ready === true', { timeout: 120000 } );
	const rows = await page.evaluate( poses => window.__align( poses ), POSES );
	const band = POSES.filter( p => p.zoom >= 10 && p.zoom <= 12.5 );
	const wide = await page.evaluate( poses => window.__align( poses, { wide: true } ), band );

	console.log( `\n${ projection }` );
	console.log( '| zoom | pitch | bearing | transition | spread (m) | worst (px) |' );
	console.log( '|---|---|---|---|---|---|' );
	for ( const r of rows ) console.log( `| ${ r.zoom } | ${ r.pitch } | ${ r.bearing } | ${ r.transition } | ${ r.spreadMeters } | ${ r.worstPx } |` );
	console.log( `\n${ projection }, points out to a third of the view` );
	console.log( '| zoom | pitch | bearing | transition | spread (m) | worst (px) |' );
	console.log( '|---|---|---|---|---|---|' );
	for ( const r of wide ) console.log( `| ${ r.zoom } | ${ r.pitch } | ${ r.bearing } | ${ r.transition } | ${ r.spreadMeters } | ${ r.worstPx } |` );
	await page.close();

}

await browser.close();
await server.close();
process.exit( failed ? 1 : 0 );
