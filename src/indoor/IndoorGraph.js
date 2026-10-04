// A walking graph over Simple Indoor Tagging, for routing inside a
// station: one node per room, corridor or area on each level it is on,
// one per door or entrance on each of its levels, two per staircase (its
// lower and upper end) and one per elevator stop. A door joins the spaces
// whose ring it sits on; corridors and areas join their neighbours
// outright where their rings touch (they are open, a room needs a door);
// stairs and lifts join the levels, at a cost in seconds the route is
// then searched on with A*.
//
// The graph works in local meters, east and north of the data's bounding
// box centre, so the costs are walking times and the demo can draw the
// route where it draws the floors. No three.js here: the module is pure
// data, so it runs in a worker or in node as it is.

const EARTH = 111320; // meters per degree of latitude, near enough
const DEG = Math.PI / 180;

// The levels a feature is on, from the extract's "levels" list
// ("-1;0"), the raw level tag already expanded by the extract script.
export function featureLevels( properties ) {

	const list = properties && properties.levels;
	if ( list === undefined || list === null || list === '' ) return [];
	return String( list ).split( ';' ).map( Number ).filter( Number.isFinite );

}

// The area-weighted centroid of a ring (flat [ x0, y0, x1, y1, ... ]),
// falling back to the vertex mean when the ring has no area.
export function ringCentroid( ring ) {

	const count = ring.length / 2;
	let area = 0, cx = 0, cy = 0;
	for ( let i = 0; i < count; i ++ ) {

		const j = ( i + 1 ) % count;
		const cross = ring[ 2 * i ] * ring[ 2 * j + 1 ] - ring[ 2 * j ] * ring[ 2 * i + 1 ];
		area += cross;
		cx += ( ring[ 2 * i ] + ring[ 2 * j ] ) * cross;
		cy += ( ring[ 2 * i + 1 ] + ring[ 2 * j + 1 ] ) * cross;

	}

	if ( Math.abs( area ) < 1e-9 ) {

		let sx = 0, sy = 0;
		for ( let i = 0; i < count; i ++ ) { sx += ring[ 2 * i ]; sy += ring[ 2 * i + 1 ]; }
		return [ sx / count, sy / count ];

	}

	return [ cx / ( 3 * area ), cy / ( 3 * area ) ];

}

export function ringArea( ring ) {

	const count = ring.length / 2;
	let area = 0;
	for ( let i = 0; i < count; i ++ ) {

		const j = ( i + 1 ) % count;
		area += ring[ 2 * i ] * ring[ 2 * j + 1 ] - ring[ 2 * j ] * ring[ 2 * i + 1 ];

	}

	return Math.abs( area ) / 2;

}

// Even-odd ray casting over one ring.
export function pointInRing( x, y, ring ) {

	const count = ring.length / 2;
	let inside = false;
	for ( let i = 0, j = count - 1; i < count; j = i ++ ) {

		const xi = ring[ 2 * i ], yi = ring[ 2 * i + 1 ];
		const xj = ring[ 2 * j ], yj = ring[ 2 * j + 1 ];
		if ( ( yi > y ) !== ( yj > y ) && x < ( xj - xi ) * ( y - yi ) / ( yj - yi ) + xi ) inside = ! inside;

	}

	return inside;

}

// Inside the outer ring and outside every hole.
export function pointInPolygon( x, y, rings ) {

	if ( ! pointInRing( x, y, rings[ 0 ] ) ) return false;
	for ( let i = 1; i < rings.length; i ++ ) if ( pointInRing( x, y, rings[ i ] ) ) return false;
	return true;

}

export function pointToSegment( px, py, ax, ay, bx, by ) {

	const dx = bx - ax, dy = by - ay;
	const length2 = dx * dx + dy * dy;
	let t = length2 === 0 ? 0 : ( ( px - ax ) * dx + ( py - ay ) * dy ) / length2;
	t = Math.max( 0, Math.min( 1, t ) );
	const x = ax + t * dx - px, y = ay + t * dy - py;
	return Math.sqrt( x * x + y * y );

}

