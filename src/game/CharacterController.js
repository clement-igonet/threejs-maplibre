import { Vector3 } from 'three';

// A character on the map: a capsule moved by an input, held up by the
// map's floors and the street, pushed out of its walls. The map is the
// planar frame, meters, x east, y up, -z north. Two ways to drive it:
// steering (the default), where left and right turn the character and
// forward walks the way it faces, so a camera kept behind it always shows
// where it is going; and free, where the input is a direction in the
// camera's frame and the character turns to walk that way. Steps per frame as in three.js's games_fps:
// several small ones, each collided, so a wall is never crossed in one.
//
// Ground: the map's floors and ramps where there are any under the
// character (the hall, the stairs down to the Métro), the street at 0
// elsewhere. A fall is gravity; a jump is an upward speed.

// where the soles rest, in radii from the centre: the centre and four
// points at the capsule's edge
const _SOLES = [ [ 0, 0 ], [ 0.8, 0 ], [ - 0.8, 0 ], [ 0, 0.8 ], [ 0, - 0.8 ] ];
const _start = new Vector3(), _end = new Vector3(), _push = new Vector3(), _move = new Vector3();

export class CharacterController {

	constructor( map, { radius = 0.35, height = 1.7, walkSpeed = 1.6, runSpeed = 4.5, gravity = 30, jumpSpeed = 7, steps = 5, steering = true, turnSpeed = 2.4, bounds = null, ledge = 1 } = {} ) {

		this.map = map;
		this.radius = radius;
		this.height = height;
		this.walkSpeed = walkSpeed;
		this.runSpeed = runSpeed;
		this.gravity = gravity;
		this.jumpSpeed = jumpSpeed;
		this.steps = steps;
		this.steering = steering;
		this.turnSpeed = turnSpeed; // radians a second at full left or right
		this.stepHeight = 0.5; // the highest kerb or step walked up without a jump
		// the deepest drop walked off without a jump: past it the walk stops
		// at the edge (atLedge), and only a jump goes over. Indoor data has
		// gaps between polygons on the same level, and nothing drawn in them
		// says there is a drop; Infinity to walk off anything
		this.ledge = ledge;
		this.atLedge = false;
		this.fallDepth = 40; // a fall deeper than this below the last floor stood on is into nothing
		this.lastSafe = new Vector3();
		this.home = new Vector3(); // where place() put it: the way out if lastSafe fails too
		this._caught = false; // put back, and not stood since
		this.fell = false;
		// where the character may go, { minX, maxX, minZ, maxZ } in the map's
		// meters: the extent of the data, past which there is empty ground.
		// Its edge is a wall nothing gets over, jumping or not.
		this.bounds = bounds;
		this.atEdge = false;
		this.position = new Vector3(); // the feet
		this.velocity = new Vector3();
		this.heading = 0; // radians, the way the character faces, counterclockwise from +x seen from above
		this.onGround = false;
		this.speed = 0; // horizontal, for the animation

	}

	// Puts the feet at a place, standing.
	place( x, y, z ) {

		this.position.set( x, y, z );
		this.lastSafe.set( x, y, z );
		this.home.set( x, y, z );
		this._caught = false;
		this.velocity.set( 0, 0, 0 );
		return this;

	}

	// input: { forward, right } in -1..1, run, jump. Steering: right turns
	// the character clockwise, forward walks the way it faces, backward at
	// half speed without turning round. Free: { forward, right } in the frame
	// of the camera whose heading is cameraHeading (radians along the
	// ground, counterclockwise from +x).
	update( dt, input, cameraHeading = this.heading ) {

		const speed = input.run ? this.runSpeed : this.walkSpeed;
		let pushing;
		if ( this.steering ) {

			this.heading -= input.right * this.turnSpeed * dt;
			const forward = input.forward < 0 ? input.forward * 0.5 : input.forward;
			_move.set( Math.cos( this.heading ) * forward, 0, - Math.sin( this.heading ) * forward );
			pushing = Math.abs( forward ) > 1e-3;

		} else {

			// the push, turned into the camera's frame
			const fx = Math.cos( cameraHeading ), fz = - Math.sin( cameraHeading );
			const rx = - fz, rz = fx; // right of forward, seen from above with -z north
			_move.set( fx * input.forward + rx * input.right, 0, fz * input.forward + rz * input.right );
			pushing = _move.lengthSq() > 1e-6;
			if ( pushing ) {

				if ( _move.lengthSq() > 1 ) _move.normalize();
				this.heading = Math.atan2( - _move.z, _move.x );

			}

		}

		this.velocity.x = _move.x * speed;
		this.velocity.z = _move.z * speed;
		this.speed = pushing ? Math.hypot( this.velocity.x, this.velocity.z ) : 0;
		this.turning = this.steering && Math.abs( input.right ) > 1e-3;
		if ( input.jump && this.onGround ) this.velocity.y = this.jumpSpeed;

		const step = dt / this.steps;
		this.atEdge = false; // set by any step the edge stops
		this.atLedge = false;
		for ( let i = 0; i < this.steps; i ++ ) this._step( step );
		return this;

	}

