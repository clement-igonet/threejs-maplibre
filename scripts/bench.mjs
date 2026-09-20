// Engine benchmark: runs bench/index.html for each engine configuration under
// headless Chrome against the offline stub tile source, then prints a markdown
// comparison and writes bench/results.json. Numbers come from SwiftShader in
// a capped container, so compare them relative to each other, not absolutely.
import { mkdirSync, writeFileSync } from 'fs';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = new URL( '..', import.meta.url ).pathname;
const RUNS = [
	{ id: 'warmup', query: 'engine=native', discard: true }, // first run pays shader compilation and vite transforms
	{ id: 'native', query: 'engine=native' },
	{ id: 'native-texel1', query: 'engine=native&texel=1' },
	{ id: 'plugin', query: 'engine=plugin' },
];

const server = await createServer( { root, server: { host: '127.0.0.1', port: 5198, strictPort: true }, logLevel: 'warn' } );
await server.listen();

const browser = await puppeteer.launch( {
	headless: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--enable-precise-memory-info' ],
	defaultViewport: { width: 800, height: 500 },
	dumpio: !! process.env.BENCH_DEBUG,
} );

const results = {};
let failed = false;

for ( const run of RUNS ) {

	const page = await browser.newPage();
	page.on( 'pageerror', e => {

		console.error( `[${ run.id }] page error:`, String( e ) );
		failed = true;

	} );

	await page.goto( `http://127.0.0.1:5198/bench/index.html?${ run.query }`, { waitUntil: 'domcontentloaded' } );

	try {

		await page.waitForFunction( 'window.__BENCH !== undefined', { timeout: 300000, polling: 250 } );
		const result = await page.evaluate( 'window.__BENCH' );
		if ( ! run.discard ) results[ run.id ] = result;
		console.error( `[${ run.id }] done` );

	} catch {

		console.error( `[${ run.id }] did not finish` );
		failed = true;

	}

	await page.close();

}

await browser.close();
await server.close();

mkdirSync( `${ root }/bench`, { recursive: true } );
writeFileSync( `${ root }/bench/results.json`, JSON.stringify( { date: new Date().toISOString().slice( 0, 10 ), results }, null, '\t' ) + '\n' );

// markdown summary
const ids = Object.keys( results );
const poseNames = ids.length ? results[ ids[ 0 ] ].poses.map( p => p.name ) : [];
const lines = [];
lines.push( `| engine | ${ ids.map( id => results[ id ].engine ).join( ' | ' ) } |` );
lines.push( `|---|${ ids.map( () => '---' ).join( '|' ) }|` );

for ( const name of poseNames ) {

	for ( const [ metric, key ] of [ [ 'requests', 'requests' ], [ 'draw calls', 'drawCalls' ], [ 'triangles', 'triangles' ], [ 'textures', 'textures' ], [ 'time to stable (ms)', 'timeToStableMs' ], [ 'heap (MB)', 'heapMB' ] ] ) {

		const cells = ids.map( id => {

			const p = results[ id ].poses.find( p => p.name === name );
			return p ? `${ p[ key ] }${ p.timedOut ? ' (timeout)' : '' }` : '-';

		} );
		lines.push( `| ${ name }: ${ metric } | ${ cells.join( ' | ' ) } |` );

	}

}

for ( const [ metric, key ] of [ [ 'requests (fly + settle)', 'requestsTotal' ], [ 'mean frame CPU (ms)', 'meanFrameCpuMs' ], [ 'max frame CPU (ms)', 'maxFrameCpuMs' ], [ 'settle after fly (ms)', 'settleMs' ], [ 'textures after settle', 'texturesAfter' ] ] ) {

	const cells = ids.map( id => results[ id ].fly ? String( results[ id ].fly[ key ] ) : '-' );
	lines.push( `| fly city to street: ${ metric } | ${ cells.join( ' | ' ) } |` );

}

console.log( lines.join( '\n' ) );
process.exit( failed ? 1 : 0 );
