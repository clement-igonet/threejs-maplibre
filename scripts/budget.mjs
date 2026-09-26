// Performance budget for CI: drives this engine through the benchmark poses
// on the offline Louvre extract and fails when a number is over its ceiling
// in bench/budget.json. BENCH_MODE=planar checks the flat map instead.
//
// What is checked is what a headless machine can answer for: the tiles a
// view asks the network for, the draw calls and triangles it hands the GPU,
// and, once the view is still, the engine's own CPU per frame (the
// selection walk and the uniforms, not the software rasterizer's render
// after it). Those are the 60 fps budget: at 16.7 ms a frame, the engine
// has to leave the frame to the GPU.
//
// Not enforced, only printed: frame times, which on a GPU-less runner say
// nothing, and the engine's CPU while tiles are landing, where one frame in
// twenty carries a tile upload or the garbage collector and the spread is
// wider than a ceiling can be useful.
//
// BUDGET_UPDATE=1 rewrites the ceilings from this run instead of checking
// them, for when a change is meant to move a number.
import { readFileSync, writeFileSync } from 'fs';
import { WARMUP, runVectorBench } from './vector-bench-run.mjs';

const root = new URL( '..', import.meta.url ).pathname;
const path = `${ root }/bench/budget.json`;
const data = 'louvre'; // the committed extract: same tiles on every machine
const mode = process.env.BENCH_MODE || 'globe';

const budget = JSON.parse( readFileSync( path, 'utf8' ) );
const ceilings = budget[ `${ data }-${ mode }` ];
if ( ! ceilings ) throw new Error( `no budget for ${ data }-${ mode } in bench/budget.json` );

const { results, failed } = await runVectorBench( {
	data, mode, port: 5198,
	runs: [ WARMUP, { id: 'native', engine: 'native' } ],
} );

if ( failed || ! results.native ) {

	console.error( 'budget: the run did not finish' );
	process.exit( 1 );

}

// Headroom, since a slower machine can take an extra frame to settle and
// ask for one more ancestor tile on the way. The draw calls are the tight
// one: a layer is one call, and a regression there is the thing this guards.
const MARGIN = { requests: 1.25, drawCalls: 1.15, triangles: 1.05, engineP95Ms: 4 };

const measured = {};
const problems = [];

function check( where, values ) {

	measured[ where ] = values;
	const limits = ceilings[ where ] ?? {};
	for ( const [ key, value ] of Object.entries( values ) ) {

		const limit = limits[ key ];
		if ( limit === undefined || value === null ) continue;
		const allowed = Math.round( limit * ( MARGIN[ key ] ?? 1 ) * 10 ) / 10;
		const over = value > allowed;
		console.log( `${ over ? 'over  ' : 'ok    ' } ${ where }.${ key }: ${ value }, budget ${ limit }, allowed ${ allowed }` );
		if ( over ) problems.push( `${ where }.${ key } is ${ value }, over ${ allowed }` );

	}

}

for ( const pose of results.native.poses ) {

	check( pose.name, {
		requests: pose.requests,
		drawCalls: pose.drawCalls,
		triangles: pose.triangles,
	} );
	console.log( `       ${ pose.name }.engineP95Ms: ${ pose.engineP95Ms } while its tiles land, not enforced` );

}

const fly = results.native.fly;
check( 'fly', {
	requests: fly.requestsTotal,
	drawCalls: fly.drawCallsAfter,
	engineP95Ms: fly.engineP95Ms,
} );

if ( process.env.BUDGET_UPDATE ) {

	budget[ `${ data }-${ mode }` ] = measured;
	writeFileSync( path, JSON.stringify( budget, null, '\t' ) + '\n' );
	console.log( `\nbudget: wrote this run into bench/budget.json for ${ data }-${ mode }` );
	process.exit( 0 );

}

console.log( `\nframe times (software rasterizer, not enforced): mean ${ fly.meanFrameMs } ms, p95 ${ fly.p95FrameMs } ms` );

if ( problems.length ) {

	console.error( `\nbudget: ${ problems.length } over budget\n  ${ problems.join( '\n  ' ) }` );
	console.error( '\nIf the change is meant to move these, rerun with BUDGET_UPDATE=1 and commit bench/budget.json.' );
	process.exit( 1 );

}

console.log( '\nbudget: within budget' );
