// Someone walking a route: where they are after so many seconds, which
// level they are on, and which way they face. The route is the path
// IndoorGraph.route gives, points in meters with a level each; a point
// on another level than the one before is a climb, taken at the stair's
// own pace (its cost in seconds rather than its length), so the walker
// slows on the stairs and keeps walking speed on the flat.

export class RouteWalker {

	constructor( route, { walkSpeed = 1.4 } = {} ) {

		this.path = route.path;
		this.walkSpeed = walkSpeed;
		// seconds at each point: flat legs at walking speed, climbs by the
		// route's own timing, spread over the climbs in proportion to length
		const legs = [];
		let flat = 0, climbLength = 0;
		for ( let i = 1; i < this.path.length; i ++ ) {

			const a = this.path[ i - 1 ], b = this.path[ i ];
			const length = Math.hypot( b.x - a.x, b.y - a.y );
			const climb = a.level !== b.level;
			legs.push( { length, climb } );
			if ( climb ) climbLength += length; else flat += length;

		}

		const climbSeconds = Math.max( 0, route.seconds - flat / walkSpeed );
		this.times = [ 0 ];
		for ( const leg of legs ) {

			const seconds = leg.climb ? ( climbLength > 0 ? climbSeconds * leg.length / climbLength : climbSeconds / legs.filter( l => l.climb ).length ) : leg.length / walkSpeed;
			this.times.push( this.times[ this.times.length - 1 ] + seconds );

		}

		this.seconds = this.times[ this.times.length - 1 ];

	}

	// Position, level and heading (radians, counterclockwise from east) at
	// a time; past the end, the end.
	at( seconds, target = { x: 0, y: 0, level: 0, heading: 0, done: false } ) {

		const path = this.path, times = this.times;
		if ( path.length === 1 || seconds >= this.seconds ) {

			const end = path[ path.length - 1 ], before = path[ Math.max( 0, path.length - 2 ) ];
			target.x = end.x; target.y = end.y; target.level = end.level;
			target.heading = Math.atan2( end.y - before.y, end.x - before.x );
			target.done = true;
			return target;

		}

		let i = 1;
		while ( times[ i ] <= seconds && i < times.length - 1 ) i ++;
		const a = path[ i - 1 ], b = path[ i ];
		const span = times[ i ] - times[ i - 1 ];
		const k = span > 0 ? Math.max( 0, Math.min( 1, ( seconds - times[ i - 1 ] ) / span ) ) : 1;
		target.x = a.x + ( b.x - a.x ) * k;
		target.y = a.y + ( b.y - a.y ) * k;
		target.level = a.level + ( b.level - a.level ) * k;
		target.heading = Math.atan2( b.y - a.y, b.x - a.x );
		target.done = false;
		return target;

	}

}
