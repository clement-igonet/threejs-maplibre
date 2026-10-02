// Least-recently-used cache keyed by tile key string. Evicted entries are
// passed to onEvict so their GPU resources can be disposed.
//
// Bounded two ways: a number of entries, and a number of bytes when sizeOf
// says what an entry weighs. A map's tiles are not the same size (a city
// tile of vector geometry is a hundred times a tile of sea), so a count
// alone is no bound on memory, which is what the bytes are for.

export class LRUTileCache {

	constructor( { capacity = 512, capacityBytes = Infinity, sizeOf = null, onEvict = null } = {} ) {

		this.capacity = capacity;
		this.capacityBytes = capacityBytes;
		this.sizeOf = sizeOf;
		this.onEvict = onEvict;
		this._map = new Map();
		this._sizes = new Map(); // key -> bytes, as sizeOf said when the entry came in
		this._bytes = 0;

	}

	get size() {

		return this._map.size;

	}

	get bytes() {

		return this._bytes;

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
		if ( map.has( key ) ) this._drop( key );
		map.set( key, value );
		const bytes = this.sizeOf ? this.sizeOf( value ) : 0;
		this._sizes.set( key, bytes );
		this._bytes += bytes;

		while ( map.size > this.capacity || ( this._bytes > this.capacityBytes && map.size > 1 ) ) {

			const oldest = map.keys().next().value;
			const evicted = map.get( oldest );
			this._drop( oldest );
			if ( this.onEvict ) this.onEvict( oldest, evicted );

		}

	}

	// Lets the oldest entry go, disposed. For a caller that needs the memory
	// back now rather than at the next set().
	evict() {

		const map = this._map;
		if ( map.size === 0 ) return false;
		const oldest = map.keys().next().value;
		const evicted = map.get( oldest );
		this._drop( oldest );
		if ( this.onEvict ) this.onEvict( oldest, evicted );
		return true;

	}

	// Takes an entry back without disposing it: for content a tile wants
	// again while it is parked.
	take( key ) {

		const value = this.get( key );
		if ( value !== undefined ) this._drop( key );
		return value;

	}

	clear() {

		if ( this.onEvict ) {

			for ( const [ key, value ] of this._map ) this.onEvict( key, value );

		}

		this._map.clear();
		this._sizes.clear();
		this._bytes = 0;

	}

	_drop( key ) {

		this._map.delete( key );
		this._bytes -= this._sizes.get( key ) ?? 0;
		this._sizes.delete( key );

	}

}
