// Keyboard, gamepad and touch as one input: forward and right in -1..1,
// run, jump, and a turn for the camera. WASD or the arrows, shift held or
// R toggled to run, space to jump, Q and E to turn; a gamepad's left stick to move, right
// stick to turn, A (0) to jump, the left trigger or bumper to run;
// on a touch screen, a joystick drawn on the screen (joystick()): the
// thumb on its knob, pushed up to walk, sideways to turn, out to the rim to
// run; a mouse drags the camera round.
// navigator.getGamepads() is polled each frame, as the Gamepad API wants.

export class Input {

	constructor( target = window ) {

		this.keys = new Set();
		this.forward = 0;
		this.right = 0;
		this.run = false;
		this.jump = false;
		this.turn = 0; // -1..1, the camera's heading change per second as a fraction of turnSpeed
		this.look = 0; // -1..1, pitch
		this.gamepad = null;
		this.touch = false; // a touch screen has been used
		this.turnPixels = 0; // dragged since the last poll, for the camera
		this.lookPixels = 0;
		this._stick = null; // { id, x0, y0, x, y }
		this.runAt = 0.8; // past this fraction of the joystick's radius, a run
		this._look = null; // { id, x, y }
		this._pressed = { run: false, jump: false }; // on-screen buttons
		this.runToggle = false; // R: run without holding shift
		this._onDown = e => {

			if ( ! e.repeat ) {

				this.keys.add( e.code );
				if ( e.code === 'KeyR' ) this.runToggle = ! this.runToggle;

			}

			if ( WATCHED.has( e.code ) ) e.preventDefault();

		};
		this._onUp = e => this.keys.delete( e.code );
		this._onBlur = () => this.keys.clear();
		target.addEventListener( 'keydown', this._onDown );
		target.addEventListener( 'keyup', this._onUp );
		target.addEventListener( 'blur', this._onBlur );
		this.target = target;

	}

	// Takes an element's mouse drags to turn and tilt the camera. A touch on
	// it does nothing: on a phone the joystick is the one control, so a thumb
	// that misses it cannot turn the view by surprise.
	attach( element ) {

		element.style.touchAction = 'none';
		const down = e => {

			if ( e.pointerType === 'touch' ) { this.touch = true; return; }
			if ( this._look ) return;
			this._look = { id: e.pointerId, x: e.clientX, y: e.clientY };
			element.setPointerCapture( e.pointerId );

		};
		const move = e => {

			if ( ! this._look || e.pointerId !== this._look.id ) return;
			this.turnPixels += e.clientX - this._look.x;
			this.lookPixels += e.clientY - this._look.y;
			this._look.x = e.clientX;
			this._look.y = e.clientY;

		};
		const up = e => { if ( this._look && e.pointerId === this._look.id ) this._look = null; };
		element.addEventListener( 'pointerdown', down );
		element.addEventListener( 'pointermove', move );
		element.addEventListener( 'pointerup', up );
		element.addEventListener( 'pointercancel', up );
		this._detach = () => { element.removeEventListener( 'pointerdown', down ); element.removeEventListener( 'pointermove', move ); element.removeEventListener( 'pointerup', up ); element.removeEventListener( 'pointercancel', up ); };
		return this;

	}

