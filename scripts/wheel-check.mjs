// Does the zoom move while trackpad events keep coming, or after they stop?
// A browser-level check of MapControls' easing: 30 frames of wheel events
// on the globe demo, 30 of silence, the distance sampled every frame. It
// passes when at least half of the zoom has happened by the last event.
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { chromeExecutablePath } from './chrome.mjs';
const root = new URL( '..', import.meta.url ).pathname;
const server = await createServer( { root, server: { host: '127.0.0.1', port: 20519, strictPort: true }, logLevel: 'warn' } );
await server.listen();
const browser = await puppeteer.launch( { executablePath: chromeExecutablePath(), headless: true, pipe: true, args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader' ], defaultViewport: { width: 800, height: 500 }, timeout: 120000 } );
const page = await browser.newPage();
await page.goto( 'http://127.0.0.1:20519/demo/globe.html?lat=48.8566&lon=2.3522&alt=1500&pitch=0', { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( 'window.__CONTROLS !== undefined', { timeout: 120000 } );
await page.mouse.move( 400, 250 );
const series = await page.evaluate( async () => {
	const c = window.__CONTROLS, out = [];
	const el = document.querySelector( 'canvas' );
	const t0 = performance.now();
	// 30 frames of trackpad events (deltaY 10, pixels), then 30 frames of silence
	for ( let i = 0; i < 60; i ++ ) {
		if ( i < 30 ) el.dispatchEvent( new WheelEvent( 'wheel', { deltaY: 10, deltaMode: 0, clientX: 400, clientY: 250, bubbles: true, cancelable: true } ) );
		await new Promise( r => requestAnimationFrame( r ) );
		out.push( [ Math.round( performance.now() - t0 ), Math.round( c.distance ) ] );
	}
	return out;
} );
console.log( 'ms,distance during 30 frames of events then 30 of silence:' );
console.log( series.map( s => s.join( ':' ) ).join( ' ' ) );
const start = series[ 0 ][ 1 ], atLastEvent = series[ 29 ][ 1 ], end = series[ 59 ][ 1 ];
const share = ( atLastEvent - start ) / ( end - start );
console.log( `zoom done by the last event: ${ Math.round( share * 100 ) }%` );
await browser.close(); await server.close(); process.exit( share >= 0.5 ? 0 : 1 );
