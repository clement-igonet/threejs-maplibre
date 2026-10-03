// Type declarations for threejs-maplibre, written by hand against the
// sources and checked by `npm run types-check`: types/check.ts exercises
// every export below, and test/types.test.js makes sure nothing exported
// from src/index.js is missing here.

import type { BufferGeometry, Camera, Fog, Group, Matrix4, Object3D, PerspectiveCamera, Scene, ShaderMaterial, Texture, Vector3, WebGLRenderer } from 'three';

export const VERSION: string;

// --- math/WebMercator ------------------------------------------------------

export const EARTH_RADIUS: number;
export const MAX_LATITUDE: number;
export function clampLatitude( lat: number ): number;
export function longitudeToNormalized( lon: number ): number;
export function latitudeToNormalized( lat: number ): number;
export function normalizedToLongitude( nx: number ): number;
export function normalizedToLatitude( ny: number ): number;
export function pointToTile( lon: number, lat: number, z: number ): { x: number; y: number; z: number };
export function tileToBounds( x: number, y: number, z: number ): { west: number; south: number; east: number; north: number };
export function texelSizeMeters( z: number, latDeg: number, tileResolution?: number ): number;
export function normalizedToMeters( nx: number, ny: number ): [ number, number ];
export function metersToNormalized( mx: number, my: number ): [ number, number ];

// --- math/Ellipsoid --------------------------------------------------------

/** The shape of the earth: semi-major and polar radii in meters. A plain object, so it crosses postMessage. */
export interface Datum {
	readonly radius: number;
	readonly polarRadius: number;
}

export const WGS84_RADIUS: number;
export const WGS84_RADIUS_POLAR: number;
/** The ellipsoid of GPS and of 3D Tiles; the default everywhere. */
export const WGS84: Datum;
/** The sphere maplibre-gl draws its globe on (6 371 008.8 m, geodetic latitude taken as spherical). */
export const MAPLIBRE_SPHERE: Datum;

export interface XYZ { x: number; y: number; z: number }
export interface LatLonHeight { lat: number; lon: number; height: number }

/** Geodetic to world space (+Y through the pole, +X through lat 0 lon 0). */
export function latLonToEcef<T extends XYZ>( lat: number, lon: number, height: number, target: T, datum?: Datum ): T;
/** Height above the datum along the ray from the centre: geocentric, a few meters off the geodetic height at mid latitudes. */
export function geocentricHeight( point: XYZ, datum?: Datum ): number;
/** First hit of a ray on the datum's surface, or null when it misses. */
export function rayEllipsoidIntersection<T extends XYZ>( origin: XYZ, direction: XYZ, target: T, datum?: Datum ): T | null;
/** The place under a world-space point: exact on a sphere, iterated on an ellipsoid. */
export function ecefToLatLon<T extends LatLonHeight>( point: XYZ, datum?: Datum, target?: T ): T;
/** East, north and up unit vectors at a place, the same on every datum. */
export function localFrame( lat: number, lon: number, east: Vector3, north: Vector3, up: Vector3 ): void;

// --- sources ---------------------------------------------------------------

export interface XYZTileSourceOptions {
	url: string;
	subdomains?: string[];
	minZoom?: number;
	maxZoom?: number;
	attribution?: string;
	tileResolution?: number;
}

export class XYZTileSource {
	constructor( options: XYZTileSourceOptions );
	url: string;
	subdomains: string[];
	minZoom: number;
	maxZoom: number;
	attribution: string;
	tileResolution: number;
	tileUrl( x: number, y: number, z: number ): string;
}

export function createOSMSource( options?: Partial<XYZTileSourceOptions> ): XYZTileSource;

export interface VectorTileSourceOptions extends XYZTileSourceOptions {
	/** Tile coordinate extent, 4096 for Mapbox Vector Tiles. */
	extent?: number;
}

export class VectorTileSource extends XYZTileSource {
	constructor( options: VectorTileSourceOptions );
	readonly type: 'vector';
	extent: number;
	static fromTileJSON( json: Record<string, unknown>, options?: Partial<VectorTileSourceOptions> ): VectorTileSource;
}

export const OPENFREEMAP_TILEJSON_URL: string;
export function loadOpenFreeMapSource( options?: Partial<VectorTileSourceOptions> ): Promise<VectorTileSource>;

// --- loaders and cache -----------------------------------------------------

export class ImageTileLoader {
	constructor();
	readonly pendingCount: number;
	load( key: string, url: string ): Promise<Texture>;
	abort( key: string ): void;
	abortAll(): void;
}

export interface LRUTileCacheOptions<V> {
	capacity?: number;
	capacityBytes?: number;
	sizeOf?: ( ( value: V ) => number ) | null;
	onEvict?: ( ( key: string, value: V ) => void ) | null;
}

