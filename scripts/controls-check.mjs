// E2E check of the globe controls: at street altitude, one wheel notch must
// change the altitude by ~5% and a drag must move the ground by what the
// pointer covered, instead of the fixed orbit-angle sensitivity of stock
// OrbitControls. Prints measurements; exits 1 if either is out of range.
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = new URL( '..', import.meta.url ).pathname;
const server = await createServer( { root, server: { host: '127.0.0.1', port: 5195, strictPort: true }, logLevel: 'warn' } );
await server.listen();
const browser = await puppeteer.launch( {
	headless: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader' ],
	defaultViewport: { width: 800, height: 500 },
} );
const page = await browser.newPage();
page.on( 'pageerror', e => console.error( 'page error:', String( e ) ) );

const ALT = 2000;
await page.goto( `http://127.0.0.1:5195/demo/globe.html?tiles=stub&lat=48.8566&lon=2.3522&alt=${ ALT }`, { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( 'window.__CAMERA !== undefined', { timeout: 30000 } );

const state = () => page.evaluate( () => {

	const p = window.__CAMERA.position;
	const len = Math.hypot( p.x, p.y, p.z );
	return { x: p.x, y: p.y, z: p.z, len };

} );
const settle = () => new Promise( r => setTimeout( r, 6000 ) ); // damping (0.05 per frame, slow frames under SwiftShader)
const altitudeOf = s => s.len - 6366000; // geocentric radius at Paris, approx
const groundDistance = ( a, b ) => {

	const dot = ( a.x * b.x + a.y * b.y + a.z * b.z ) / ( a.len * b.len );
	return Math.acos( Math.min( 1, dot ) ) * 6371000;

};

let failed = false;
const before = await state();

// one wheel notch in
await page.mouse.move( 400, 250 );
await page.mouse.wheel( { deltaY: - 100 } );
await settle();
const afterWheel = await state();
const ratio = altitudeOf( afterWheel ) / altitudeOf( before );
console.log( `wheel notch: altitude ${ altitudeOf( before ).toFixed( 0 ) } m -> ${ altitudeOf( afterWheel ).toFixed( 0 ) } m (x${ ratio.toFixed( 3 ) })` );
if ( ratio < 0.9 || ratio > 0.99 ) failed = true;

// 100 px horizontal drag: the ground should move by 100 px worth at nadir.
// OrbitControls turns a horizontal drag into a rotation about the pole, so
// at latitude phi the ground moves cos(phi) times that.
const expected = 100 * 2 * altitudeOf( afterWheel ) * Math.tan( Math.PI / 6 ) / 500 * Math.cos( 48.8566 * Math.PI / 180 );
await page.mouse.move( 400, 250 );
await page.mouse.down();
for ( let i = 1; i <= 10; i ++ ) await page.mouse.move( 400 + 10 * i, 250 );
await page.mouse.up();
await settle();
const afterDrag = await state();
const moved = groundDistance( afterWheel, afterDrag );
console.log( `100 px drag: ground moved ${ moved.toFixed( 0 ) } m, expected ~${ expected.toFixed( 0 ) } m` );
if ( moved < 0.8 * expected || moved > 1.25 * expected ) failed = true;

await browser.close();
await server.close();
process.exit( failed ? 1 : 0 );
