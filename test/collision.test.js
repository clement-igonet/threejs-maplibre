import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createGeoJSONVectorSource } from '../demo/geojson-vector-source.js';
import { STATION_STYLE } from '../demo/station-style.js';
import { buildTile } from '../src/build/buildTile.js';
import { decodeVectorTile } from '../src/core/decodeVectorTile.js';
import { Style } from '../src/style/Style.js';
import { buildColliders, collideCapsule, groundBelow, raycastFirst } from '../src/three/colliders.js';
import { appendFloor, appendWallRun } from '../src/build/buildIndoor.js';
import { CharacterController } from '../src/game/CharacterController.js';
import { latitudeToNormalized, longitudeToNormalized, normalizedToMeters } from '../src/math/WebMercator.js';

const { layers } = JSON.parse( readFileSync( new URL( '../demo/data/saint-lazare.json', import.meta.url ) ) );
const { tile } = createGeoJSONVectorSource( layers, { maxZoom: 16 } );
const style = new Style( STATION_STYLE );
const LAT = 48.8762, LON = 2.3253;
const z = 16, x = Math.floor( longitudeToNormalized( LON ) * 2 ** z ), y = Math.floor( latitudeToNormalized( LAT ) * 2 ** z );
const built = buildTile( decodeVectorTile( tile( z, x, y ) ), style, { sourceId: 'openmaptiles', x, y, z, mode: 'planar' } );
const colliders = buildColliders( built );
const scene = ( lat, lon ) => { const [ mx, my ] = normalizedToMeters( longitudeToNormalized( lon ), latitudeToNormalized( lat ) ); return [ mx, - my ]; };

// a map of just this tile, the way VectorTileMap answers
const map = {
	collideCapsule( start, end, radius, out ) { out.set( 0, 0, 0 ); out.onGround = false; return collideCapsule( colliders, start, end, radius, out ); },
	groundBelow( point, max ) { return groundBelow( colliders, point, max ); },
};

describe( 'colliders', () => {

	it( 'keeps a bounds tree per extrusion block of the station tile', () => {

		expect( colliders.length ).toBeGreaterThan( 5 );
		for ( const c of colliders ) expect( c.bounds.isEmpty() ).toBe( false );
		expect( colliders.some( c => c.level === 0 ) ).toBe( true );

	} );

	it( 'finds the hall floor under a point inside the station and nothing under the street', () => {

		// over a level 0 floor slab, the ground is its top, 15 cm up
		const floor = built.blocks.find( b => b.id === 'indoor-floor' && b.level === 0 );
		const i = floor.indices;
		const p = floor.positions;
		const cx = ( p[ 3 * i[ 0 ] ] + p[ 3 * i[ 1 ] ] + p[ 3 * i[ 2 ] ] ) / 3 + built.center.x;
		const cz = ( p[ 3 * i[ 0 ] + 2 ] + p[ 3 * i[ 1 ] + 2 ] + p[ 3 * i[ 2 ] + 2 ] ) / 3 + built.center.z;
		// from 2 m up: higher, the level 1 platforms' outline is overhead
		const hall = groundBelow( colliders, new Vector3( cx, 2, cz ), 50 );
		expect( hall ).not.toBeNull();
		expect( hall ).toBeGreaterThanOrEqual( 0 );
		expect( hall ).toBeLessThanOrEqual( 0.15 + 1e-6 );
		// a point on the rue de Rome, outside every building
		const [ sx, sz ] = scene( 48.8775, 2.3225 );
		expect( groundBelow( colliders, new Vector3( sx, 5, sz ), 50 ) ).toBeNull();

	} );

	it( 'pushes a capsule out of a wall it overlaps', () => {

		// put the capsule on a wall vertex of the first wall block
		const wall = built.blocks.find( b => b.id === 'indoor-wall' && b.level === 0 );
		const px = wall.positions[ 0 ] + built.center.x, py = wall.positions[ 1 ] + built.center.y, pz = wall.positions[ 2 ] + built.center.z;
		const start = new Vector3( px, py + 0.5, pz ), end = new Vector3( px, py + 1.3, pz );
		const out = new Vector3();
		collideCapsule( colliders, start, end, 0.35, out );
		expect( out.length() ).toBeGreaterThan( 0.1 );
		// pushed, the capsule no longer overlaps
		const again = new Vector3();
		collideCapsule( colliders, start.clone(), end.clone(), 0.35, again );
		expect( again.length() ).toBeLessThan( 0.05 );

	} );

} );

