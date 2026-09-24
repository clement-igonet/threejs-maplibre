import { latLonToEcef } from '../math/Ellipsoid.js';
import { normalizedToLatitude, normalizedToLongitude, normalizedToMeters } from '../math/WebMercator.js';

const DEG2RAD = Math.PI / 180;
const _p = { x: 0, y: 0, z: 0 };

// Maps tile coordinates (0..extent, y down, possibly outside the tile) to the
// engine's local space, relative to the tile center so Float32 attributes hold
// street-level precision: the tile object is placed at "center". Both modes
// share the same interface so the builders never branch on the mode:
//
//   project( px, py, height, out, o )   writes x, y, z at out[ o .. o + 2 ]
//   up( px, py, out, o )                unit vector away from the ground there
//
// planar: x east, z south, y up, meters (Web Mercator, no scale correction)
// globe:  ECEF with +Y through the pole, height along the geodetic normal

export function createTileProjection( x, y, z, extent, mode ) {

	const n = 1 << z;
	const scaleX = 1 / ( n * extent );
	const scaleY = 1 / ( n * extent );
	const originX = x / n;
	const originY = y / n;
	const center = { x: 0, y: 0, z: 0 };

	if ( mode === 'planar' ) {

		const [ cx, cy ] = normalizedToMeters( ( x + 0.5 ) / n, ( y + 0.5 ) / n );
		center.x = cx;
		center.z = - cy;

		return {
			mode, center,
			project( px, py, height, out, o = 0 ) {

				const [ mx, my ] = normalizedToMeters( originX + px * scaleX, originY + py * scaleY );
				out[ o ] = mx - cx;
				out[ o + 1 ] = height;
				out[ o + 2 ] = - ( my - cy );
				return out;

			},
			up( px, py, out, o = 0 ) {

				out[ o ] = 0;
				out[ o + 1 ] = 1;
				out[ o + 2 ] = 0;
				return out;

			},
		};

	}

	latLonToEcef( normalizedToLatitude( ( y + 0.5 ) / n ), normalizedToLongitude( ( x + 0.5 ) / n ), 0, center );

	return {
		mode, center,
		project( px, py, height, out, o = 0 ) {

			const lat = normalizedToLatitude( originY + py * scaleY );
			const lon = normalizedToLongitude( originX + px * scaleX );
			latLonToEcef( lat, lon, height, _p );
			out[ o ] = _p.x - center.x;
			out[ o + 1 ] = _p.y - center.y;
			out[ o + 2 ] = _p.z - center.z;
			return out;

		},
		up( px, py, out, o = 0 ) {

			const phi = normalizedToLatitude( originY + py * scaleY ) * DEG2RAD;
			const lambda = normalizedToLongitude( originX + px * scaleX ) * DEG2RAD;
			const cosPhi = Math.cos( phi );
			// geodetic normal, in the swizzled frame of latLonToEcef
			out[ o ] = cosPhi * Math.cos( lambda );
			out[ o + 1 ] = Math.sin( phi );
			out[ o + 2 ] = - cosPhi * Math.sin( lambda );
			return out;

		},
	};

}
