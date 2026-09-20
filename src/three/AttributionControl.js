// Small DOM overlay showing the tile sources' attributions, in the corner
// style map users expect. Required by most tile usage policies, including
// OpenStreetMap's.

export class AttributionControl {

	constructor( container ) {

		const element = document.createElement( 'div' );
		element.style.cssText = [
			'position:absolute', 'right:0', 'bottom:0', 'z-index:10',
			'padding:2px 6px', 'font:11px/1.4 sans-serif',
			'background:rgba(255,255,255,0.75)', 'color:#333',
			'border-top-left-radius:4px', 'pointer-events:auto',
		].join( ';' );
		container.appendChild( element );

		this.element = element;
		this._sources = new Set();

	}

	addSource( source ) {

		if ( source.attribution ) this._sources.add( source );
		this._update();

	}

	removeSource( source ) {

		this._sources.delete( source );
		this._update();

	}

	_update() {

		this.element.innerHTML = [ ...this._sources ].map( s => s.attribution ).join( ' | ' );
		this.element.style.display = this._sources.size ? '' : 'none';

	}

	dispose() {

		this.element.remove();
		this._sources.clear();

	}

}