export class LRUTileCache<V = unknown> {
	constructor( options?: LRUTileCacheOptions<V> );
	capacity: number;
	capacityBytes: number;
	readonly size: number;
	readonly bytes: number;
	get( key: string ): V | undefined;
	has( key: string ): boolean;
	set( key: string, value: V ): void;
	/** Drops the oldest entry, disposed; false when empty. */
	evict(): boolean;
	/** Takes an entry back without disposing it. */
	take( key: string ): V | undefined;
	clear(): void;
}

/** A decoded layer of a vector tile: flat arrays per feature, geometry as ring offsets into one coordinate array. */
export interface DecodedLayer {
	extent: number;
	count: number;
	types: Uint8Array;
	ids: Float64Array;
	properties: Record<string, unknown>[];
	[ key: string ]: unknown;
}

export interface DecodedTile {
	layers: Record<string, DecodedLayer>;
}

export function decodeVectorTile( buffer: ArrayBuffer ): DecodedTile;
/** The rings of one feature of a decoded layer, each a flat [ x0, y0, x1, y1, ... ] in tile coordinates. */
export function featureRings( layer: DecodedLayer, f: number ): ArrayLike<number>[];

export interface BuiltBlock {
	index: number;
	type: 'fill' | 'line' | 'fill-extrusion';
	features: number;
	vertices: number;
	triangles: number;
	[ key: string ]: unknown;
}

export interface BuiltTile {
	blocks: BuiltBlock[];
	stats: { features: number; vertices: number; triangles: number; buildMs: number };
	center: XYZ | null;
	/** Set by VectorTileMap once the tile lands: what the blocks weigh. */
	bytes?: number;
}

export interface BuildTileOptions {
	sourceId: string;
	x: number;
	y: number;
	z: number;
	mode?: 'globe' | 'planar';
	datum?: Datum;
}

export function buildTile( tile: DecodedTile, style: Style, options: BuildTileOptions ): BuiltTile;
export function builtTileTransferables( built: BuiltTile ): ArrayBuffer[];

export interface TileProjection {
	mode: 'globe' | 'planar';
	center: XYZ;
	project( px: number, py: number, height: number, out: ArrayLike<number> & { [ i: number ]: number }, o?: number ): typeof out;
	up( px: number, py: number, out: ArrayLike<number> & { [ i: number ]: number }, o?: number ): typeof out;
}

export function createTileProjection( x: number, y: number, z: number, extent: number, mode: 'globe' | 'planar', datum?: Datum ): TileProjection;

export interface VectorTileLoaderOptions {
	workers?: number;
	createWorker?: () => Worker;
}

export class VectorTileLoader {
	constructor( options?: VectorTileLoaderOptions );
	readonly pendingCount: number;
	configure( options: { style: Style | Record<string, unknown>; sourceId: string; mode?: 'globe' | 'planar'; datum?: Datum } ): void;
	load( key: string, url: string, tile?: { x: number; y: number; z: number } | null ): Promise<BuiltTile | DecodedTile>;
	abort( key: string ): void;
	abortAll(): void;
	dispose(): void;
}

// --- style -----------------------------------------------------------------

export const HONOURED_PROPERTIES: Record<string, string[]>;

export class StyleLayer {
	constructor( json: Record<string, unknown>, warnings?: string[] );
	id: string;
	type: string;
	source: string | null;
	sourceLayer: string | null;
	minzoom: number;
	maxzoom: number;
	metadata: unknown;
	json: Record<string, unknown>;
	patterned: boolean;
	visible: boolean;
	ignored: string[];
	matches( zoom: number, feature: unknown ): boolean;
	get( name: string, zoom: number, feature?: unknown ): unknown;
	kind( name: string ): string;
	has( name: string ): boolean;
}

export class Style {
	constructor( json: Record<string, unknown> );
	name: string;
	json: Record<string, unknown>;
	warnings: string[];
	sources: Record<string, unknown>;
	sprite: string | null;
	glyphs: string | null;
	layers: StyleLayer[];
	layersForSource( sourceId: string, sourceLayer?: string | null ): StyleLayer[];
	readonly sky: Record<string, unknown> | null;
	readonly backgroundLayer: StyleLayer | null;
}

// --- the maps --------------------------------------------------------------

export interface TileTreeOptions {
	mode?: 'globe' | 'planar';
	/** The globe's shape; MAPLIBRE_SPHERE under a MapLibre globe. */
	datum?: Datum;
	maxScreenTexel?: number;
	fadeDuration?: number;
	retainMs?: number;
	cacheSize?: number;
	cacheBytes?: number;
	memoryBudget?: number;
	maxLoading?: number;
	uploadBudgetMs?: number;
	backfillLevels?: number;
	contentHeight?: number;
	viewDistance?: number;
}