// The shortest distance from a point to a ring's edges.
export function pointToRing( px, py, ring ) {

	const count = ring.length / 2;
	let best = Infinity;
	for ( let i = 0; i < count; i ++ ) {

		const j = ( i + 1 ) % count;
		const d = pointToSegment( px, py, ring[ 2 * i ], ring[ 2 * i + 1 ], ring[ 2 * j ], ring[ 2 * j + 1 ] );
		if ( d < best ) best = d;

	}

	return best;

}

function distance( a, b ) {

	const dx = a.x - b.x, dy = a.y - b.y;
	return Math.sqrt( dx * dx + dy * dy );

}

function vertexKey( x, y ) {

	return Math.round( x * 1000 ) + ',' + Math.round( y * 1000 );

}

const SPACES = new Set( [ 'room', 'corridor', 'area' ] );
const OPEN = new Set( [ 'corridor', 'area' ] );
const DOORS = new Set( [ 'door', 'entrance' ] );

// A binary heap of [ priority, value ], the smallest priority first.
class Heap {

	constructor() {

		this.items = [];

	}

	get size() {

		return this.items.length;

	}

	push( priority, value ) {

		const items = this.items;
		items.push( [ priority, value ] );
		let i = items.length - 1;
		while ( i > 0 ) {

			const parent = ( i - 1 ) >> 1;
			if ( items[ parent ][ 0 ] <= items[ i ][ 0 ] ) break;
			[ items[ parent ], items[ i ] ] = [ items[ i ], items[ parent ] ];
			i = parent;

		}

	}

	pop() {

		const items = this.items;
		const top = items[ 0 ];
		const last = items.pop();
		if ( items.length > 0 ) {

			items[ 0 ] = last;
			let i = 0;
			for ( ;; ) {

				const left = 2 * i + 1, right = left + 1;
				let smallest = i;
				if ( left < items.length && items[ left ][ 0 ] < items[ smallest ][ 0 ] ) smallest = left;
				if ( right < items.length && items[ right ][ 0 ] < items[ smallest ][ 0 ] ) smallest = right;
				if ( smallest === i ) break;
				[ items[ smallest ], items[ i ] ] = [ items[ i ], items[ smallest ] ];
				i = smallest;

			}

		}

		return top;

	}

}

export class IndoorGraph {

	constructor( origin, options = {} ) {

		this.origin = origin;
		this.levelHeight = options.levelHeight ?? 3;
		this.doorSnap = options.doorSnap ?? 0.5;
		this.stairCost = options.stairCost ?? 20;
		this.liftCost = options.liftCost ?? 15;
		this.walkSpeed = options.walkSpeed ?? 1.4;
		this.escalatorFactor = options.escalatorFactor ?? 0.7;

		this.nodes = [];
		this.edges = [];
		this.byId = new Map();
		this.adjacency = new Map();
		// level -> the space nodes on it, each with its rings in meters
		this.spacesByLevel = new Map();
		this.stats = { spaces: 0, doors: 0, stairs: 0, lifts: 0, edges: 0, levels: 0, isolated: 0, doorsOnNoRing: 0, stairsWithoutLevels: 0, stairEndsInNoSpace: 0, liftsInNoSpace: 0 };
		this._cosLat = Math.cos( origin.lat * DEG );

	}

	// Local meters east and north of the origin.
	toMeters( lon, lat ) {

		return { x: ( lon - this.origin.lon ) * EARTH * this._cosLat, y: ( lat - this.origin.lat ) * EARTH };

	}

	toLonLat( x, y ) {

		return { lon: this.origin.lon + x / ( EARTH * this._cosLat ), lat: this.origin.lat + y / EARTH };

	}

	get levels() {

		return [ ...this.spacesByLevel.keys() ].sort( ( a, b ) => a - b );

	}

