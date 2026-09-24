import { Vector3 } from 'three';

// Bounding volumes for tile selection.
//
// A tile is a slab on a curved surface, and the camera frustum continues
// underground past the horizon. Two things go wrong with the usual
// axis-aligned box against frustum planes: the box around a large curved
// patch reaches deep into the planet and meets the frustum there, and the
// plane-only test accepts boxes that sit outside the frustum near one of its
// edges. So tiles get a box in their own east/north/up frame, and the view is
// a finite polytope (the frustum cut at the horizon) tested with all
// separating axes, which is exact for two convex shapes.

const _v = new Vector3();
const _min = new Vector3();
const _max = new Vector3();

export class OrientedBox {

	constructor() {

		this.center = new Vector3();
		this.axes = [ new Vector3(), new Vector3(), new Vector3() ];
		this.halfExtents = new Vector3();

	}

	// The tightest box with the given unit axes around the points, grown by
	// "above" along the third axis for content standing on the surface.
	setFromPoints( points, axes, above = 0 ) {

		_min.setScalar( Infinity );
		_max.setScalar( - Infinity );
		for ( const point of points ) {

			_v.set( point.dot( axes[ 0 ] ), point.dot( axes[ 1 ] ), point.dot( axes[ 2 ] ) );
			_min.min( _v );
			_max.max( _v );

		}

		_max.z += above;

		for ( let i = 0; i < 3; i ++ ) this.axes[ i ].copy( axes[ i ] );
		_v.addVectors( _min, _max ).multiplyScalar( 0.5 );
		this.center.set( 0, 0, 0 )
			.addScaledVector( this.axes[ 0 ], _v.x )
			.addScaledVector( this.axes[ 1 ], _v.y )
			.addScaledVector( this.axes[ 2 ], _v.z );
		this.halfExtents.subVectors( _max, _min ).multiplyScalar( 0.5 );
		return this;

	}

	// the box's extent along a direction: [ center - reach, center + reach ]
	reach( direction ) {

		const { axes, halfExtents } = this;
		return Math.abs( direction.dot( axes[ 0 ] ) ) * halfExtents.x
			+ Math.abs( direction.dot( axes[ 1 ] ) ) * halfExtents.y
			+ Math.abs( direction.dot( axes[ 2 ] ) ) * halfExtents.z;

	}

	distanceToPoint( point ) {

		const { center, axes, halfExtents } = this;
		_v.subVectors( point, center );
		const dx = Math.max( 0, Math.abs( _v.dot( axes[ 0 ] ) ) - halfExtents.x );
		const dy = Math.max( 0, Math.abs( _v.dot( axes[ 1 ] ) ) - halfExtents.y );
		const dz = Math.max( 0, Math.abs( _v.dot( axes[ 2 ] ) ) - halfExtents.z );
		return Math.sqrt( dx * dx + dy * dy + dz * dz );

	}

}

const _axis = new Vector3();
const _corner = new Vector3();

// The camera frustum as a convex polytope with a chosen far distance.
export class ViewVolume {

	constructor() {

		this.corners = Array.from( { length: 8 }, () => new Vector3() ); // near 0-3, far 4-7
		this.normals = Array.from( { length: 5 }, () => new Vector3() ); // forward, then the four sides
		this.edges = Array.from( { length: 6 }, () => new Vector3() ); // right, up, four corner rays

	}

	// camera: a PerspectiveCamera with its matrices up to date; far: meters
	// along the view direction; worldToLocal: the space to express it in
	setFromCamera( camera, far, worldToLocal ) {

		const { corners, normals, edges } = this;
		const eye = _v.setFromMatrixPosition( camera.matrixWorld );
		const near = camera.near;

		// the near corners through the inverse projection, the far ones along
		// the same rays
		let i = 0;
		for ( const [ x, y ] of [ [ - 1, - 1 ], [ 1, - 1 ], [ 1, 1 ], [ - 1, 1 ] ] ) {

			_corner.set( x, y, - 1 ).applyMatrix4( camera.projectionMatrixInverse ).applyMatrix4( camera.matrixWorld );
			corners[ i + 4 ].copy( _corner ).sub( eye ).multiplyScalar( far / near ).add( eye ).applyMatrix4( worldToLocal );
			corners[ i ].copy( _corner ).applyMatrix4( worldToLocal );
			i ++;

		}

		eye.applyMatrix4( worldToLocal );
		for ( let j = 0; j < 4; j ++ ) edges[ 2 + j ].subVectors( corners[ 4 + j ], eye ).normalize();
		edges[ 0 ].subVectors( corners[ 1 ], corners[ 0 ] ).normalize(); // right
		edges[ 1 ].subVectors( corners[ 3 ], corners[ 0 ] ).normalize(); // up
		normals[ 0 ].crossVectors( edges[ 1 ], edges[ 0 ] ).normalize(); // forward
		for ( let j = 0; j < 4; j ++ ) normals[ 1 + j ].crossVectors( edges[ 2 + j ], edges[ 2 + ( j + 1 ) % 4 ] ).normalize();

		return this;

	}

	_separated( axis, box ) {

		const c = box.center.dot( axis );
		const r = box.reach( axis );
		let min = Infinity, max = - Infinity;
		for ( const corner of this.corners ) {

			const d = corner.dot( axis );
			if ( d < min ) min = d;
			if ( d > max ) max = d;

		}

		return max < c - r || min > c + r;

	}

	// separating axis test: the faces of both shapes and every edge pair
	intersectsBox( box ) {

		for ( const normal of this.normals ) if ( this._separated( normal, box ) ) return false;
		for ( const axis of box.axes ) if ( this._separated( axis, box ) ) return false;
		for ( const edge of this.edges ) {

			for ( const axis of box.axes ) {

				_axis.crossVectors( edge, axis );
				if ( _axis.lengthSq() < 1e-12 ) continue; // parallel: covered by the face tests
				if ( this._separated( _axis, box ) ) return false;

			}

		}

		return true;

	}

}
