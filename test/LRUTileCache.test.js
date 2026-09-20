import { describe, expect, it, vi } from 'vitest';
import { LRUTileCache } from '../src/core/LRUTileCache.js';

describe( 'LRUTileCache', () => {

	it( 'evicts the least recently used entry with its dispose callback', () => {

		const onEvict = vi.fn();
		const cache = new LRUTileCache( { capacity: 2, onEvict } );
		cache.set( 'a', 1 );
		cache.set( 'b', 2 );
		cache.get( 'a' ); // "a" becomes most recently used
		cache.set( 'c', 3 ); // evicts "b"

		expect( onEvict ).toHaveBeenCalledExactlyOnceWith( 'b', 2 );
		expect( cache.has( 'a' ) ).toBe( true );
		expect( cache.has( 'b' ) ).toBe( false );
		expect( cache.has( 'c' ) ).toBe( true );

	} );

	it( 'updates entries without duplicating them', () => {

		const cache = new LRUTileCache( { capacity: 2 } );
		cache.set( 'a', 1 );
		cache.set( 'a', 10 );
		expect( cache.size ).toBe( 1 );
		expect( cache.get( 'a' ) ).toBe( 10 );

	} );

	it( 'disposes everything on clear', () => {

		const onEvict = vi.fn();
		const cache = new LRUTileCache( { capacity: 8, onEvict } );
		cache.set( 'a', 1 );
		cache.set( 'b', 2 );
		cache.clear();
		expect( onEvict ).toHaveBeenCalledTimes( 2 );
		expect( cache.size ).toBe( 0 );

	} );

} );