describe( 'raycastFirst', () => {

	it( 'measures the distance to the first wall along a ray, and nothing where there is none', () => {

		const wall = built.blocks.find( b => b.id === 'indoor-wall' && b.level === 0 );
		const px = wall.positions[ 0 ] + built.center.x, py = wall.positions[ 1 ] + built.center.y, pz = wall.positions[ 2 ] + built.center.z;
		// from 3 m east of a wall vertex, aiming west at it
		const d = raycastFirst( colliders, new Vector3( px + 3, py + 1, pz ), new Vector3( - 1, 0, 0 ), 10 );
		expect( d ).not.toBeNull();
		expect( d ).toBeLessThanOrEqual( 3.01 );
		// straight up from the street, there is only sky
		const [ sx, sz ] = scene( 48.8775, 2.3225 );
		expect( raycastFirst( colliders, new Vector3( sx, 1, sz ), new Vector3( 0, 1, 0 ), 1000 ) ).toBeNull();

	} );

} );

describe( 'CharacterController', () => {

	it( 'steers: right turns it clockwise, forward walks the way it faces, backward does not turn it round', () => {

		const c = new CharacterController( map );
		const [ sx, sz ] = scene( 48.8775, 2.3225 );
		c.place( sx, 0, sz );
		c.heading = Math.PI / 2; // facing north, -z
		for ( let i = 0; i < 60; i ++ ) c.update( 1 / 60, { forward: 1, right: 0 } );
		expect( c.position.z ).toBeLessThan( sz - 1.3 );
		expect( Math.abs( c.position.x - sx ) ).toBeLessThan( 1e-6 );
		// a second of full right: 2.4 radians clockwise, standing still
		const z = c.position.z;
		for ( let i = 0; i < 60; i ++ ) c.update( 1 / 60, { forward: 0, right: 1 } );
		expect( c.heading ).toBeCloseTo( Math.PI / 2 - 2.4, 6 );
		expect( c.position.z ).toBeCloseTo( z, 6 );
		expect( c.speed ).toBe( 0 );
		// backward: half speed, the heading kept
		const h = c.heading;
		c.update( 0.5, { forward: - 1, right: 0 } );
		expect( c.heading ).toBe( h );
		expect( c.speed ).toBeCloseTo( 0.8, 6 );

	} );

	it( 'walks where it is pushed, in the camera\'s frame, and stays on the street', () => {

		const c = new CharacterController( map, { steering: false } );
		const [ sx, sz ] = scene( 48.8775, 2.3225 );
		c.place( sx, 0, sz );
		for ( let i = 0; i < 60; i ++ ) c.update( 1 / 60, { forward: 1, right: 0, run: false, jump: false }, Math.PI / 2 ); // camera looking north (-z)
		expect( c.position.z ).toBeLessThan( sz - 1.3 ); // 1.6 m/s for a second, northwards
		expect( Math.abs( c.position.x - sx ) ).toBeLessThan( 1e-6 );
		expect( c.position.y ).toBeCloseTo( 0, 6 );
		expect( c.onGround ).toBe( true );
		expect( c.heading ).toBeCloseTo( Math.PI / 2, 6 );

	} );

	it( 'falls onto the hall floor and runs faster than it walks', () => {

		const c = new CharacterController( map );
		const floor = built.blocks.find( b => b.id === 'indoor-floor' && b.level === 0 );
		const i = floor.indices, p = floor.positions;
		const hx = ( p[ 3 * i[ 0 ] ] + p[ 3 * i[ 1 ] ] + p[ 3 * i[ 2 ] ] ) / 3 + built.center.x;
		const hz = ( p[ 3 * i[ 0 ] + 2 ] + p[ 3 * i[ 1 ] + 2 ] + p[ 3 * i[ 2 ] + 2 ] ) / 3 + built.center.z;
		c.place( hx, 1, hz ); // head under the level 1 outline, its slab at 2.95 m
		for ( let i = 0; i < 120; i ++ ) c.update( 1 / 60, { forward: 0, right: 0, run: false, jump: false }, 0 );
		expect( c.position.y ).toBeGreaterThanOrEqual( 0 );
		expect( c.position.y ).toBeLessThanOrEqual( 0.15 + 1e-3 );
		expect( c.onGround ).toBe( true );
		const walk = new CharacterController( map ).place( hx, 0.15, hz ), run = new CharacterController( map ).place( hx, 0.15, hz );
		walk.update( 0.1, { forward: 1, right: 0, run: false }, 0 );
		run.update( 0.1, { forward: 1, right: 0, run: true }, 0 );
		expect( run.speed ).toBeGreaterThan( walk.speed );

	} );

	it( 'walks from the forecourt through an entrance into the hall', () => {

		// the demo's start: the level 0 entrance nearest the cour de Rome,
		// 9 m south of it, facing north-north-east
		const entrances = layers.indoor.features.filter( f => f.properties.class === 'entrance' && ( f.properties.levels ?? '' ).split( ';' ).includes( '0' ) );
		const near = entrances.sort( ( a, b ) => Math.hypot( a.geometry.coordinates[ 0 ] - 2.3245, a.geometry.coordinates[ 1 ] - 48.8762 ) - Math.hypot( b.geometry.coordinates[ 0 ] - 2.3245, b.geometry.coordinates[ 1 ] - 48.8762 ) )[ 0 ];
		const [ ex, ez ] = scene( near.geometry.coordinates[ 1 ], near.geometry.coordinates[ 0 ] );
		const [ sx, sz ] = scene( near.geometry.coordinates[ 1 ] - 0.00008, near.geometry.coordinates[ 0 ] );
		const c = new CharacterController( map ).place( sx, 0, sz );
		// face the entrance and walk at it for 15 s
		c.heading = Math.atan2( - ( ez - sz ), ex - sx );
		const track = [];
		for ( let i = 0; i < 15 * 60; i ++ ) {

			c.update( 1 / 60, { forward: 1, right: 0 } );
			if ( i % 60 === 59 ) track.push( Math.hypot( c.position.x - sx, c.position.z - sz ) );

		}

		console.log( 'walked from the forecourt, metres at each second:', track.map( d => d.toFixed( 1 ) ).join( ' ' ) );
		// it got past the entrance, 9 m away, and stands on a floor indoors
		expect( track[ track.length - 1 ] ).toBeGreaterThan( 12 );
		const head = c.position.clone();
		head.y += 1.5;
		expect( map.groundBelow( head, 3 ) ).not.toBeNull();

	} );

	it( 'stays inside its bounds, walking or jumping at the edge', () => {

		const [ sx, sz ] = scene( 48.8775, 2.3225 );
		const bounds = { minX: sx - 5, maxX: sx + 5, minZ: sz - 5, maxZ: sz + 5 };
		const c = new CharacterController( map, { bounds } ).place( sx, 0, sz );
		c.heading = 0; // east
		for ( let i = 0; i < 10 * 60; i ++ ) c.update( 1 / 60, { forward: 1, right: 0, run: true, jump: i % 30 === 0 } );
		expect( c.position.x ).toBeLessThanOrEqual( sx + 5 - c.radius + 1e-9 );
		expect( c.position.x ).toBeGreaterThan( sx + 4 );
		expect( c.atEdge ).toBe( true );
		// back inside, the edge lets go
		c.heading = Math.PI;
		for ( let i = 0; i < 60; i ++ ) c.update( 1 / 60, { forward: 1, right: 0 } );
		expect( c.atEdge ).toBe( false );

	} );

	it( 'rides up the escalators from the hall onto level 1, through the hole in its floor', () => {

		// the escalator going up from the hall: its foot and its head
		const [ ax, az ] = scene( 48.876162, 2.32514 ), [ bx, bz ] = scene( 48.876143, 2.324984 );
		const c = new CharacterController( map ).place( ax + ( ax - bx ) * 0.15, 0.15, az + ( az - bz ) * 0.15 ); // a step before its foot
		c.heading = Math.atan2( - ( bz - az ), bx - ax );
		// 17.7 m of escalator in the map's frame (mercator meters, 1.52 a meter
		// at this latitude) at 1.6 a second, and a few steps onto level 1
		for ( let i = 0; i < 16 * 60; i ++ ) c.update( 1 / 60, { forward: 1, right: 0 } );
		console.log( 'after the escalator: y', c.position.y.toFixed( 2 ), 'onGround', c.onGround );
		expect( c.position.y ).toBeGreaterThan( 3 ); // on level 1, 3.15
		expect( c.position.y ).toBeLessThan( 3.4 );

	} );

	it( 'keeps collision for the most detailed tiles only, where every door is cut', async () => {

		const { VectorTileMap } = await import( '../src/three/VectorTileMap.js' );
		const { createGeoJSONVectorSource } = await import( '../demo/geojson-vector-source.js' );
		const { source } = createGeoJSONVectorSource( layers, { maxZoom: 16 } );
		const m = new VectorTileMap( source, style, { mode: 'planar', sourceId: 'openmaptiles', collision: true, workers: 0 } );
		const parent = { blocks: [ ...built.blocks ], center: built.center };
		const child = { blocks: [ ...built.blocks ], center: built.center };
		m._upload( parent, null, { z: 14 } );
		m._upload( child, null, { z: 16 } );
		expect( parent.colliders ).toBeUndefined();
		expect( child.colliders.length ).toBeGreaterThan( 0 );
		m.dispose();

	} );

	it( 'keeps a sensible zoom for a camera under the street, and close up', async () => {

		const { VectorTileMap } = await import( '../src/three/VectorTileMap.js' );
		const { PerspectiveCamera } = await import( 'three' );
		const { createGeoJSONVectorSource } = await import( '../demo/geojson-vector-source.js' );
		const { source } = createGeoJSONVectorSource( layers, { maxZoom: 16 } );
		const m = new VectorTileMap( source, style, { mode: 'planar', sourceId: 'openmaptiles', workers: 0 } );
		const renderer = { domElement: { height: 500 }, getSize: v => v.set( 800, 500 ) };
		const zoomAt = ( y, lookY ) => {

			const camera = new PerspectiveCamera( 55, 1.6, 0.1, 5000 );
			camera.position.set( 0, y, 0 );
			camera.lookAt( 0, lookY, - 5 );
			camera.updateMatrixWorld();
			return m._cameraZoom( camera, renderer );

		};

		for ( const z of [ zoomAt( - 1.2, - 2.5 ), zoomAt( - 1.2, 0 ), zoomAt( 2.7, 1.4 ), zoomAt( 1.7, 5 ), zoomAt( 300, 0 ) ] ) {

			expect( Number.isFinite( z ) ).toBe( true );
			expect( z ).toBeGreaterThanOrEqual( 0 );
			expect( z ).toBeLessThan( 24 ); // every layer with the default maxzoom still shows

		}

		m.dispose();

	} );

	it( 'walks under the floor of a fractional level, and is held by walls of its own level only', () => {

		// a floor at level 0 everywhere, a slab of level 0.25 (0.75 m up) over
		// the middle of the way, and a wall of level 1 (3 m up) across the way
		const projection = { project( x, y, h, o ) { o[ 0 ] = x; o[ 1 ] = h; o[ 2 ] = y; return o; } };
		const block = ( indoor, level, base, build ) => { const out = { positions: [], colors: [], indices: [], vertexCount: 0 }; build( out ); return { type: 'fill-extrusion', indoor, level, base, positions: new Float32Array( out.positions ), indices: new Uint32Array( out.indices ) }; };
		const white = [ 255, 255, 255, 255 ];
		const fake = { center: new Vector3(), blocks: [
			block( 'floor', 0, 0, out => appendFloor( out, [ [ - 5, - 5, 40, - 5, 40, 5, - 5, 5 ] ], projection, white, 0 ) ),
			block( 'floor', 0.25, 0.75, out => appendFloor( out, [ [ 10, - 5, 20, - 5, 20, 5, 10, 5 ] ], projection, white, 0.75 ) ),
			block( 'wall', 1, 3, out => appendWallRun( out, [ 25, - 5, 25, 5 ], projection, white, 3, 5.5 ) ),
		] };
		const cols = buildColliders( fake );
		const fakeMap = { collideCapsule( a, b, r, out, feet ) { out.set( 0, 0, 0 ); out.onGround = false; return collideCapsule( cols, a, b, r, out, feet ); }, groundBelow( p, m ) { return groundBelow( cols, p, m ); } };
		const c = new CharacterController( fakeMap ).place( 0, 0.15, 0 );
		c.heading = 0; // east, +x
		for ( let i = 0; i < 25 * 60; i ++ ) c.update( 1 / 60, { forward: 1, right: 0 } );
		expect( c.position.x ).toBeGreaterThan( 30 ); // under the slab and past the level 1 wall
		expect( c.position.y ).toBeCloseTo( 0.15, 3 ); // never lifted onto the slab
		// standing on the slab from above still works
		const up = new CharacterController( fakeMap ).place( 15, 2, 0 );
		for ( let i = 0; i < 60; i ++ ) up.update( 1 / 60, { forward: 0, right: 0 } );
		expect( up.position.y ).toBeCloseTo( 0.9, 3 );

	} );

	it( 'lands on the level outline between mapped rooms, where a jump at Saint-Lazare used to fall through', () => {

		// the spot of a hand-play report: level -1 by McDonald's, a jump to
		// the left over a strip no room or corridor covers, inside the
		// outline of level -1 (OSM way 320530315) and over nothing else
		const lat = 48.876152, lon = 2.326191, facing = 158;
		const tx = Math.floor( longitudeToNormalized( lon ) * 2 ** z ), ty = Math.floor( latitudeToNormalized( lat ) * 2 ** z );
		const cols = [];
		for ( let dx = - 1; dx <= 1; dx ++ ) for ( let dy = - 1; dy <= 1; dy ++ ) cols.push( ...buildColliders( buildTile( decodeVectorTile( tile( z, tx + dx, ty + dy ) ), style, { sourceId: 'openmaptiles', x: tx + dx, y: ty + dy, z, mode: 'planar' } ) ) );
		const here = { collideCapsule( a, b, r, out, feet ) { out.set( 0, 0, 0 ); out.onGround = false; return collideCapsule( cols, a, b, r, out, feet ); }, groundBelow( p, m ) { return groundBelow( cols, p, m ); } };
		const k = 1 / Math.cos( lat * Math.PI / 180 ), b = facing * Math.PI / 180;
		const [ x0, z0 ] = scene( lat, lon );
		const gap = new Vector3( x0 + Math.sin( b ) * 2.5 * k, - 2.4, z0 - Math.cos( b ) * 2.5 * k );
		expect( groundBelow( cols, gap, 50 ) ).toBeCloseTo( - 2.9, 3 ); // 5 cm under the rooms' floors

		const c = new CharacterController( here ).place( x0, - 2.85, z0 );
		c.heading = ( 90 - facing ) * Math.PI / 180;
		let lowest = 0;
		for ( let i = 0; i < 4 * 60; i ++ ) {

			c.update( 1 / 60, { forward: 1, right: 0, jump: i === 30 } );
			lowest = Math.min( lowest, c.position.y );

		}

		expect( c.fell ).toBe( false );
		expect( lowest ).toBeGreaterThan( - 3 );
		expect( c.onGround ).toBe( true );

	} );

	it( 'falls off a balcony to the floor below, keeps the street outdoors, and is caught by a void', () => {

		const projection = { project( x, y, h, o ) { o[ 0 ] = x; o[ 1 ] = h; o[ 2 ] = y; return o; } };
		const white = [ 255, 255, 255, 255 ];
		const block = ( indoor, level, base, build ) => { const out = { positions: [], colors: [], indices: [], vertexCount: 0 }; build( out ); return { type: 'fill-extrusion', indoor, level, base, positions: new Float32Array( out.positions ), indices: new Uint32Array( out.indices ) }; };
		// level -1 (top at -2.85) for x < 10 only, level -3 (top at -8.85) everywhere from x = -5 to 40
		const fake = { center: new Vector3(), blocks: [
			block( 'floor', - 1, - 3, out => appendFloor( out, [ [ - 5, - 5, 10, - 5, 10, 5, - 5, 5 ] ], projection, white, - 3 ) ),
			block( 'floor', - 3, - 9, out => appendFloor( out, [ [ - 5, - 5, 40, - 5, 40, 5, - 5, 5 ] ], projection, white, - 9 ) ),
		] };
		const cols = buildColliders( fake );
		const fakeMap = { collideCapsule( a, b, r, out, feet ) { out.set( 0, 0, 0 ); out.onGround = false; return collideCapsule( cols, a, b, r, out, feet ); }, groundBelow( p, m ) { return groundBelow( cols, p, m ); } };

		// off the edge of level -1: down six meters to level -3, not up to the street
		const c = new CharacterController( fakeMap ).place( 0, - 2.85, 0 );
		c.heading = 0;
		for ( let i = 0; i < 8 * 60; i ++ ) c.update( 1 / 60, { forward: 1, right: 0 } ); // 12.8 m at 1.6 m/s
		expect( c.position.x ).toBeGreaterThan( 10 );
		expect( c.position.y ).toBeCloseTo( - 8.85, 3 );

		// on the street, nothing under it but the street
		const street = new CharacterController( fakeMap ).place( 60, 0, 0 );
		for ( let i = 0; i < 60; i ++ ) street.update( 1 / 60, { forward: 0, right: 0 } );
		expect( street.position.y ).toBe( 0 );

		// underground over nothing: a fall, caught, put back where it stood
		const lost = new CharacterController( fakeMap ).place( 60, - 5, 0 );
		for ( let i = 0; i < 4 * 60 && ! lost.fell; i ++ ) lost.update( 1 / 60, { forward: 0, right: 0 } );
		expect( lost.fell ).toBe( true );
		expect( lost.position.y ).toBeCloseTo( - 5, 2 ); // the substeps left in that frame fall a hair

	} );

} );
