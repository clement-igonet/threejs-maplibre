import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { latLonToEcef } from '../math/Ellipsoid.js';
import { normalizedToLatitude, normalizedToLongitude, normalizedToMeters } from '../math/WebMercator.js';

// Tile patch geometries. Vertices are laid out on a grid that is uniform in
// Web Mercator space so the (also Mercator) tile texture maps linearly onto
// the patch with no reprojection. Positions are relative to the returned
// center so Float32 vertex precision holds at street-level zoom
// ("relative-to-center anchoring"); the mesh is positioned at the center.

const _pos = new Vector3();

function buildGrid( x, y, z, segments, project ) {

	const n = 1 << z;
	const verts = ( segments + 1 ) * ( segments + 1 );
	const positions = new Float32Array( verts * 3 );
	const uvs = new Float32Array( verts * 2 );
	const indices = [];

	// tile center in world space becomes the mesh origin
	const center = project( ( x + 0.5 ) / n, ( y + 0.5 ) / n, new Vector3() );

	let v = 0;
	for ( let iy = 0; iy <= segments; iy ++ ) {

		for ( let ix = 0; ix <= segments; ix ++, v ++ ) {

			const fx = ix / segments;
			const fy = iy / segments;
			project( ( x + fx ) / n, ( y + fy ) / n, _pos ).sub( center );
			positions[ v * 3 + 0 ] = _pos.x;
			positions[ v * 3 + 1 ] = _pos.y;
			positions[ v * 3 + 2 ] = _pos.z;
			uvs[ v * 2 + 0 ] = fx;
			uvs[ v * 2 + 1 ] = 1 - fy;

		}

	}

	for ( let iy = 0; iy < segments; iy ++ ) {

		for ( let ix = 0; ix < segments; ix ++ ) {

			const a = iy * ( segments + 1 ) + ix;
			const b = a + 1;
			const c = a + segments + 1;
			const d = c + 1;
			indices.push( a, c, b, b, c, d );

		}

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new BufferAttribute( uvs, 2 ) );
	geometry.setIndex( indices );
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	return { geometry, center };

}

function projectGlobe( nx, ny, target ) {

	return latLonToEcef( normalizedToLatitude( ny ), normalizedToLongitude( nx ), 0, target );

}

function projectPlanar( nx, ny, target ) {

	const [ mx, my ] = normalizedToMeters( nx, ny );
	// ground plane is XZ: x east, z south (north toward -z)
	return target.set( mx, 0, - my );

}

export function createGlobePatch( x, y, z, segments = 16 ) {

	return buildGrid( x, y, z, segments, projectGlobe );

}

export function createPlanarPatch( x, y, z, segments = 1 ) {

	return buildGrid( x, y, z, segments, projectPlanar );

}
