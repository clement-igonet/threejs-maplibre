// Boots vite and headless Chrome and drives bench/vector.html through its
// poses and fly, once per engine asked for. Shared by the head-to-head
// benchmark (bench-vector.mjs) and the CI budget (budget.mjs).
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = new URL( '..', import.meta.url ).pathname;

// The first run pays shader compilation and vite transforms, so every caller
// wants a discarded warmup before the numbers.
export const WARMUP = { id: 'warmup', engine: 'native', discard: true };

export async function runVectorBench( { data, mode, runs, port = 5197, onRun } ) {

	const server = await createServer( { root, server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'warn' } );
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

	for ( const run of runs ) {

		const page = await browser.newPage();
		page.on( 'pageerror', e => {

			console.error( `[${ run.id }] page error:`, e.stack ?? String( e ) );
			failed = true;

		} );
		page.on( 'error', e => console.error( `[${ run.id }] page crashed:`, e.message ) );
		page.on( 'console', message => {

			if ( message.type() === 'error' || process.env.BENCH_DEBUG ) console.error( `[${ run.id }] console.${ message.type() }: ${ message.text() }` );

		} );

		await page.goto( `http://127.0.0.1:${ port }/bench/vector.html?engine=${ run.engine }&data=${ data }&mode=${ mode }`, { waitUntil: 'domcontentloaded' } );

		try {

			await page.waitForFunction( 'window.__BENCH !== undefined', { timeout: 600000, polling: 250 } );
			const result = await page.evaluate( 'window.__BENCH' );
			if ( ! run.discard ) results[ run.id ] = result;
			console.error( `[${ run.id }] done` );
			if ( onRun ) onRun( run, result );

		} catch ( e ) {

			console.error( `[${ run.id }] did not finish: ${ e.cause?.message ?? e.message }` );
			failed = true;

		}

		await page.close();

	}

	await browser.close();
	await server.close();

	return { results, failed };

}