	static fromLayers( { indoor, transportation }, options = {} ) {

		const indoorFeatures = ( indoor && indoor.features ) || [];
		const transportFeatures = ( transportation && transportation.features ) || [];

		// the origin, at the centre of everything's bounding box
		const bbox = [ Infinity, Infinity, - Infinity, - Infinity ];
		const extend = coordinates => {

			if ( typeof coordinates[ 0 ] === 'number' ) {

				bbox[ 0 ] = Math.min( bbox[ 0 ], coordinates[ 0 ] ); bbox[ 1 ] = Math.min( bbox[ 1 ], coordinates[ 1 ] );
				bbox[ 2 ] = Math.max( bbox[ 2 ], coordinates[ 0 ] ); bbox[ 3 ] = Math.max( bbox[ 3 ], coordinates[ 1 ] );

			} else for ( const c of coordinates ) extend( c );

		};

		for ( const f of indoorFeatures ) if ( f.geometry ) extend( f.geometry.coordinates );
		for ( const f of transportFeatures ) if ( f.geometry ) extend( f.geometry.coordinates );
		if ( bbox[ 0 ] === Infinity ) bbox.fill( 0 );
		const origin = options.origin ?? { lon: ( bbox[ 0 ] + bbox[ 2 ] ) / 2, lat: ( bbox[ 1 ] + bbox[ 3 ] ) / 2 };
		const graph = new IndoorGraph( origin, options );
		graph._build( indoorFeatures, transportFeatures );
		return graph;

	}

	_build( indoorFeatures, transportFeatures ) {

		const ring = coordinates => {

			const out = [];
			for ( const [ lon, lat ] of coordinates ) {

				const { x, y } = this.toMeters( lon, lat );
				out.push( x, y );

			}

			// a GeoJSON ring repeats its first point; drop the copy
			if ( out.length >= 4 && out[ 0 ] === out[ out.length - 2 ] && out[ 1 ] === out[ out.length - 1 ] ) out.length -= 2;
			return out;

		};

		// spaces, one node per level, with their rings for the lookups
		const vertexIndex = new Map(); // level -> vertex key -> [ space node ]
		for ( let index = 0; index < indoorFeatures.length; index ++ ) {

			const feature = indoorFeatures[ index ];
			const properties = feature.properties || {};
			if ( ! SPACES.has( properties.class ) || ! feature.geometry ) continue;
			const polygons = feature.geometry.type === 'Polygon' ? [ feature.geometry.coordinates ] : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
			if ( polygons.length === 0 ) continue;
			// the first polygon carries the node; a multipolygon's others only serve the lookups
			const rings = polygons[ 0 ].map( ring );
			const allRings = polygons.map( p => p.map( ring ) );
			const [ cx, cy ] = ringCentroid( rings[ 0 ] );
			const area = allRings.reduce( ( sum, r ) => sum + ringArea( r[ 0 ] ), 0 );
			const ref = feature.id ?? index;
			for ( const level of featureLevels( properties ) ) {

				const node = { id: `space:${ ref }:${ level }`, kind: 'space', x: cx, y: cy, level, name: properties.name ?? null, ref, class: properties.class, polygons: allRings, area };
				this._addNode( node );
				if ( ! this.spacesByLevel.has( level ) ) this.spacesByLevel.set( level, [] );
				this.spacesByLevel.get( level ).push( node );
				if ( ! vertexIndex.has( level ) ) vertexIndex.set( level, new Map() );
				const keys = vertexIndex.get( level );
				for ( const polygon of allRings ) for ( const r of polygon ) for ( let i = 0; i < r.length; i += 2 ) {

					const key = vertexKey( r[ i ], r[ i + 1 ] );
					if ( ! keys.has( key ) ) keys.set( key, [] );
					const list = keys.get( key );
					if ( ! list.includes( node ) ) list.push( node );

				}

			}

		}

		this.stats.spaces = this.nodes.length;

		// corridors and areas open onto whatever touches them
		for ( const [ , keys ] of vertexIndex ) for ( const [ , list ] of keys ) {

			if ( list.length < 2 ) continue;
			for ( let i = 0; i < list.length; i ++ ) for ( let j = i + 1; j < list.length; j ++ ) {

				const a = list[ i ], b = list[ j ];
				if ( ! OPEN.has( a.class ) && ! OPEN.has( b.class ) ) continue;
				this._addEdge( a, b, distance( a, b ) / this.walkSpeed, 'open' );

			}

		}

		// and onto the open space they lie in (the mall's corridors sit
		// inside its area without a vertex in common); a room inside one
		// still needs its door
		for ( const [ , spaces ] of this.spacesByLevel ) for ( const inner of spaces ) {

			if ( ! OPEN.has( inner.class ) ) continue;
			const ring0 = inner.polygons[ 0 ][ 0 ];
			for ( const outer of spaces ) {

				if ( outer === inner || ! OPEN.has( outer.class ) || outer.area <= inner.area ) continue;
				if ( outer.polygons.some( p => pointInPolygon( inner.x, inner.y, p ) || pointInPolygon( ring0[ 0 ], ring0[ 1 ], p ) ) ) this._addEdge( inner, outer, distance( inner, outer ) / this.walkSpeed, 'open' );

			}

		}

		// doors, each onto the rings it sits on
		for ( let index = 0; index < indoorFeatures.length; index ++ ) {

			const feature = indoorFeatures[ index ];
			const properties = feature.properties || {};
			if ( ! DOORS.has( properties.class ) || ! feature.geometry || feature.geometry.type !== 'Point' ) continue;
			const { x, y } = this.toMeters( feature.geometry.coordinates[ 0 ], feature.geometry.coordinates[ 1 ] );
			const ref = feature.id ?? index;
			for ( const level of featureLevels( properties ) ) {

				const node = { id: `door:${ ref }:${ level }`, kind: 'door', x, y, level, name: properties.name ?? null, ref, class: properties.class };
				this._addNode( node );
				this.stats.doors ++;
				// the spaces whose ring it sits on, and the open ones it stands in
				// (a shop's door inside the mall's area opens onto the area)
				const onRing = new Set( vertexIndex.get( level )?.get( vertexKey( x, y ) ) ?? [] );
				for ( const space of this.spacesByLevel.get( level ) ?? [] ) {

					if ( onRing.has( space ) ) continue;
					if ( OPEN.has( space.class ) && space.polygons.some( p => pointInPolygon( x, y, p ) ) ) { onRing.add( space ); continue; }
					for ( const polygon of space.polygons ) for ( const r of polygon ) {

						if ( pointToRing( x, y, r ) <= this.doorSnap ) { onRing.add( space ); break; }

					}

				}

				if ( onRing.size === 0 ) this.stats.doorsOnNoRing ++;
				for ( const space of onRing ) this._addEdge( node, space, distance( node, space ) / this.walkSpeed, 'door' );

			}

		}

		// stairs and lifts
		for ( let index = 0; index < transportFeatures.length; index ++ ) {

			const feature = transportFeatures[ index ];
			const properties = feature.properties || {};
			if ( ! feature.geometry ) continue;
			const ref = feature.id ?? index;
			const levels = featureLevels( properties ).sort( ( a, b ) => a - b );

			if ( properties.subclass === 'steps' && feature.geometry.type === 'LineString' ) {

				if ( levels.length === 0 ) { this.stats.stairsWithoutLevels ++; continue; }
				const line = ring( feature.geometry.coordinates );
				if ( line.length < 4 ) continue;
				this._addStairs( ref, properties, line, levels[ 0 ], levels[ levels.length - 1 ] );

			} else if ( properties.subclass === 'elevator' && feature.geometry.type === 'Point' ) {

				if ( levels.length === 0 ) continue;
				const { x, y } = this.toMeters( feature.geometry.coordinates[ 0 ], feature.geometry.coordinates[ 1 ] );
				this._addLift( ref, properties, x, y, levels );

			}

		}

		this.stats.edges = this.edges.length;
		this.stats.levels = this.spacesByLevel.size;
		this.stats.isolated = this.nodes.filter( n => n.kind === 'space' && ( this.adjacency.get( n.id )?.length ?? 0 ) === 0 ).length;

	}

