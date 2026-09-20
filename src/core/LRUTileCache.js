// Least-recently-used cache keyed by tile key string. Evicted entries are
// passed to onEvict so their GPU resources can be disposed.

export class LRUTileCache {

	constructor( { capacity = 512, onEvict = null } = {} ) {

		this.capacity = capacity;
		this.onEvict = onEvict;
		this._map = new Map();

	}

	get size() {

		return this._map.size;

	}

	get( key ) {

		const map = this._map;
		if ( ! map.has( key ) ) return undefined;

		// re-insert to mark as most recently used
		const value = map.get( key );
		map.delete( key );
		map.set( key, value );
		return value;

	}

	has( key ) {

		return this._map.has( key );

	}

	set( key, value ) {

		const map = this._map;
		if ( map.has( key ) ) map.delete( key );
		map.set( key, value );

		while ( map.size > this.capacity ) {

			const oldest = map.keys().next().value;
			const evicted = map.get( oldest );
			map.delete( oldest );
			if ( this.onEvict ) this.onEvict( oldest, evicted );

		}

	}

	clear() {

		if ( this.onEvict ) {

			for ( const [ key, value ] of this._map ) this.onEvict( key, value );

		}

		this._map.clear();

	}

}
