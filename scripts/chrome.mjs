// Where Chrome is, for the scripts that drive one.
//
// The puppeteer container image ships a Chrome, and `npm install` inside it
// brings a puppeteer that may expect a different build of it, so the default
// lookup fails with "Could not find Chrome (ver. ...)". Whatever is in the
// cache is the one to use: it is the browser the image was built around.
// PUPPETEER_EXECUTABLE_PATH still wins, and outside a container, where the
// cache holds exactly what puppeteer downloaded, this changes nothing.
import { existsSync, readdirSync } from 'fs';

// Per platform, where a downloaded Chrome sits inside its version folder.
const BINARIES = [
	'chrome-linux64/chrome',
	'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
	'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
	'chrome-win64/chrome.exe',
];

export function chromeExecutablePath() {

	if ( process.env.PUPPETEER_EXECUTABLE_PATH ) return process.env.PUPPETEER_EXECUTABLE_PATH;

	const cache = process.env.PUPPETEER_CACHE_DIR || `${ process.env.HOME }/.cache/puppeteer`;
	const installs = `${ cache }/chrome`;
	if ( ! existsSync( installs ) ) return undefined; // let puppeteer look where it wants

	// newest version first, so a cache with several is not a lottery
	for ( const version of readdirSync( installs ).sort().reverse() ) {

		for ( const binary of BINARIES ) {

			const path = `${ installs }/${ version }/${ binary }`;
			if ( existsSync( path ) ) return path;

		}

	}

	return undefined;

}