	// A staircase: its lower end at the lower level, its upper end at the
	// upper one, each tied to the space it stands in, the two tied by the
	// climb. incline=* says which end is which; without it the ends are
	// told apart by the level each one stands in a space on, and failing
	// that the way is taken as drawn upward.
	_addStairs( ref, properties, line, lower, upper ) {

		const first = { x: line[ 0 ], y: line[ 1 ] }, last = { x: line[ line.length - 2 ], y: line[ line.length - 1 ] };
		let length = 0;
		for ( let i = 2; i < line.length; i += 2 ) length += Math.hypot( line[ i ] - line[ i - 2 ], line[ i + 1 ] - line[ i - 1 ] );
		let up = true;
		if ( properties.incline === 'down' ) up = false;
		else if ( properties.incline !== 'up' && lower !== upper ) {

			const drawnUp = this.spaceAt( first.x, first.y, lower ) && this.spaceAt( last.x, last.y, upper );
			const drawnDown = this.spaceAt( first.x, first.y, upper ) && this.spaceAt( last.x, last.y, lower );
			if ( drawnDown && ! drawnUp ) up = false;

		}

		const bottom = up ? first : last, top = up ? last : first;
		const name = properties.name ?? null;
		const escalator = properties.conveying !== undefined && properties.conveying !== 'no';
		const lowerNode = { id: `stair:${ ref }:lower`, kind: 'stair', x: bottom.x, y: bottom.y, level: lower, name, ref, class: escalator ? 'escalator' : 'steps' };
		const upperNode = { id: `stair:${ ref }:upper`, kind: 'stair', x: top.x, y: top.y, level: upper, name, ref, class: escalator ? 'escalator' : 'steps' };
		this._addNode( lowerNode );
		this._addNode( upperNode );
		this.stats.stairs ++;
		for ( const end of [ lowerNode, upperNode ] ) {

			const space = this.spaceAt( end.x, end.y, end.level, 10 );
			if ( space ) this._addEdge( end, space, distance( end, space ) / this.walkSpeed, 'stair' );
			else this.stats.stairEndsInNoSpace ++;

		}

		let cost = length / this.walkSpeed + this.stairCost * ( upper - lower );
		if ( escalator ) cost *= this.escalatorFactor;
		this._addEdge( lowerNode, upperNode, cost, escalator ? 'escalator' : 'stairs' );

	}

