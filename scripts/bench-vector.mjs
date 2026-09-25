// Vector benchmark: runs bench/vector.html for this engine and for
// maplibre-gl-js on the same tiles, style and views under headless Chrome,
// prints a markdown comparison and writes bench/vector-results-<data>-<mode>.json.
// Offline on the Louvre extract by default; BENCH_DATA=openfreemap runs
// OpenFreeMap's Liberty style live. Numbers come from SwiftShader in a
// capped container, so compare them relative to each other, not absolutely.
// BENCH_RUNS=native,maplibre picks a subset; BENCH_MODE=planar the flat map.
import { mkdirSync, writeFileSync } from 'fs';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = new URL( '..', import.meta.url ).pathname;
const data = process.env.BENCH_DATA || 'louvre';
const mode = process.env.BENCH_MODE || 'globe';
const RUNS = [
	{ id: 'warmup', engine: 'native', discard: true }, // first run pays shader compilation and vite transforms
	{ id: 'native', engine: 'native' },
	{ id: 'maplibre', engine: 'maplibre' },
].filter( run => run.discard || ! process.env.BENCH_RUNS || process.env.BENCH_RUNS.split( ',' ).includes( run.id ) );

const server = await createServer( { root, server: { host: '127.0.0.1', port: 5197, strictPort: true }, logLevel: 'warn' } );
await server.listen();

const browser = await puppeteer.launch( {
	headless: true,
	args: [ '--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc' ],
	defaultViewport: { width: 800, height: 500 },
	dumpio: !! process.env.BENCH_DEBUG,
	protocolTimeout: 600000, // a software-rendered frame can hold the main thread for a while
	timeout: 120000, // a loaded shared machine can be slow to hand Chrome a port
} );

const results = {};
let failed = false;

for ( const run of RUNS ) {

	const page = await browser.newPage();
	page.on( 'pageerror', e => {

		console.error( `[${ run.id }] page error:`, e.stack ?? String( e ) );
		failed = true;

	} );
	page.on( 'error', e => console.error( `[${ run.id }] page crashed:`, e.message ) );
	page.on( 'console', message => {

		if ( message.type() === 'error' || process.env.BENCH_DEBUG ) console.error( `[${ run.id }] console.${ message.type() }: ${ message.text() }` );

	} );

	await page.goto( `http://127.0.0.1:5197/bench/vector.html?engine=${ run.engine }&data=${ data }&mode=${ mode }`, { waitUntil: 'domcontentloaded' } );

	try {

		await page.waitForFunction( 'window.__BENCH !== undefined', { timeout: 600000, polling: 250 } );
		const result = await page.evaluate( 'window.__BENCH' );
		if ( ! run.discard ) results[ run.id ] = result;
		console.error( `[${ run.id }] done` );

	} catch ( e ) {

		console.error( `[${ run.id }] did not finish: ${ e.cause?.message ?? e.message }` );
		failed = true;

	}

	await page.close();

}

await browser.close();
await server.close();

mkdirSync( `${ root }/bench`, { recursive: true } );
writeFileSync( `${ root }/bench/vector-results-${ data }-${ mode }.json`, JSON.stringify( { date: new Date().toISOString().slice( 0, 10 ), data, mode, results }, null, '\t' ) + '\n' );

// markdown summary
const ids = Object.keys( results );
const poseNames = ids.length ? results[ ids[ 0 ] ].poses.map( p => p.name ) : [];
const lines = [];
lines.push( `| ${ data }, ${ mode } | ${ ids.map( id => results[ id ].engine ).join( ' | ' ) } |` );
lines.push( `|---|${ ids.map( () => '---' ).join( '|' ) }|` );

for ( const name of poseNames ) {

	for ( const [ metric, key ] of [ [ 'tiles requested', 'requests' ], [ 'draw calls', 'drawCalls' ], [ 'triangles', 'triangles' ], [ 'time to stable (ms)', 'timeToStableMs' ], [ 'heap (MB)', 'heapMB' ] ] ) {

		const cells = ids.map( id => {

			const p = results[ id ].poses.find( p => p.name === name );
			return p ? `${ p[ key ] }${ p.timedOut ? ' (timeout)' : '' }` : '-';

		} );
		lines.push( `| ${ name }: ${ metric } | ${ cells.join( ' | ' ) } |` );

	}

}

for ( const [ metric, key ] of [ [ 'tiles requested', 'requestsTotal' ], [ 'mean frame (ms)', 'meanFrameMs' ], [ 'p95 frame (ms)', 'p95FrameMs' ], [ 'max frame (ms)', 'maxFrameMs' ], [ 'frames over 16.7 ms', 'framesOver16Ms' ], [ 'frames over 50 ms', 'framesOver50Ms' ], [ 'settle after fly (ms)', 'settleMs' ], [ 'draw calls after settle', 'drawCallsAfter' ], [ 'heap after settle (MB)', 'heapMB' ] ] ) {

	const cells = ids.map( id => results[ id ].fly ? `${ results[ id ].fly[ key ] }${ key === 'settleMs' && results[ id ].fly.timedOut ? ' (timeout)' : '' }` : '-' );
	lines.push( `| fly district to street: ${ metric } | ${ cells.join( ' | ' ) } |` );

}

console.log( lines.join( '\n' ) );
process.exit( failed ? 1 : 0 );