	// A joystick drawn on the screen: base is a round element, knob a
	// smaller one inside it that follows the thumb, label (optional) says
	// walk or run. The push is measured from the base's centre against its
	// radius; up walks, sideways turns, out past runAt runs.
	joystick( base, knob, label = null ) {

		base.style.touchAction = 'none';
		const centre = () => { const r = base.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, radius: r.width / 2 }; };
		const show = () => {

			const s = this._stick;
			let dx = 0, dy = 0, run = false;
			if ( s ) {

				dx = s.x - s.x0; dy = s.y - s.y0;
				const len = Math.hypot( dx, dy );
				if ( len > s.radius ) { dx *= s.radius / len; dy *= s.radius / len; }
				run = len >= this.runAt * s.radius;

			}

			knob.style.transform = `translate( ${ dx }px, ${ dy }px )`;
			base.classList.toggle( 'active', !! s );
			base.classList.toggle( 'run', run );
			if ( label ) label.textContent = s ? ( run ? 'run' : 'walk' ) : 'walk';

		};
		base.addEventListener( 'pointerdown', e => {

			e.preventDefault();
			if ( e.pointerType === 'touch' ) this.touch = true;
			const c = centre();
			this._stick = { id: e.pointerId, x0: c.x, y0: c.y, x: e.clientX, y: e.clientY, radius: c.radius };
			base.setPointerCapture( e.pointerId );
			show();

		} );
		base.addEventListener( 'pointermove', e => {

			if ( ! this._stick || e.pointerId !== this._stick.id ) return;
			this._stick.x = e.clientX;
			this._stick.y = e.clientY;
			show();

		} );
		const release = e => { if ( this._stick && e.pointerId === this._stick.id ) { this._stick = null; show(); } };
		base.addEventListener( 'pointerup', release );
		base.addEventListener( 'pointercancel', release );
		show();
		return this;

	}

	// An on-screen button: held while the pointer is down on the element.
	button( element, name ) {

		const set = v => () => { this._pressed[ name ] = v; };
		element.addEventListener( 'pointerdown', e => { e.preventDefault(); set( true )(); } );
		element.addEventListener( 'pointerup', set( false ) );
		element.addEventListener( 'pointercancel', set( false ) );
		element.addEventListener( 'pointerleave', set( false ) );
		return this;

	}

	// Reads the keys down, the stick and the first gamepad into the fields.
	poll() {

		const k = this.keys;
		this.forward = ( k.has( 'KeyW' ) || k.has( 'ArrowUp' ) ? 1 : 0 ) - ( k.has( 'KeyS' ) || k.has( 'ArrowDown' ) ? 1 : 0 );
		this.right = ( k.has( 'KeyD' ) || k.has( 'ArrowRight' ) ? 1 : 0 ) - ( k.has( 'KeyA' ) || k.has( 'ArrowLeft' ) ? 1 : 0 );
		this.turn = ( k.has( 'KeyE' ) ? 1 : 0 ) - ( k.has( 'KeyQ' ) ? 1 : 0 );
		this.look = 0;
		this.run = k.has( 'ShiftLeft' ) || k.has( 'ShiftRight' ) || this.runToggle || this._pressed.run;
		this.jump = k.has( 'Space' ) || this._pressed.jump;

		if ( this._stick ) {

			const r = this._stick.radius;
			const dx = ( this._stick.x - this._stick.x0 ) / r, dy = ( this._stick.y - this._stick.y0 ) / r;
			const len = Math.hypot( dx, dy );
			const scale = len > 1 ? 1 / len : 1;
			// a little dead zone round the centre, so a resting thumb stands
			const live = len < 0.12 ? 0 : 1;
			this.right = dx * scale * live;
			this.forward = - dy * scale * live;
			if ( len >= this.runAt ) this.run = true;

		}

		const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
		this.gamepad = null;
		for ( const pad of pads ) {

			if ( ! pad ) continue;
			this.gamepad = pad.id;
			const dead = v => Math.abs( v ) < 0.15 ? 0 : v;
			const lx = dead( pad.axes[ 0 ] ?? 0 ), ly = dead( pad.axes[ 1 ] ?? 0 ), rx = dead( pad.axes[ 2 ] ?? 0 ), ry = dead( pad.axes[ 3 ] ?? 0 );
			if ( lx || ly ) { this.right = lx; this.forward = - ly; }
			if ( rx ) this.turn = rx;
			if ( ry ) this.look = - ry;
			if ( pad.buttons[ 0 ]?.pressed ) this.jump = true;
			if ( pad.buttons[ 4 ]?.pressed || pad.buttons[ 6 ]?.pressed ) this.run = true;
			break;

		}

		return this;

	}

	dispose() {

		if ( this._detach ) this._detach();
		this.target.removeEventListener( 'keydown', this._onDown );
		this.target.removeEventListener( 'keyup', this._onUp );
		this.target.removeEventListener( 'blur', this._onBlur );

	}

}

const WATCHED = new Set( [ 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyQ', 'KeyE' ] );
