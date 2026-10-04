// Exercises the public API as an application would, so that `tsc` says
// whether types/index.d.ts and the sources still agree on the shape of
// things. Never run; only compiled.
import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import {
	AttributionControl, MAPLIBRE_FOV, MAPLIBRE_SPHERE, MapAnchor, MapControls, MapLibreLayer, MapLibreUnderlay,
	RasterTileMap, Style, VectorTileMap, VERSION, WGS84, createFog, createOSMSource, ecefToLatLon, geocentricHeight,
	globeFrame, latLonToEcef, loadOpenFreeMapSource, localFrame, mercatorFrame, rayEllipsoidIntersection, decodeVectorTile,
	buildTile, createTileProjection, LRUTileCache, pointToTile, tileToBounds,
} from 'threejs-maplibre';
import type { Datum, MapLibreCameraState, TileTreeStats } from 'threejs-maplibre';

const version: string = VERSION;
const renderer = new WebGLRenderer();
const camera = new PerspectiveCamera( MAPLIBRE_FOV, 1, 1, 1e8 );
const scene = new Scene();

const raster = new RasterTileMap( createOSMSource(), { mode: 'globe', datum: WGS84, viewDistance: 5000 } );
raster.update( camera, renderer, 16 );
const stats: TileTreeStats = raster.stats;
scene.add( raster );

const controls = new MapControls( camera, renderer.domElement, { mode: 'globe', datum: MAPLIBRE_SPHERE } );
controls.setView( { lat: 48.8606, lon: 2.3376, distance: 900, heading: 20, pitch: 50 } );
controls.maxPitch = 89;
const changed: boolean = controls.update();
const target: Vector3 = controls.getTarget( new Vector3(), new Vector3() );

const anchor = new MapAnchor( { mode: 'globe', datum: MAPLIBRE_SPHERE } ).setLocation( 48.8613, 2.3323, 0, 250 );
scene.add( anchor );

async function vector() {

	const source = await loadOpenFreeMapSource();
	const style = new Style( { version: 8, sources: {}, layers: [] } );
	const map = new VectorTileMap( source, style, { mode: 'planar', sourceId: 'openmaptiles', memoryBudget: 96 * 1048576 } );
	map.update( camera, renderer );
	const built: number = map.stats.built;
	scene.fog = createFog( style, { viewDistance: 800 } );
	const attribution = new AttributionControl( document.body );
	attribution.addSource( source );
	const projection = createTileProjection( 0, 0, 0, 4096, 'globe', MAPLIBRE_SPHERE );
	const out = projection.project( 0, 0, 0, new Float32Array( 3 ) );
	const decoded = decodeVectorTile( new ArrayBuffer( 0 ) );
	const tile = buildTile( decoded, style, { sourceId: 'openmaptiles', x: 0, y: 0, z: 0, mode: 'globe', datum: WGS84 } );
	const triangles: number = tile.stats.triangles;
	return { built, out, triangles };

}

const datum: Datum = MAPLIBRE_SPHERE;
const p = latLonToEcef( 48.8606, 2.3376, 0, new Vector3(), datum );
const height: number = geocentricHeight( p, datum );
const place = ecefToLatLon( p, datum );
const lat: number = place.lat;
const hit = rayEllipsoidIntersection( p, new Vector3( 0, - 1, 0 ), new Vector3(), datum );
if ( hit !== null ) hit.length();
const east = new Vector3(), north = new Vector3(), up = new Vector3();
localFrame( 48.8606, 2.3376, east, north, up );
const tile = pointToTile( 2.3376, 48.8606, 14 );
const bounds = tileToBounds( tile.x, tile.y, tile.z );

const cache = new LRUTileCache<{ bytes: number }>( { capacityBytes: 1024, sizeOf: v => v.bytes } );
cache.set( 'a', { bytes: 10 } );
const taken = cache.take( 'a' );

// the bridge, against the slices of maplibre-gl's Map the types ask for
const layer = new MapLibreLayer( { lng: 2.3359, lat: 48.861, space: 'local', terrain: true } );
layer.scene.add( layer.place( anchor, 2.3359, 48.861, 0, 90 ) );
const frame = mercatorFrame( 2.3359, 48.861 ).multiply( globeFrame( 2.3359, 48.861, 10 ) );
const onGlobe: boolean = layer.onGlobe;
const maplike = { getCanvas: () => document.createElement( 'canvas' ), triggerRepaint() {}, queryTerrainElevation: () => null };
layer.onAdd( maplike, renderer.getContext() );

const underlay = new MapLibreUnderlay( { ...maplike, setMaxPitch() {}, setVerticalFieldOfView() {}, jumpTo() {} }, { mode: 'globe' } );
const synced: boolean = underlay.sync( camera );
const state: MapLibreCameraState | null = MapLibreUnderlay.cameraState( camera, 500 );

export { version, stats, changed, target, vector, height, lat, bounds, taken, frame, onGlobe, synced, state };
