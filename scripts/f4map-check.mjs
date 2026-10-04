// F4Map, the picture to beat, at the views of our evidence screenshots:
// demo.f4map.com driven by its URL hash (lat, lon, zoom, camera.theta for
// the tilt, camera.phi for the heading), one PNG per view in screenshots/.
// Their landmark models ("F4 specific buildings") stay on; the Louvre is
// one of them, so around it the comparison is against hand-made geometry.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { chromeExecutablePath } from './chrome.mjs';

const VIEWS = [
	{ name: 'f4map-louvre-pyramid', lat: 48.8611, lon: 2.3360, zoom: 19, theta: 62, phi: 200 },
	{ name: 'f4map-louvre-marly', lat: 48.8614, lon: 2.3372, zoom: 18, theta: 58, phi: 330 },
	{ name: 'f4map-louvre-marsan', lat: 48.8629, lon: 2.3335, zoom: 18.5, theta: 60, phi: 290 },
	{ name: 'f4map-louvre-roofs', lat: 48.8604, lon: 2.3395, zoom: 18, theta: 58, phi: 0 },
	{ name: 'f4map-louvre-justice', lat: 48.8560, lon: 2.3445, zoom: 18, theta: 60, phi: 20 },
	{ name: 'f4map-louvre-chatelet', lat: 48.8580, lon: 2.3462, zoom: 18.5, theta: 60, phi: 300 },
];
mkdirSync( 'screenshots', { recursive: true } );
const browser = await puppeteer.launch( { executablePath: chromeExecutablePath(), headless: true, pipe: true, args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader' ], defaultViewport: { width: 800, height: 500 }, protocolTimeout: 600000, timeout: 120000 } );
for ( const v of VIEWS ) {

	// a page per view: the site reads its hash once, at load
	const page = await browser.newPage();
	page.on( 'pageerror', e => console.error( 'page error:', e.message ) );
	const url = `https://demo.f4map.com/#lat=${ v.lat }&lon=${ v.lon }&zoom=${ v.zoom }&camera.theta=${ v.theta }&camera.phi=${ v.phi }`;
	await page.goto( url, { waitUntil: 'networkidle2', timeout: 180000 } ).catch( e => console.error( v.name, e.message ) );
	await new Promise( r => setTimeout( r, 45000 ) ); // tiles and models, software rendered
	await page.screenshot( { path: `screenshots/${ v.name }.png` } );
	console.log( `[${ v.name }] saved ${ url }` );
	await page.close();

}

await browser.close();
process.exit( 0 );
