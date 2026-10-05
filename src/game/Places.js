import { IndoorGraph, pointInPolygon, pointToSegment, ringCentroid } from '../indoor/IndoorGraph.js';

// Where a character is, and what is around it, by name: the station's
// rooms, corridors and areas per level (from the walking graph), the
// named points of interest (shops, cafés, ticket offices, platforms), the
// named streets and squares, the named buildings. All in the graph's
// local ground meters (x east, y north) around its origin; lon and lat in
// and out, so a scene in any frame can use it.
//
//   const places = new Places( layers );
//   places.where( lon, lat, level )   -> { level, space, building, street, indoor }
//   places.nearby( lon, lat, level )  -> [ { text, kind, lon, lat, level, distance } ]

export class Places {

	constructor( layers, { graph = null } = {} ) {

		this.graph = graph ?? IndoorGraph.fromLayers( layers );
		const g = this.graph;

		// labels: named spaces at their centre, named points of interest
		this.labels = [];
		for ( const node of g.nodes ) {

			if ( node.kind === 'space' && node.name ) this.labels.push( { text: node.name, kind: node.class ?? 'space', x: node.x, y: node.y, level: node.level } );

		}

		for ( const f of layers.poi ? layers.poi.features : [] ) {

			const p = f.properties;
			if ( ! p.name || f.geometry.type !== 'Point' ) continue;
			const [ lon, lat ] = f.geometry.coordinates;
			const { x, y } = g.toMeters( lon, lat );
			const level = parseFloat( String( p.levels ?? p.level ?? '0' ).split( ';' )[ 0 ] );
			this.labels.push( { text: p.name, kind: p.shop ? 'shop' : p.amenity ?? p.tourism ?? p.railway ?? 'place', x, y, level: Number.isFinite( level ) ? level : 0 } );

		}

		// the same name twice on a level within 10 m is one label
		const kept = [];
		for ( const label of this.labels ) {

			if ( kept.some( k => k.text === label.text && k.level === label.level && Math.hypot( k.x - label.x, k.y - label.y ) < 10 ) ) continue;
			kept.push( label );

		}

		this.labels = kept;

		// streets and squares: the named ways, as segments
		this.streets = [];
		for ( const f of layers.transportation ? layers.transportation.features : [] ) {

			const p = f.properties;
			if ( ! p.name || p.indoor || p.subclass === 'steps' || p.subclass === 'elevator' ) continue;
			const lines = f.geometry.type === 'LineString' ? [ f.geometry.coordinates ] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : f.geometry.type === 'Polygon' ? f.geometry.coordinates : [];
			for ( const line of lines ) {

				for ( let i = 0; i + 1 < line.length; i ++ ) {

					const a = g.toMeters( line[ i ][ 0 ], line[ i ][ 1 ] ), b = g.toMeters( line[ i + 1 ][ 0 ], line[ i + 1 ][ 1 ] );
					this.streets.push( { name: p.name, ax: a.x, ay: a.y, bx: b.x, by: b.y } );

				}

			}

		}

		// named buildings, for "in Gare Saint-Lazare"
		this.buildings = [];
		for ( const f of layers.building ? layers.building.features : [] ) {

			const p = f.properties;
			if ( ! p.name ) continue;
			const polygons = f.geometry.type === 'Polygon' ? [ f.geometry.coordinates ] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
			for ( const polygon of polygons ) {

				this.buildings.push( { name: p.name, rings: polygon.map( ring => ring.flatMap( ( [ lon, lat ] ) => { const m = g.toMeters( lon, lat ); return [ m.x, m.y ]; } ) ) } );

			}

		}

	}

	// What the place is called: the space the character stands in on its
	// level, the named building around it, and, outdoors, the nearest named
	// street within 25 m.
	where( lon, lat, level ) {

		const { x, y } = this.graph.toMeters( lon, lat );
		const space = this.graph.spaceAt( x, y, level, 1 );
		let building = null;
		for ( const b of this.buildings ) if ( pointInPolygon( x, y, b.rings ) ) { building = b.name; break; }
		let street = null, best = 25;
		if ( ! space ) {

			for ( const s of this.streets ) {

				const d = pointToSegment( x, y, s.ax, s.ay, s.bx, s.by );
				if ( d < best ) { best = d; street = s.name; }

			}

		}

		return { level, space: space ? ( space.name ?? null ) : null, kind: space ? space.class : null, indoor: !! space, building, street };

	}

	// The labels within radius meters on the character's level, nearest
	// first, at most max of them.
	nearby( lon, lat, level, radius = 30, max = 12 ) {

		const { x, y } = this.graph.toMeters( lon, lat );
		const out = [];
		for ( const label of this.labels ) {

			if ( Math.abs( label.level - level ) > 0.5 ) continue;
			const distance = Math.hypot( label.x - x, label.y - y );
			if ( distance > radius ) continue;
			const ll = this.graph.toLonLat( label.x, label.y );
			out.push( { text: label.text, kind: label.kind, lon: ll.lon, lat: ll.lat, level: label.level, distance } );

		}

		out.sort( ( a, b ) => a.distance - b.distance );
		return out.slice( 0, max );

	}

}

export { ringCentroid };
