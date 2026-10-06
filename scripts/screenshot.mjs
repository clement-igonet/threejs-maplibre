// CI screenshot: renders the demos with the offline stub tile source and the
// Louvre extract and saves deterministic PNGs to screenshots/. Only the
// standalone page, when the library is built, hits a tile host (OpenFreeMap).
// SHOT_DIST=1 serves the production build in dist/ (with its base path)
// instead of the sources, to check a Pages build before it deploys.
// SHOT_ONLY=name,name renders just those shots while a view is adjusted.
import { existsSync, mkdirSync } from 'fs';
import { createServer, preview } from 'vite';
import puppeteer from 'puppeteer';
import { chromeExecutablePath } from './chrome.mjs';

const root = new URL( '..', import.meta.url ).pathname;
mkdirSync( `${ root }/screenshots`, { recursive: true } );

const serverOptions = { host: '127.0.0.1', port: 5199, strictPort: true };
const server = process.env.SHOT_DIST
	? await preview( { root, preview: serverOptions } )
	: await ( await createServer( { root, server: serverOptions } ) ).listen();
const base = server.resolvedUrls.local[ 0 ];
console.log( 'vite serving', base );

const browser = await puppeteer.launch( {
	executablePath: chromeExecutablePath(),
	headless: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--hide-scrollbars' ],
	defaultViewport: { width: 800, height: 500 },
	timeout: 120000, // a loaded shared machine can be slow to hand Chrome a port
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
	// Simple 3D Buildings: the Pyramide du Louvre as a glass pyramid, and
	// the Cour Carree's pavilions with their roofs
	{ name: 'louvre-pyramid', page: 'vector', query: '&data=louvre&lat=48.8611&lon=2.3360&alt=220&heading=200&pitch=62' },
	{ name: 'louvre-roofs', page: 'vector', query: '&data=louvre&lat=48.8604&lon=2.3395&alt=320&heading=0&pitch=58' },
	// the same two views as fill-extrusion alone draws them, for the before
	{ name: 'louvre-pyramid-flat', page: 'vector', query: '&data=louvre&roofs=0&lat=48.8611&lon=2.3360&alt=220&heading=200&pitch=62' },
	{ name: 'louvre-roofs-flat', page: 'vector', query: '&data=louvre&roofs=0&lat=48.8604&lon=2.3395&alt=320&heading=0&pitch=58' },
	// hipped and mansard roofs on footprints that are not rectangles: the
	// Pavillon de Marsan and the Richelieu wing's courtyards
	{ name: 'louvre-marsan', page: 'vector', query: '&data=louvre&lat=48.8629&lon=2.3335&alt=260&heading=290&pitch=60' },
	{ name: 'louvre-marly', page: 'vector', query: '&data=louvre&lat=48.8614&lon=2.3372&alt=300&heading=330&pitch=58' },
	// roofs from OSM tags alone, where F4Map draws from the same data and
	// not from its hand-made models: the Palais de Justice's mansards and
	// the Theatre du Chatelet's hip
	{ name: 'louvre-justice', page: 'vector', query: '&data=louvre&lat=48.8560&lon=2.3445&alt=320&heading=20&pitch=60' },
	{ name: 'louvre-chatelet', page: 'vector', query: '&data=louvre&lat=48.8580&lon=2.3462&alt=220&heading=300&pitch=60' },
	{ name: 'vector-louvre-close', page: 'vector', query: '&data=louvre&lat=48.8608&lon=2.3362&alt=420&heading=-35&pitch=62' },
	{ name: 'vector-stub', page: 'vector', query: '&data=stub&alt=1200&heading=30&pitch=55' },
	// a view that stops before the horizon does, hazed so the edge is air
	{ name: 'vector-louvre-haze', page: 'vector', query: '&data=louvre&lat=48.8608&lon=2.3362&alt=120&heading=-35&pitch=80&maxPitch=85&viewDistance=600' },
	{ name: 'objects', query: '' },
	{ name: 'objects-planar', page: 'objects', query: '&mode=planar' },
	{ name: 'objects-close', page: 'objects', query: '&lat=48.8613&lon=2.3333&alt=230&heading=80&pitch=65&objectHeading=250' },
	// the bridge: the same antenna and pin inside a maplibre-gl map, on its
	// globe and on its flat map (MapLibre's demo tiles, so these are live)
	{ name: 'bridge-globe', page: 'bridge', query: '', live: true },
	{ name: 'bridge-mercator', page: 'bridge', query: '&projection=mercator', live: true },
	// MapLibre's own examples ported: three.js models on its terrain, and
	// world-scale content in its own units (both on demo tiles, so live)
	{ name: 'bridge-terrain', page: 'bridge-terrain', query: '', live: true },
	{ name: 'bridge-world-line', page: 'bridge-world', query: '&example=line&speed=300', live: true },
	{ name: 'bridge-world-triangle', page: 'bridge-world', query: '&example=triangle', live: true },
	// direction B: MapLibre's map under this engine's scene, on the Liberty
	// style (live), the antenna and pin over it, then with our buildings too
	{ name: 'underlay', page: 'underlay', query: '', live: true },
	{ name: 'underlay-buildings', page: 'underlay', query: '&buildings=1&data=louvre', live: true },
	// and under MapLibre's globe, the scene on its sphere: the Louvre, and
	// the whole earth from 20 000 km with the pin still on the pyramid
	{ name: 'underlay-globe', page: 'underlay', query: '&projection=globe&buildings=1&data=louvre', live: true },
	{ name: 'underlay-globe-far', page: 'underlay', query: '&projection=globe&alt=20000000&pitch=0&heading=0', live: true },
	// indoor: Gare Saint-Lazare, the ground level alone, the first basement,
	// and every level pulled apart
	{ name: 'indoor-level-0', page: 'indoor', query: '&level=0' },
	{ name: 'indoor-level-minus1', page: 'indoor', query: '&level=-1' },
	{ name: 'indoor-exploded', page: 'indoor', query: '&level=all&explode=12&alt=900&pitch=55' },
	// a route from a shop on level -1 to a cafe on level 1, through two
	// climbs, drawn through the exploded levels; and the walker followed
	// on the stairs
	{ name: 'indoor-route', page: 'indoor', query: '&level=all&explode=12&alt=320&pitch=60&heading=300&from=Sephora&to=Paul%401&t=0&speed=0.001' },
	// the walk: on the rue de Rome, in the hall, and on the stairs down
	{ name: 'walk-street', page: 'walk', query: '' },
	{ name: 'walk-hall', page: 'walk', query: '&lat=48.8762&lon=2.3253&heading=250' },
	// the robot going down the stairs on the cour de Rome side, as a player saw it
	// the names: in the mall on level -1, and on a street
	{ name: 'walk-labels', page: 'walk', query: '&lat=48.87614&lon=2.32531&y=-2.85&heading=280' },
	// a shop door in the street-level mall, as a player met it
	// Chatelet-Les Halles: the start, at an entrance of the Forum
	{ name: 'walk-chatelet', page: 'walk', query: '&place=chatelet' },
	{ name: 'walk-door', page: 'walk', query: '&lat=48.8761957&lon=2.3248466&y=0.15&heading=335' },
	{ name: 'walk-down', page: 'walk', query: '&lat=48.875694&lon=2.324192&y=-0.6&heading=34' },
	{ name: 'walk-stairs', page: 'walk', query: '&lat=48.87621&lon=2.32513&y=0.15&heading=180' },
	// at the foot of the escalators up to level 1, the hole in its floor ahead
	// level -1 by McDonald's, facing the strip between the mapped rooms
	// that a jump fell through before level outlines were floors
	{ name: 'walk-gap', page: 'walk', query: '&lat=48.876152&lon=2.326191&y=-2.85&heading=158' },
	{ name: 'walk-escalator', page: 'walk', query: '&lat=48.8761525&lon=2.325062&y=1.8&heading=279' },
	{ name: 'indoor-walker', page: 'indoor', query: '&level=-1&from=Sephora&to=Ladur%C3%A9e&t=95&speed=0.001&follow=1' },
];

// live shots on OpenFreeMap's Liberty style (SHOT_LIVE=0 skips them): the
// vector demo, and the standalone page once the library is built. A full
// city style is a hundred layers of tiles to fetch and build, more than
// software rendering settles in a minute, so these are saved as they stand
// and do not fail the run.
if ( process.env.SHOT_LIVE !== '0' ) {

	SHOTS.push( { name: 'vector-openfreemap', page: 'vector', query: '&data=openfreemap', live: true } );
	// past what MapLibre lets a map tilt to by default, which is where the
	// far field gets expensive: tilted over Paris, horizon in frame
	SHOTS.push( { name: 'vector-openfreemap-tilted', page: 'vector', query: '&data=openfreemap&lat=48.8606&lon=2.3376&alt=700&heading=19&pitch=67&maxPitch=85', live: true } );
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
