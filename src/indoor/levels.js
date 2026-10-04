// The level=* grammar of Simple Indoor Tagging, parsed the way the two
// renderers that publish their test cases parse it: indoorequal's
// level_to_array (SQL, BSD) and OSM2World's ValueParseUtil.parseLevels
// (Java, MIT). Neither map-gl-indoor nor maplibre-gl-indoor does it right
// (a list of three is dropped there, a range parses as its first number,
// repeat_on is never read), which is why this is written rather than taken.
//
// The grammar, by the wiki's examples: integers, negative ones, a list on
// semicolons ("0;1", "-5;-4"), a range on a hyphen ("0-2", "-4--2",
// "-1-5"), lists of ranges ("1-3;5"), and decimals for mezzanines and the
// odd station ("-3.5;-3", "-0.75" at Chatelet-Les Halles), which the wiki
// leaves unsettled and the data uses. Whitespace is forgiven ("6;5 ; 7").
// A range is expanded one level at a time, in either order ("3-1" is 1, 2,
// 3). A decimal cannot be a range's end. Anything else is dropped, and a
// value with nothing left in it parses to null, so the caller can tell
// "untagged" from "unreadable".
//
// repeat_on lists the other levels a feature has copies on, the tagged one
// excluded: levelsOf gives the union, sorted, without duplicates.

const RANGE = /^(-?\d+)\s*-\s*(-?\d+)$/;
const NUMBER = /^-?\d+(\.\d+)?$/;

export function parseLevels( value ) {

	if ( value === undefined || value === null ) return null;
	const levels = new Set();
	for ( const part of String( value ).split( ';' ) ) {

		const token = part.trim();
		if ( token === '' ) continue;
		const range = RANGE.exec( token );
		if ( range ) {

			const a = parseInt( range[ 1 ], 10 ), b = parseInt( range[ 2 ], 10 );
			const lo = Math.min( a, b ), hi = Math.max( a, b );
			if ( hi - lo > 200 ) continue; // a typo, not a tower
			for ( let l = lo; l <= hi; l ++ ) levels.add( l );

		} else if ( NUMBER.test( token ) ) {

			levels.add( parseFloat( token ) );

		}

	}

	if ( levels.size === 0 ) return null;
	return [ ...levels ].sort( ( p, q ) => p - q );

}

// Every level a feature is on: level, plus repeat_on, plus, failing both,
// the min_level and max_level of a building and the levels of a part.
export function levelsOf( tags ) {

	const own = parseLevels( tags.level );
	const repeats = parseLevels( tags.repeat_on );
	if ( own || repeats ) return [ ...new Set( [ ...( own ?? [] ), ...( repeats ?? [] ) ] ) ].sort( ( p, q ) => p - q );

	if ( tags.min_level !== undefined && tags.max_level !== undefined ) {

		const range = parseLevels( `${ tags.min_level }-${ tags.max_level }` );
		if ( range ) return range;

	}

	return null;

}
