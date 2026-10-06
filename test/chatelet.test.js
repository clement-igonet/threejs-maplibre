import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { createGeoJSONVectorSource } from '../demo/geojson-vector-source.js';
import { STATION_STYLE } from '../demo/station-style.js';
import { LOUVRE_STYLE } from '../demo/louvre-style.js';
import { buildTile } from '../src/build/buildTile.js';
import { decodeVectorTile } from '../src/core/decodeVectorTile.js';
import { Style } from '../src/style/Style.js';
import { buildColliders, collideCapsule, groundBelow } from '../src/three/colliders.js';
import { CharacterController } from '../src/game/CharacterController.js';
import { Places } from '../src/game/Places.js';
import { latitudeToNormalized, longitudeToNormalized, normalizedToMeters } from '../src/math/WebMercator.js';

// Chatelet-Les Halles, the second place to walk: the Forum des Halles over
// the station, the stress test of the level grammar (-3.5, -0.75, 2.25)
const { layers } = JSON.parse( readFileSync( new URL( '../demo/data/chatelet.json', import.meta.url ) ) );
const { tile } = createGeoJSONVectorSource( layers, { maxZoom: 16 } );
const style = new Style( { ...STATION_STYLE, layers: [ ...STATION_STYLE.layers.filter( l => l.id !== 'building' ), LOUVRE_STYLE.layers.find( l => l.id === 'building-3d' ) ] } );
const places = new Places( layers );
const scene = ( lat, lon ) => { const [ mx, my ] = normalizedToMeters( longitudeToNormalized( lon ), latitudeToNormalized( lat ) ); return [ mx, - my ]; };

describe( 'Chatelet-Les Halles', () => {

	it( 'reads its fractional levels and names its spaces', () => {

		const levels = new Set( places.labels.map( l => l.level ) );
		expect( [ ...levels ].some( l => ! Number.isInteger( l ) ) ).toBe( true );
		expect( places.graph.stats.spaces ).toBeGreaterThan( 250 );

	} );

	it( 'walks in from the Passage de la Canopee through the Lego entrance', () => {

		// the demo's start: 8 m north of the entrance, facing south
		const lat = 48.861650, lon = 2.347411;
		const z = 16, tx = Math.floor( longitudeToNormalized( lon ) * 2 ** z ), ty = Math.floor( latitudeToNormalized( lat ) * 2 ** z );
		const colliders = [];
		for ( let dx = - 1; dx <= 1; dx ++ ) for ( let dy = - 1; dy <= 1; dy ++ ) colliders.push( ...buildColliders( buildTile( decodeVectorTile( tile( z, tx + dx, ty + dy ) ), style, { sourceId: 'openmaptiles', x: tx + dx, y: ty + dy, z, mode: 'planar' } ) ) );
		const map = { collideCapsule( a, b, r, out ) { out.set( 0, 0, 0 ); out.onGround = false; return collideCapsule( colliders, a, b, r, out ); }, groundBelow( p, m ) { return groundBelow( colliders, p, m ); } };
		const [ x, zz ] = scene( lat, lon );
		const c = new CharacterController( map ).place( x, 0, zz );
		c.heading = - Math.PI / 2; // south
		for ( let i = 0; i < 10 * 60; i ++ ) c.update( 1 / 60, { forward: 1, right: 0 } );
		const k = 1 / Math.cos( lat * Math.PI / 180 );
		const walked = Math.hypot( c.position.x - x, c.position.z - zz ) / k;
		const lonNow = lon + ( c.position.x - x ) / k / ( 111320 * Math.cos( lat * Math.PI / 180 ) ), latNow = lat - ( c.position.z - zz ) / k / 111320;
		const w = places.where( lonNow, latNow, 0 );
		console.log( `walked ${ walked.toFixed( 1 ) } m, now in ${ w.space ?? w.kind ?? w.street }` );
		expect( walked ).toBeGreaterThan( 9 ); // past the entrance, 8 m away
		expect( w.indoor ).toBe( true );

	} );

} );
