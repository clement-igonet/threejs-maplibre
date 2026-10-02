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

	it( 'evicts by bytes when told what an entry weighs, oldest first', () => {

		const onEvict = vi.fn();
		const cache = new LRUTileCache( { capacity: 100, capacityBytes: 100, sizeOf: v => v.bytes, onEvict } );
		cache.set( 'a', { bytes: 40 } );
		cache.set( 'b', { bytes: 40 } );
		expect( cache.bytes ).toBe( 80 );
		cache.set( 'c', { bytes: 40 } ); // 120 > 100: a goes
		expect( onEvict ).toHaveBeenCalledExactlyOnceWith( 'a', { bytes: 40 } );
		expect( cache.bytes ).toBe( 80 );
		expect( cache.size ).toBe( 2 );

		// one entry heavier than the whole budget still fits alone, and
		// empties the rest; it is the tile in view, not a thing to refuse
		cache.set( 'big', { bytes: 500 } );
		expect( cache.size ).toBe( 1 );
		expect( cache.bytes ).toBe( 500 );
		expect( cache.has( 'big' ) ).toBe( true );

		// an entry taken back is not disposed, and stops counting
		expect( cache.take( 'big' ) ).toEqual( { bytes: 500 } );
		expect( cache.bytes ).toBe( 0 );
		expect( onEvict ).toHaveBeenCalledTimes( 3 ); // a, then b and c for big

	} );

	it( 'disposes everything on clear', () => {

		const onEvict = vi.fn();
		const cache = new LRUTileCache( { capacity: 8, onEvict } );
		cache.set( 'a', 1 );
		cache.set( 'b', 2 );
		cache.clear();
		expect( onEvict ).toHaveBeenCalledTimes( 2 );
		expect( cache.size ).toBe( 0 );
		expect( cache.bytes ).toBe( 0 );

	} );

} );