	_addLift( ref, properties, x, y, levels ) {

		const name = properties.name ?? null;
		let previous = null;
		this.stats.lifts ++;
		for ( const level of levels ) {

			const node = { id: `lift:${ ref }:${ level }`, kind: 'lift', x, y, level, name, ref, class: 'elevator' };
			this._addNode( node );
			const space = this.spaceAt( x, y, level, 10 );
			if ( space ) this._addEdge( node, space, distance( node, space ) / this.walkSpeed, 'lift' );
			else this.stats.liftsInNoSpace ++;
			if ( previous ) this._addEdge( previous, node, this.liftCost * ( level - previous.level ), 'lift' );
			previous = node;

		}

	}

	_addNode( node ) {

		this.nodes.push( node );
		this.byId.set( node.id, node );
		this.adjacency.set( node.id, [] );

	}

	_addEdge( a, b, cost, kind ) {

		if ( a === b ) return;
		for ( const edge of this.adjacency.get( a.id ) ) if ( edge.to === b.id ) return;
		this.edges.push( { a: a.id, b: b.id, cost, kind } );
		this.adjacency.get( a.id ).push( { to: b.id, cost } );
		this.adjacency.get( b.id ).push( { to: a.id, cost } );

	}

	node( id ) {

		return this.byId.get( id ) ?? null;

	}

	neighbours( id ) {

		return this.adjacency.get( id ) ?? [];

	}

	// The space a point is in on a level, the smallest when they nest (a
	// shop inside the mall's area), else the one whose ring is nearest
	// within snap meters (a stair's end is drawn on the corridor's edge
	// more often than inside it, where ray casting cannot say), else null.
	spaceAt( x, y, level, snap = 0 ) {

		const spaces = this.spacesByLevel.get( level );
		if ( ! spaces ) return null;
		let best = null;
		for ( const space of spaces ) {

			if ( best && space.area >= best.area ) continue;
			for ( const polygon of space.polygons ) if ( pointInPolygon( x, y, polygon ) ) { best = space; break; }

		}

		if ( best || snap <= 0 ) return best;
		let nearest = snap;
		for ( const space of spaces ) {

			for ( const polygon of space.polygons ) for ( const r of polygon ) {

				const d = pointToRing( x, y, r );
				if ( d < nearest || d === nearest && best && space.area < best.area ) { nearest = d; best = space; }

			}

		}

		return best;

	}

	// A space by name, exact first, then case-insensitive contains, on one
	// level when given, else on any (the lowest of the matches first).
	findSpace( name, level ) {

		const wanted = String( name );
		const pool = this.nodes.filter( n => n.kind === 'space' && n.name && ( level === undefined || n.level === level ) );
		const sorted = list => list.sort( ( a, b ) => a.level - b.level );
		const exact = sorted( pool.filter( n => n.name === wanted ) );
		if ( exact.length > 0 ) return exact[ 0 ];
		const lower = wanted.toLowerCase();
		const loose = sorted( pool.filter( n => n.name.toLowerCase().includes( lower ) ) );
		return loose[ 0 ] ?? null;

	}

