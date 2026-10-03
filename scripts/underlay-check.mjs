// Underlay alignment: how far a ground point drawn by this engine's camera
// lands from where the MapLibre map underneath puts it (map.project), in
// pixels, over zooms, pitches and headings. Flat, the two are the same
// projection (Web Mercator), so the answer should be nothing; on the globe
// the scene stands on MapLibre's sphere and the camera is derived from
// MapLibre's own globe geometry, so it should be nothing there too.
import { createServer } from 'vite';
import puppeteer from 'puppeteer';
import { chromeExecutablePath } from './chrome.mjs';

const root = new URL( '..', import.meta.url ).pathname;
const server = await createServer( { root, server: { host: '127.0.0.1', port: 20517, strictPort: true }, logLevel: 'warn' } );
await server.listen();
const browser = await puppeteer.launch( {
	executablePath: chromeExecutablePath(), headless: true, pipe: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader' ],
	defaultViewport: { width: 800, height: 500 }, protocolTimeout: 600000, timeout: 120000,
} );

const page = await browser.newPage();
let failed = false;
page.on( 'pageerror', e => { console.error( e.message ); failed = true; } );

const LAT = 48.8606, LON = 2.3376;
const VIEWS = [
	{ distance: 20000000, pitch: 0, heading: 0 }, { distance: 200000, pitch: 0, heading: 0 }, { distance: 200000, pitch: 60, heading: 30 },
	{ distance: 5000, pitch: 0, heading: 0 }, { distance: 5000, pitch: 60, heading: 30 }, { distance: 5000, pitch: 85, heading: 200 },
	{ distance: 300, pitch: 0, heading: 0 }, { distance: 300, pitch: 70, heading: 120 }, { distance: 40, pitch: 85, heading: 45 },
];
for ( const projection of [ 'mercator', 'globe' ] ) {

await page.goto( `http://127.0.0.1:20517/demo/underlay.html?style=https://demotiles.maplibre.org/style.json&projection=${ projection }`, { waitUntil: 'domcontentloaded' } );
await page.waitForFunction( 'window.__setView !== undefined && window.__MAP.loaded()', { timeout: 180000, polling: 500 } );
console.log( `\n${ projection }\n` );
console.log( '| distance (m) | pitch | heading | zoom | worst (px) |' );
console.log( '|---|---|---|---|---|' );
for ( const view of VIEWS ) {

	const r = await page.evaluate( async ( view, LAT, LON ) => {

		window.__setView( { lat: LAT, lon: LON, ...view } );
		// MapLibre picks globe or flat for the zoom when it draws a frame, so
		// map.project is asked after one: a jump across zoom 12 measured
		// before would be against the other projection
		await new Promise( r => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
		const zoom = window.__MAP.getZoom();
		// points a third of the view out, the way bridge-check does
		const span = window.innerWidth * 2 * Math.PI * 6378137 / ( 512 * 2 ** zoom );
		const d = Math.min( 20, span / 3 / 111320 ); // degrees of latitude, kept on the map at zoom 0
		const places = [ [ LAT, LON ], [ LAT + d, LON ], [ LAT - d, LON ], [ LAT, LON + d / Math.cos( LAT * Math.PI / 180 ) ], [ LAT, LON - d / Math.cos( LAT * Math.PI / 180 ) ] ];
		const aligned = window.__align( places );
		return { zoom: + zoom.toFixed( 2 ), worst: + Math.max( ...aligned.map( a => a.px ) ).toFixed( 3 ), sample: aligned[ 1 ] };

	}, view, LAT, LON );
	console.log( `| ${ view.distance } | ${ view.pitch } | ${ view.heading } | ${ r.zoom } | ${ r.worst } |` );
	// one point, both ways, so a zero above is seen to be two real pixels agreeing
	if ( view === VIEWS[ 4 ] ) console.log( `\nsanity, the point north at that view: three.js ${ r.sample.ours.map( v => v.toFixed( 2 ) ) }, map.project ${ r.sample.theirs.map( v => v.toFixed( 2 ) ) }\n` );

}

}

await browser.close();
await server.close();
process.exit( failed ? 1 : 0 );