	// The ground under the feet: the highest floor, ramp or roof under the
	// knee (what a step reaches, not what is over the head) within
	// maxDistance down, under any of the soles (the centre and the edge of
	// the capsule: a character stands astride a slot between two stairs,
	// or with its centre just past a floor's edge); and the street, at 0,
	// for a character at or above it only, since underground it is a
	// ceiling. null when nothing is there: a void.
	_groundUnder( maxDistance ) {

		const knee = this.position.y + this.stepHeight;
		let ground = null;
		for ( const [ ox, oz ] of _SOLES ) {

			_end.set( this.position.x + ox * this.radius, knee, this.position.z + oz * this.radius );
			const g = this.map.groundBelow( _end, maxDistance );
			if ( g !== null && ( ground === null || g > ground ) ) ground = g;

		}

		if ( knee >= 0 && ( ground === null || ground < 0 ) ) ground = 0;
		return ground;

	}

	_step( dt ) {

		const wasOnGround = this.onGround, x0 = this.position.x, z0 = this.position.z;
		this.velocity.y -= this.gravity * dt;
		this.position.addScaledVector( this.velocity, dt );

		// a walk, not a jump, stops short of a drop deeper than the ledge:
		// the ground under the knee where the step lands, as below, under
		// the whole of the feet rather than their centre (a character stands
		// astride a slot between two stairs, its soles on both)
		if ( wasOnGround && this.velocity.y <= 0 && Number.isFinite( this.ledge ) ) {

			const ground = this._groundUnder( this.stepHeight + this.ledge );
			if ( ground === null || ground < this.position.y - this.ledge ) {

				this.position.x = x0;
				this.position.z = z0;
				this.velocity.x = this.velocity.z = 0;
				this.atLedge = true;

			}

		}

		// the capsule, feet to head, pushed out of the map
		const r = this.radius;
		_start.set( this.position.x, this.position.y + r, this.position.z );
		_end.set( this.position.x, this.position.y + this.height - r, this.position.z );
		this.map.collideCapsule( _start, _end, r, _push, this.position.y );
		this.position.x = _start.x;
		this.position.z = _start.z;
		this.position.y = _start.y - r;
		if ( this.bounds ) {

			const b = this.bounds;
			const x = Math.min( Math.max( this.position.x, b.minX + r ), b.maxX - r );
			const z = Math.min( Math.max( this.position.z, b.minZ + r ), b.maxZ - r );
			if ( x !== this.position.x || z !== this.position.z ) this.atEdge = true;
			if ( x !== this.position.x ) this.velocity.x = 0;
			if ( z !== this.position.z ) this.velocity.z = 0;
			this.position.x = x;
			this.position.z = z;

		}
		let onGround = _push.onGround;
		if ( onGround && this.velocity.y < 0 ) this.velocity.y = 0;

		// the ground, however far down, so a jump off a balcony falls to the
		// floor below. Nothing under at all is a void: the fall goes on, and
		// fallDepth below the last floor stood on, the character is put back
		// there. Only a floor under the feet counts as stood on: touching a
		// wall's edge or a slab's rim on the way down does not.
		const ground = this._groundUnder( 200 );
		let stood = false;
		if ( ground !== null && this.position.y <= ground + 1e-3 && this.velocity.y <= 0 ) {

			this.position.y = ground;
			this.velocity.y = 0;
			onGround = stood = true;

		}

		if ( stood ) {

			this.lastSafe.copy( this.position );
			this._caught = false;

		} else if ( ! onGround && this.position.y < this.lastSafe.y - this.fallDepth ) {

			// a second fall from where it was put back, before standing
			// anywhere: that floor is gone (its tile no longer solid), so
			// back to the start of the walk instead of falling for ever
			if ( this._caught ) this.lastSafe.copy( this.home );
			this._caught = true;
			this.position.copy( this.lastSafe );
			this.velocity.set( 0, 0, 0 );
			this.fell = true; // for whoever wants to say so

		}

		this.onGround = onGround;

	}

}
