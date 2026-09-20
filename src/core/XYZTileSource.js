// A raster XYZ tile source: url template, zoom range, attribution.
// The url template supports {z}, {x}, {y} and {s} (subdomain rotation).
// No default tile host: usage policies (including OSM's) require the
// application to choose a host and display its attribution.

export class XYZTileSource {

	constructor( { url, subdomains = [], minZoom = 0, maxZoom = 19, attribution = '', tileResolution = 256 } = {} ) {

		if ( ! url ) {

			throw new Error( 'XYZTileSource: "url" template is required.' );

		}

		this.url = url;
		this.subdomains = subdomains;
		this.minZoom = minZoom;
		this.maxZoom = maxZoom;
		this.attribution = attribution;
		this.tileResolution = tileResolution;

	}

	tileUrl( x, y, z ) {

		let url = this.url
			.replace( '{z}', z )
			.replace( '{x}', x )
			.replace( '{y}', y );

		if ( url.includes( '{s}' ) ) {

			const subs = this.subdomains;
			const s = subs.length ? subs[ ( x + y ) % subs.length ] : '';
			url = url.replace( '{s}', s );

		}

		return url;

	}

}

// Ready-made source for the OpenStreetMap standard layer. Demos and small
// applications only: heavy use requires your own tile host per
// https://operations.osmfoundation.org/policies/tiles/
export function createOSMSource( options = {} ) {

	return new XYZTileSource( {
		url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
		maxZoom: 19,
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
		...options,
	} );

}