export interface TileTreeStats {
	selected: number;
	rendered: number;
	loading: number;
	culled: number;
	created: number;
	uploaded: number;
	uploadMs: number;
	residentBytes: number;
	refused: number;
}

export class TileTree extends Group {
	constructor( source: XYZTileSource, options?: TileTreeOptions );
	source: XYZTileSource;
	mode: 'globe' | 'planar';
	datum: Datum;
	maxScreenTexel: number;
	fadeDuration: number;
	retainMs: number;
	memoryBudget: number;
	maxLoading: number;
	uploadBudgetMs: number;
	backfillLevels: number;
	contentHeight: number;
	viewDistance: number;
	stats: TileTreeStats;
	update( camera: PerspectiveCamera, renderer: WebGLRenderer, deltaMs?: number ): void;
	dispose(): void;
}

export interface RasterTileMapOptions extends TileTreeOptions {
	globeSegments?: number;
}

export class RasterTileMap extends TileTree {
	constructor( source: XYZTileSource, options?: RasterTileMapOptions );
	globeSegments: number;
}

export interface VectorTileMapOptions extends TileTreeOptions {
	sourceId?: string | null;
	workers?: number;
	createWorker?: () => Worker;
}

export interface VectorTileMapStats extends TileTreeStats {
	built: number;
	buildMs: number;
	batchBytes: number;
	geometryBytes: number;
}

export class VectorTileMap extends TileTree {
	constructor( source: VectorTileSource, style: Style, options?: VectorTileMapOptions );
	style: Style;
	sourceId: string;
	/** Map zoom derived from the camera, for camera-kind style properties. */
	zoom: number;
	stats: VectorTileMapStats;
}

export class VectorLineMaterial extends ShaderMaterial {
	constructor();
	readonly color: unknown;
	opacity: number;
}

export interface PatchResult {
	geometry: BufferGeometry;
	center: Vector3;
}

export function createGlobePatch( x: number, y: number, z: number, segments?: number, datum?: Datum ): PatchResult;
export function createPlanarPatch( x: number, y: number, z: number, segments?: number ): PatchResult;

export function createFog( style: Style, options: { viewDistance: number; start?: number; color?: unknown } ): Fog;

export class AttributionControl {
	constructor( container: HTMLElement );
	addSource( source: XYZTileSource ): void;
	removeSource( source: XYZTileSource ): void;
	dispose(): void;
}

// --- camera and anchors ----------------------------------------------------

/** MapLibre's default vertical field of view, in degrees (2 * atan( 1 / 3 )). */
export const MAPLIBRE_FOV: number;

export interface MapView {
	lat?: number;
	lon?: number;
	/** From the ground point at the screen centre to the camera, in meters (Web Mercator meters in planar mode). */
	distance?: number;
	/** Degrees clockwise from north. */
	heading?: number;
	/** Degrees from straight down. */
	pitch?: number;
}

export class MapControls {
	constructor( camera: PerspectiveCamera, domElement?: HTMLElement | null, options?: { mode?: 'globe' | 'planar'; datum?: Datum } );
	camera: PerspectiveCamera;
	domElement: HTMLElement | null;
	mode: 'globe' | 'planar';
	datum: Datum;
	enabled: boolean;
	lat: number;
	lon: number;
	distance: number;
	heading: number;
	pitch: number;
	minAltitude: number;
	maxDistance: number;
	maxPitch: number;
	zoomFraction: number;
	rotateDegPerPixel: number;
	pitchDegPerPixel: number;
	setView( view: MapView ): void;
	metersPerPixel(): number;
	panByPixels( dx: number, dy: number ): void;
	moveByMeters( right: number, up: number ): void;
	zoomBy( factor: number, px?: number, py?: number ): void;
	rotateBy( headingDeg: number, pitchDeg: number ): void;
	getTarget( target: Vector3, up?: Vector3 | null ): Vector3;
	/** Places the camera from the state; true when the view changed. */
	update(): boolean;
	dispose(): void;
}

/** A Group standing at a place: children in meters, x east, y up, -z north. */
export class MapAnchor extends Group {
	constructor( options?: { mode?: 'globe' | 'planar'; datum?: Datum } );
	mode: 'globe' | 'planar';
	datum: Datum;
	lat: number;
	lon: number;
	height: number;
	heading: number;
	setLocation( lat: number, lon: number, height?: number, heading?: number ): this;
}

// --- the bridge ------------------------------------------------------------

