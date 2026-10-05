import { Box3, BufferAttribute, BufferGeometry, DoubleSide, Line3, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// What a character bumps into: one bounds tree (three-mesh-bvh) per
// extrusion block of a built tile, buildings, roofs, indoor floors, walls,
// ramps and shafts alike, in the block's own frame (positions relative to
// the tile centre, which is what the worker ships), the worker's arrays
// kept for it. Two queries: a capsule pushed out of whatever it overlaps,
// the way three-mesh-bvh's characterMovement example does it (the closest
// point of the segment to each overlapping triangle moves away by what is
// left of the radius), and the ground under a point, a ray cast down.

const _capsuleBox = new Box3(), _box = new Box3(), _localBox = new Box3();
const _segStart = new Vector3(), _segEnd = new Vector3(), _negCenter = new Vector3(), _push = new Vector3();
const _triPoint = new Vector3(), _capsulePoint = new Vector3();
const _lineSegment = new Line3();
const _ray = new Ray();

export function buildColliders( built ) {

	const colliders = [];
	for ( const block of built.blocks ) {

		if ( block.type !== 'fill-extrusion' || block.positions.length === 0 ) continue;
		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( block.positions, 3 ) );
		geometry.setIndex( new BufferAttribute( block.indices, 1 ) );
		geometry.computeBoundingBox();
		const bvh = new MeshBVH( geometry );
		colliders.push( { bvh, geometry, bounds: geometry.boundingBox, center: built.center, level: block.level, id: block.id, kind: block.indoor ?? null, base: block.base ?? 0 } );

	}

	return colliders;

}

// Pushes the capsule out of the colliders; the displacement accumulates
// in out (a Vector3, zeroed by the caller), out.onGround set when a push
// pointed mostly up. start and end move with it, so one call resolves
// against every collider in turn.
//
// With feet given (the height of the character's soles), indoor geometry
// is met the way a person meets it, since its heights are guesses (level
// times 3 m; a station with levels -1, -0.75 and -0.5 puts floors 0.75 m
// apart where the real ones are not): a floor or a ramp is stood on and
// never bumped into from below or from its edge, and a wall blocks only on
// its own level, within 1.5 m of the feet.
export function collideCapsule( colliders, start, end, radius, out, feet = null ) {

	_capsuleBox.makeEmpty().expandByPoint( start ).expandByPoint( end ).expandByScalar( radius );
	for ( const { bvh, center, bounds, kind, base } of colliders ) {

		if ( feet !== null && kind === 'wall' && Math.abs( feet - base ) > 1.5 ) continue;
		const oneWay = feet !== null && ( kind === 'floor' || kind === 'steps' );
		_box.copy( bounds ).translate( center );
		if ( ! _box.intersectsBox( _capsuleBox ) ) continue;
		_negCenter.copy( center ).negate();
		_segStart.copy( start ).add( _negCenter );
		_segEnd.copy( end ).add( _negCenter );
		_localBox.copy( _capsuleBox ).translate( _negCenter );
		bvh.shapecast( {
			intersectsBounds: box => box.intersectsBox( _localBox ),
			intersectsTriangle: tri => {

				const distance = tri.closestPointToSegment( _lineSegment.set( _segStart, _segEnd ), _triPoint, _capsulePoint );
				if ( distance < radius ) {

					const depth = radius - distance;
					_push.subVectors( _capsulePoint, _triPoint );
					if ( _push.lengthSq() === 0 ) _push.set( 0, 1, 0 ); else _push.normalize();
					// a one-way surface only holds the character up
					if ( oneWay && _push.y < 0.7 ) return false;
					_push.multiplyScalar( depth );
					_segStart.add( _push );
					_segEnd.add( _push );
					start.add( _push );
					end.add( _push );
					out.add( _push );
					if ( _push.y > 0.5 * depth ) out.onGround = true;

				}

			},
		} );

	}

	return out;

}

// The distance to the first surface along a ray, within maxDistance, or
// null: what a camera behind a character asks before it goes through a
// wall.
export function raycastFirst( colliders, origin, direction, maxDistance = Infinity ) {

	let best = null;
	_ray.direction.copy( direction );
	for ( const { bvh, center, bounds } of colliders ) {

		_box.copy( bounds ).translate( center );
		_ray.origin.copy( origin );
		if ( ! _ray.intersectsBox( _box ) ) continue;
		_ray.origin.sub( center );
		const hit = bvh.raycastFirst( _ray, DoubleSide );
		if ( hit && hit.distance <= maxDistance && ( best === null || hit.distance < best ) ) best = hit.distance;

	}

	return best;

}

// The height of the nearest surface under the point within maxDistance
// down, or null.
export function groundBelow( colliders, point, maxDistance = 100 ) {

	let best = null;
	_ray.direction.set( 0, - 1, 0 );
	for ( const { bvh, center, bounds } of colliders ) {

		_box.copy( bounds ).translate( center );
		if ( point.x < _box.min.x || point.x > _box.max.x || point.z < _box.min.z || point.z > _box.max.z || _box.min.y > point.y ) continue;
		_ray.origin.copy( point ).sub( center );
		const hit = bvh.raycastFirst( _ray, DoubleSide );
		if ( hit && hit.distance <= maxDistance && ( best === null || hit.distance < best ) ) best = hit.distance;

	}

	return best === null ? null : point.y - best;

}
