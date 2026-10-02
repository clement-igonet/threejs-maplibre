// Kept in step with package.json (test/version.test.js).
export const VERSION = '0.1.0';

export * from './math/WebMercator.js';
export * from './math/Ellipsoid.js';
export { XYZTileSource, createOSMSource } from './core/XYZTileSource.js';
export { LRUTileCache } from './core/LRUTileCache.js';
export { ImageTileLoader } from './core/ImageTileLoader.js';
export { RasterTileMap } from './three/RasterTileMap.js';
export { AttributionControl } from './three/AttributionControl.js';
export { createGlobePatch, createPlanarPatch } from './three/TilePatchGeometry.js';
export { MapControls, MAPLIBRE_FOV } from './three/MapControls.js';
export { createFog } from './three/createFog.js';
export { MapAnchor } from './three/MapAnchor.js';
export { VectorTileSource, loadOpenFreeMapSource, OPENFREEMAP_TILEJSON_URL } from './core/VectorTileSource.js';
export { VectorTileLoader } from './core/VectorTileLoader.js';
export { decodeVectorTile, featureRings } from './core/decodeVectorTile.js';
export { Style, StyleLayer, HONOURED_PROPERTIES } from './style/Style.js';
export { TileTree } from './three/TileTree.js';
export { VectorTileMap } from './three/VectorTileMap.js';
export { VectorLineMaterial } from './three/VectorLineMaterial.js';
export { buildTile, builtTileTransferables } from './build/buildTile.js';
export { createTileProjection } from './build/TileProjection.js';
// the bridge: this library's scenes inside a maplibre-gl map
export { MapLibreLayer } from './bridge/MapLibreLayer.js';
export { MapLibreUnderlay } from './bridge/MapLibreUnderlay.js';
export { MAPLIBRE_EARTH_RADIUS, globeFrame, mercatorFrame, mercatorUnitsPerMeter, mercatorX, mercatorY } from './bridge/MapLibreFrames.js';