export const MAPLIBRE_EARTH_RADIUS: number;
export function mercatorX( lng: number ): number;
export function mercatorY( lat: number ): number;
export function mercatorUnitsPerMeter( lat: number ): number;
/** Local meters at a place to MapLibre's mercator 0..1 space. */
export function mercatorFrame( lng: number, lat: number, altitude?: number, target?: Matrix4 ): Matrix4;
/** Local meters at a place to MapLibre's unit-sphere globe space. */
export function globeFrame( lng: number, lat: number, altitude?: number, target?: Matrix4 ): Matrix4;

/** What maplibre-gl hands a custom layer's render(): the parts the bridge reads. */
export interface MapLibreProjectionData {
	mainMatrix: ArrayLike<number>;
	fallbackMatrix: ArrayLike<number>;
	projectionTransition?: number;
}

/** The slice of maplibre-gl's Map the bridge calls; a real maplibregl.Map satisfies it. */
export interface MapLibreMapLike {
	getCanvas(): HTMLCanvasElement;
	triggerRepaint(): void;
	queryTerrainElevation( lngLat: [ number, number ] | { lng: number; lat: number } ): number | null;
}

export interface MapLibreLayerOptions {
	id?: string;
	scene?: Scene;
	lng?: number;
	lat?: number;
	altitude?: number;
	/** 'local': meters around the anchor. 'world': MapLibre's own units, mercator 0..1 or the unit sphere. */
	space?: 'local' | 'world';
	terrain?: boolean;
}

/** A three.js scene inside a maplibre-gl map, as a custom layer with the map's camera (CustomLayerInterface). */
export class MapLibreLayer {
	constructor( options?: MapLibreLayerOptions );
	readonly id: string;
	readonly type: 'custom';
	readonly renderingMode: '3d';
	scene: Scene;
	camera: PerspectiveCamera;
	map: MapLibreMapLike | null;
	renderer: WebGLRenderer | null;
	space: 'local' | 'world';
	terrain: boolean;
	elevation: number;
	lastProjection: { matrix: Matrix4; transition: number };
	readonly onGlobe: boolean;
	readonly anchor: { lng: number; lat: number; altitude: number };
	setAnchor( lng: number, lat: number, altitude?: number ): this;
	onAdd( map: MapLibreMapLike, gl: WebGLRenderingContext | WebGL2RenderingContext ): void;
	onRemove(): void;
	render( gl: WebGLRenderingContext | WebGL2RenderingContext, args: { defaultProjectionData: MapLibreProjectionData } ): void;
	terrainElevation( lng: number, lat: number ): number;
	projectionFor( data: MapLibreProjectionData, target: Matrix4 ): Matrix4;
	localFromLngLat( lng: number, lat: number, altitude?: number, target?: Vector3 ): Vector3;
	lngLatFromLocal( local: Vector3 ): { lng: number; lat: number; altitude: number };
	project( local: Vector3, target?: { x: number; y: number } ): { x: number; y: number };
	worldPosition( lng: number, lat: number, altitude?: number, target?: Vector3 ): Vector3;
	place<T extends Object3D>( object: T, lng: number, lat: number, altitude?: number, heading?: number ): T;
	unplace<T extends Object3D>( object: T ): T;
}

/** MapLibre's camera as the underlay sets it from a three.js camera. */
export interface MapLibreCameraState {
	lng: number;
	lat: number;
	zoom: number;
	bearing: number;
	pitch: number;
	roll: number;
	fov: number;
}

/** The slice of maplibre-gl's Map the underlay drives; a real maplibregl.Map satisfies it. */
export interface MapLibreUnderlayMapLike {
	getCanvas(): HTMLCanvasElement;
	setMaxPitch( pitch: number ): unknown;
	setVerticalFieldOfView( fov: number ): unknown;
	jumpTo( options: { center: [ number, number ]; zoom: number; bearing: number; pitch: number; roll: number } ): unknown;
}

/** A maplibre-gl map drawn under a three.js scene, its camera derived from the scene's every frame. */
export class MapLibreUnderlay {
	constructor( map: MapLibreUnderlayMapLike, options?: { mode?: 'globe' | 'planar'; datum?: Datum } );
	map: MapLibreUnderlayMapLike;
	mode: 'globe' | 'planar';
	datum: Datum;
	/** MapLibre's camera for a three.js camera and a viewport height in pixels; null when the view misses the ground. */
	static cameraState( camera: Camera, height: number, target?: Partial<MapLibreCameraState>, mode?: 'globe' | 'planar', datum?: Datum ): MapLibreCameraState | null;
	/** Puts the map's camera where the scene's is; false when it could not. */
	sync( camera: Camera ): boolean;
}
