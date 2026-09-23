import { derefLayers, featureFilter, normalizePropertyExpression, v8 as spec } from '@maplibre/maplibre-gl-style-spec';

// A MapLibre style document, reduced to what this engine renders. Filters and
// property expressions are compiled by the reference implementation
// (@maplibre/maplibre-gl-style-spec), so zoom functions, data-driven
// expressions and legacy stops evaluate exactly as in MapLibre. Layer types
// and properties outside the honoured subset (docs/style-subset.md) are kept
// on the layer as-is and listed in style.warnings, one line per layer.

// Property names read by the builders, per layer type. A missing property
// evaluates to the spec's default.
export const HONOURED_PROPERTIES = {
	background: {
		paint: [ 'background-color', 'background-opacity' ],
		layout: [ 'visibility' ],
	},
	fill: {
		paint: [ 'fill-color', 'fill-opacity', 'fill-outline-color' ],
		layout: [ 'visibility' ],
	},
	line: {
		paint: [ 'line-color', 'line-width', 'line-opacity', 'line-gap-width', 'line-offset' ],
		layout: [ 'line-cap', 'line-join', 'line-miter-limit', 'visibility' ],
	},
	'fill-extrusion': {
		paint: [ 'fill-extrusion-color', 'fill-extrusion-opacity', 'fill-extrusion-height', 'fill-extrusion-base' ],
		layout: [ 'visibility' ],
	},
	// symbol layers are parsed and kept (filter, minzoom, maxzoom, layout,
	// paint) but not evaluated: the label strategy is decided later in M2
	symbol: { paint: [], layout: [ 'visibility' ] },
};

export class StyleLayer {

	constructor( json, warnings = [] ) {

		this.id = json.id;
		this.type = json.type;
		this.source = json.source ?? null;
		this.sourceLayer = json[ 'source-layer' ] ?? null;
		this.minzoom = json.minzoom ?? 0;
		this.maxzoom = json.maxzoom ?? 24;
		this.metadata = json.metadata ?? null;
		this.json = json;

		const honoured = HONOURED_PROPERTIES[ this.type ];
		if ( ! honoured ) {

			warnings.push( `layer "${ this.id }": type "${ this.type }" is not rendered` );

		} else if ( this.type === 'symbol' ) {

			warnings.push( `layer "${ this.id }": symbol layers are parsed, not rendered yet` );

		}

		this._filter = json.filter === undefined ? null : featureFilter( json.filter ).filter;
		this._properties = new Map();
		this.visible = ( json.layout && json.layout.visibility ) !== 'none';

		const ignored = [];
		for ( const [ group, values ] of [ [ 'paint', json.paint ], [ 'layout', json.layout ] ] ) {

			if ( ! values ) continue;
			const table = spec[ `${ group }_${ this.type }` ] || {};
			const known = honoured ? honoured[ group ] : [];
			for ( const name in values ) {

				if ( name === 'visibility' ) continue;
				if ( ! known.includes( name ) || ! table[ name ] ) {

					ignored.push( name );
					continue;

				}

				this._properties.set( name, normalizePropertyExpression( values[ name ], table[ name ] ) );

			}

		}

		if ( ignored.length && honoured && this.type !== 'symbol' ) {

			warnings.push( `layer "${ this.id }": ignored ${ ignored.join( ', ' ) }` );

		}

		this.ignored = ignored;

	}

	// Whether a feature at the given zoom is drawn by this layer. The feature
	// is { type: 1 | 2 | 3, properties, id }, as decoded from the tile.
	matches( zoom, feature ) {

		if ( ! this.visible || zoom < this.minzoom || zoom >= this.maxzoom ) return false;
		return this._filter === null || this._filter( { zoom }, feature );

	}

	// Evaluates a paint or layout property; colors come back as style-spec
	// Color objects (premultiplied r, g, b, a in 0..1; .rgb for the plain
	// components).
	get( name, zoom, feature = null ) {

		const expression = this._properties.get( name );
		if ( expression ) return expression.evaluate( { zoom }, feature );

		const table = spec[ `paint_${ this.type }` ]?.[ name ] || spec[ `layout_${ this.type }` ]?.[ name ];
		return table ? table.default : undefined;

	}

	// 'constant', 'camera' (zoom only), 'source' (feature only) or
	// 'composite' (both): tells the builders what can be baked per vertex and
	// what must be a per-frame uniform.
	kind( name ) {

		const expression = this._properties.get( name );
		return expression ? expression.kind : 'constant';

	}

	has( name ) {

		return this._properties.has( name );

	}

}

export class Style {

	constructor( json ) {

		if ( ! json || json.version !== 8 ) {

			throw new Error( 'Style: a MapLibre style with "version": 8 is required.' );

		}

		this.name = json.name ?? '';
		this.json = json;
		this.warnings = [];
		this.sources = {};
		this.sprite = json.sprite ?? null;
		this.glyphs = json.glyphs ?? null;

		for ( const id in json.sources || {} ) {

			const source = json.sources[ id ];
			if ( source.type !== 'vector' ) {

				this.warnings.push( `source "${ id }": type "${ source.type }" is not supported` );
				continue;

			}

			this.sources[ id ] = {
				id,
				type: 'vector',
				url: source.url ?? null,
				tiles: source.tiles ?? null,
				minzoom: source.minzoom,
				maxzoom: source.maxzoom,
				attribution: source.attribution,
			};

		}

		this.layers = derefLayers( json.layers || [] ).map( layer => new StyleLayer( layer, this.warnings ) );

	}

	static async load( url ) {

		const response = await fetch( url );
		if ( ! response.ok ) {

			throw new Error( `Style.load: HTTP ${ response.status } for ${ url }` );

		}

		return new Style( await response.json() );

	}

	// Rendered layers reading a source, in style order, optionally narrowed
	// to one source layer of the tiles.
	layersForSource( sourceId, sourceLayer = null ) {

		return this.layers.filter( layer =>
			layer.source === sourceId &&
			HONOURED_PROPERTIES[ layer.type ] !== undefined &&
			( sourceLayer === null || layer.sourceLayer === sourceLayer )
		);

	}

	get backgroundLayer() {

		return this.layers.find( layer => layer.type === 'background' ) ?? null;

	}

}
