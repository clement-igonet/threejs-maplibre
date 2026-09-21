// E2E check of MapControls in headless Chrome at street altitude, on the
// globe and on the planar demo: a wheel notch changes the distance by 5%, a
// drag moves the ground by what the pointer covered, a pinch zooms while the
// two fingers also pan, two fingers sliding together tilt, a right drag
// turns. Prints measurements; exits 1 if any is out of range.
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

let failed = false;

for ( const demo of [ 'globe', 'planar' ] ) {

	console.log( `--- ${ demo }` );
	const page = await browser.newPage();
	page.on( 'pageerror', e => console.error( 'page error:', String( e ) ) );
	const ALT = 2000;
	await page.goto( `http://127.0.0.1:5195/demo/${ demo }.html?tiles=stub&lat=48.8566&lon=2.3522&alt=${ ALT }&pitch=0`, { waitUntil: 'domcontentloaded' } );
	await page.waitForFunction( 'window.__CONTROLS !== undefined', { timeout: 30000 } );

	const state = () => page.evaluate( () => {

		const c = window.__CONTROLS;
		return { lat: c.lat, lon: c.lon, distance: c.distance, heading: c.heading, pitch: c.pitch, mpp: c.metersPerPixel() };

	} );
	const settle = () => new Promise( r => setTimeout( r, 1000 ) ); // a few frames under SwiftShader
	// ground meters between two centers; in planar mode the controls work in
	// Web Mercator meters, which are ground meters / cos(lat)
	const groundScale = demo === 'planar' ? Math.cos( 48.8566 * Math.PI / 180 ) : 1;
	const groundDistance = ( a, b ) => {

		const toRad = Math.PI / 180;
		const x = ( b.lon - a.lon ) * toRad * Math.cos( a.lat * toRad );
		const y = ( b.lat - a.lat ) * toRad;
		return Math.hypot( x, y ) * 6378137 / groundScale;

	};

	const check = ( label, value, min, max ) => {

		const ok = value >= min && value <= max;
		if ( ! ok ) failed = true;
		console.log( `${ ok ? 'ok  ' : 'FAIL' } ${ label } (expected ${ min.toFixed( 2 ) }..${ max.toFixed( 2 ) })` );

	};

	// one wheel notch in
	let before = await state();
	await page.mouse.move( 400, 250 );
	await page.mouse.wheel( { deltaY: - 100 } );
	await settle();
	let after = await state();
	check( `wheel notch: distance ${ before.distance.toFixed( 0 ) } -> ${ after.distance.toFixed( 0 ) } m (x${ ( after.distance / before.distance ).toFixed( 3 ) })`, after.distance / before.distance, 0.94, 0.96 );

	// 100 px drag moves the ground by 100 px worth at the screen center
	before = after;
	await page.mouse.move( 400, 250 );
	await page.mouse.down();
	for ( let i = 1; i <= 10; i ++ ) await page.mouse.move( 400 + 10 * i, 250 );
	await page.mouse.up();
	await settle();
	after = await state();
	let moved = groundDistance( before, after );
	check( `100 px drag: ground moved ${ moved.toFixed( 0 ) } m for ${ ( 100 * before.mpp ).toFixed( 0 ) } m of pixels`, moved / ( 100 * before.mpp ), 0.9, 1.1 );

	// two fingers: spread 1.2x while both move 100 px right; the distance must
	// drop and the ground must follow the fingers in the same gesture
	before = after;
	let finger1 = await page.touchscreen.touchStart( 350, 250 );
	let finger2 = await page.touchscreen.touchStart( 450, 250 );
	for ( let i = 1; i <= 50; i ++ ) {

		const spread = 50 * ( 1 + 0.004 * i ); // 100 px -> 120 px apart
		await finger1.move( 400 + 2 * i - spread, 250 );
		await finger2.move( 400 + 2 * i + spread, 250 );

	}
	await finger1.end();
	await finger2.end();
	await settle();
	after = await state();
	moved = groundDistance( before, after );
	// the ground under the fingers' midpoint follows it: 100 px at the new scale
	check( `pinch 1.2x + 100 px two-finger drag: distance x${ ( after.distance / before.distance ).toFixed( 3 ) }`, after.distance / before.distance, 0.8, 0.88 );
	check( `pinch 1.2x + 100 px two-finger drag: ground moved ${ moved.toFixed( 0 ) } m for ${ ( 100 * after.mpp ).toFixed( 0 ) } m of pixels`, moved / ( 100 * after.mpp ), 0.85, 1.1 );
	check( `pinch 1.2x + 100 px two-finger drag: pitch stays ${ after.pitch.toFixed( 1 ) }°`, after.pitch, 0, 1 );

	// two fingers sliding up together: tilt, no zoom
	before = after;
	finger1 = await page.touchscreen.touchStart( 350, 300 );
	finger2 = await page.touchscreen.touchStart( 450, 300 );
	for ( let i = 1; i <= 50; i ++ ) {

		await finger1.move( 350, 300 - 2 * i );
		await finger2.move( 450, 300 - 2 * i );

	}
	await finger1.end();
	await finger2.end();
	await settle();
	after = await state();
	check( `100 px two-finger slide up: pitch ${ before.pitch.toFixed( 1 ) }° -> ${ after.pitch.toFixed( 1 ) }°`, after.pitch - before.pitch, 42, 50 );
	check( `100 px two-finger slide up: distance x${ ( after.distance / before.distance ).toFixed( 3 ) }`, after.distance / before.distance, 0.99, 1.01 );

	// right drag: heading follows x, pitch follows y
	before = after;
	await page.mouse.move( 400, 250 );
	await page.mouse.down( { button: 'right' } );
	for ( let i = 1; i <= 10; i ++ ) await page.mouse.move( 400 + 10 * i, 250 - 4 * i );
	await page.mouse.up( { button: 'right' } );
	await settle();
	after = await state();
	check( `100 px right drag: heading ${ before.heading.toFixed( 1 ) }° -> ${ after.heading.toFixed( 1 ) }°`, after.heading - before.heading, 24, 26 );
	check( `40 px up right drag: pitch ${ before.pitch.toFixed( 1 ) }° -> ${ after.pitch.toFixed( 1 ) }°`, after.pitch - before.pitch, 19, 21 );

	// the camera actually moved with the state
	const cameraAltitude = await page.evaluate( () => window.__ALTITUDE );
	check( `camera altitude ${ cameraAltitude.toFixed( 0 ) } m for distance ${ after.distance.toFixed( 0 ) } m at pitch ${ after.pitch.toFixed( 0 ) }°`, cameraAltitude / ( after.distance * Math.cos( after.pitch * Math.PI / 180 ) ), 0.95, 1.05 );

	await page.close();

}

await browser.close();
await server.close();
process.exit( failed ? 1 : 0 );