	// Every node reachable from one, itself included.
	reachableFrom( id ) {

		const seen = new Set();
		if ( ! this.byId.has( id ) ) return seen;
		const stack = [ id ];
		seen.add( id );
		while ( stack.length > 0 ) {

			const current = stack.pop();
			for ( const { to } of this.adjacency.get( current ) ) if ( ! seen.has( to ) ) { seen.add( to ); stack.push( to ); }

		}

		return seen;

	}

	_point( input ) {

		if ( input.x !== undefined && input.y !== undefined ) return { x: input.x, y: input.y, level: input.level ?? 0 };
		const { x, y } = this.toMeters( input.lon, input.lat );
		return { x, y, level: input.level ?? 0 };

	}

	// The quickest way from one point to another, A* over the graph from
	// the space each stands in: null when there is none, else the seconds
	// and the path, the two inputs first and last with the doors, stairs
	// and lifts between, straight lines between consecutive points.
	route( fromInput, toInput ) {

		const from = this._point( fromInput ), to = this._point( toInput );
		const start = this.spaceAt( from.x, from.y, from.level, 15 );
		const goal = this.spaceAt( to.x, to.y, to.level, 15 );
		if ( ! start || ! goal ) return null;

		const walkSpeed = this.walkSpeed;
		const perLevel = Math.min( this.stairCost * this.escalatorFactor, this.liftCost );
		const heuristic = n => Math.hypot( n.x - to.x, n.y - to.y ) / walkSpeed + Math.abs( n.level - to.level ) * perLevel;

		// the goal's neighbours lead straight to the destination
		const finals = new Map();
		finals.set( goal.id, distance( goal, to ) / walkSpeed );
		for ( const { to: id } of this.adjacency.get( goal.id ) ) finals.set( id, distance( this.byId.get( id ), to ) / walkSpeed );

		const START = '\u0000start', END = '\u0000end';
		const g = new Map( [ [ START, 0 ] ] );
		const came = new Map();
		const open = new Heap();
		const closed = new Set();
		open.push( heuristic( from ), START );

		const relax = ( fromId, toId, cost ) => {

			const tentative = g.get( fromId ) + cost;
			if ( tentative < ( g.get( toId ) ?? Infinity ) ) {

				g.set( toId, tentative );
				came.set( toId, fromId );
				const h = toId === END ? 0 : heuristic( this.byId.get( toId ) );
				open.push( tentative + h, toId );

			}

		};

		while ( open.size > 0 ) {

			const [ , current ] = open.pop();
			if ( current === END ) break;
			if ( closed.has( current ) ) continue;
			closed.add( current );

			if ( current === START ) {

				// the same space, or one open onto the other: a straight line
				if ( start === goal || this.adjacency.get( start.id ).some( e => e.to === goal.id ) ) relax( START, END, distance( from, to ) / walkSpeed );
				relax( START, start.id, distance( from, start ) / walkSpeed );
				for ( const { to: id } of this.adjacency.get( start.id ) ) relax( START, id, distance( from, this.byId.get( id ) ) / walkSpeed );
				continue;

			}

			if ( finals.has( current ) ) relax( current, END, finals.get( current ) );
			for ( const { to: id, cost } of this.adjacency.get( current ) ) if ( ! closed.has( id ) ) relax( current, id, cost );

		}

		if ( ! g.has( END ) ) return null;

		const ids = [];
		for ( let id = came.get( END ); id !== START; id = came.get( id ) ) ids.unshift( id );
		const path = [ { x: from.x, y: from.y, level: from.level, kind: 'start', name: start.name } ];
		for ( const id of ids ) {

			const n = this.byId.get( id );
			if ( n.kind === 'space' ) continue;
			path.push( { x: n.x, y: n.y, level: n.level, kind: n.kind, name: n.name, id: n.id } );

		}

		path.push( { x: to.x, y: to.y, level: to.level, kind: 'end', name: goal.name } );
		return { seconds: g.get( END ), path, nodes: ids };

	}

}
