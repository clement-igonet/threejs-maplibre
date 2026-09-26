// Vector benchmark: runs bench/vector.html for this engine and for
// maplibre-gl-js on the same tiles, style and views under headless Chrome,
// prints a markdown comparison and writes bench/vector-results-<data>-<mode>.json.
// Offline on the Louvre extract by default; BENCH_DATA=openfreemap runs
// OpenFreeMap's Liberty style live. Numbers come from SwiftShader in a
// capped container, so compare them relative to each other, not absolutely.
// BENCH_RUNS=native,maplibre picks a subset; BENCH_MODE=planar the flat map.
import { mkdirSync, writeFileSync } from 'fs';
import { WARMUP, runVectorBench } from './vector-bench-run.mjs';

const root = new URL( '..', import.meta.url ).pathname;
const data = process.env.BENCH_DATA || 'louvre';
const mode = process.env.BENCH_MODE || 'globe';
const RUNS = [
	WARMUP,
	{ id: 'native', engine: 'native' },
	{ id: 'maplibre', engine: 'maplibre' },
].filter( run => run.discard || ! process.env.BENCH_RUNS || process.env.BENCH_RUNS.split( ',' ).includes( run.id ) );

const { results, failed } = await runVectorBench( { data, mode, runs: RUNS } );

mkdirSync( `${ root }/bench`, { recursive: true } );
writeFileSync( `${ root }/bench/vector-results-${ data }-${ mode }.json`, JSON.stringify( { date: new Date().toISOString().slice( 0, 10 ), data, mode, results }, null, '\t' ) + '\n' );

// markdown summary
const ids = Object.keys( results );
const poseNames = ids.length ? results[ ids[ 0 ] ].poses.map( p => p.name ) : [];
const lines = [];
lines.push( `| ${ data }, ${ mode } | ${ ids.map( id => results[ id ].engine ).join( ' | ' ) } |` );
lines.push( `|---|${ ids.map( () => '---' ).join( '|' ) }|` );

for ( const name of poseNames ) {

	for ( const [ metric, key ] of [ [ 'tiles requested', 'requests' ], [ 'draw calls', 'drawCalls' ], [ 'triangles', 'triangles' ], [ 'time to stable (ms)', 'timeToStableMs' ], [ 'engine p95 (ms)', 'engineP95Ms' ], [ 'heap (MB)', 'heapMB' ] ] ) {

		const cells = ids.map( id => {

			const p = results[ id ].poses.find( p => p.name === name );
			if ( ! p ) return '-';
			return `${ p[ key ] === null ? '-' : p[ key ] }${ p.timedOut ? ' (timeout)' : '' }`;

		} );
		lines.push( `| ${ name }: ${ metric } | ${ cells.join( ' | ' ) } |` );

	}

}

for ( const [ metric, key ] of [ [ 'tiles requested', 'requestsTotal' ], [ 'mean frame (ms)', 'meanFrameMs' ], [ 'p95 frame (ms)', 'p95FrameMs' ], [ 'max frame (ms)', 'maxFrameMs' ], [ 'engine mean / p95 (ms)', 'engine' ], [ 'frames over 16.7 ms', 'framesOver16Ms' ], [ 'frames over 50 ms', 'framesOver50Ms' ], [ 'settle after fly (ms)', 'settleMs' ], [ 'draw calls after settle', 'drawCallsAfter' ], [ 'heap after settle (MB)', 'heapMB' ] ] ) {

	const cells = ids.map( id => {

		const fly = results[ id ].fly;
		if ( ! fly ) return '-';
		if ( key === 'engine' ) return fly.engineMeanMs === null ? '-' : `${ fly.engineMeanMs } / ${ fly.engineP95Ms }`;
		return `${ fly[ key ] }${ key === 'settleMs' && fly.timedOut ? ' (timeout)' : '' }`;

	} );
	lines.push( `| fly district to street: ${ metric } | ${ cells.join( ' | ' ) } |` );

}

console.log( lines.join( '\n' ) );
process.exit( failed ? 1 : 0 );
