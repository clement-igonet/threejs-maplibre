// Diagnostic: run one engine on one pose and print its live counters every
// 2 s. Usage: node scripts/bench-diag.mjs 'engine=plugin&only=street' [seconds]
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = new URL( '..', import.meta.url ).pathname;
const query = process.argv[ 2 ] || 'engine=plugin&only=street';
const seconds = parseInt( process.argv[ 3 ] || '120' );

const server = await createServer( { root, server: { host: '127.0.0.1', port: 5197, strictPort: true }, logLevel: 'warn' } );
await server.listen();
const browser = await puppeteer.launch( {
	headless: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--enable-precise-memory-info' ],
	defaultViewport: { width: 800, height: 500 },
} );
const page = await browser.newPage();
page.on( 'pageerror', e => console.error( 'page error:', String( e ) ) );
page.on( 'console', m => { if ( m.type() === 'error' || m.type() === 'warning' ) console.error( 'console:', m.text() ); } );
await page.goto( `http://127.0.0.1:5197/bench/index.html?${ query }`, { waitUntil: 'domcontentloaded' } );

const t0 = Date.now();
while ( Date.now() - t0 < seconds * 1000 ) {

	await new Promise( r => setTimeout( r, 2000 ) );
	const c = await page.evaluate( 'window.__COUNTERS ? window.__COUNTERS() : null' );
	const done = await page.evaluate( 'window.__BENCH !== undefined' );
	console.log( `${ Math.round( ( Date.now() - t0 ) / 1000 ) }s`, JSON.stringify( c ), done ? 'DONE' : '' );
	if ( done ) {

		console.log( JSON.stringify( await page.evaluate( 'window.__BENCH' ) ) );
		break;

	}

}

await browser.close();
await server.close();
