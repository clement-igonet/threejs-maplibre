// Entry of the standalone build (build/threejs-maplibre.js): the library plus
// the copy of three it was built with, for pages that load nothing else.
//
//   <script src="threejs-maplibre.js"></script>
//   const { THREE, VectorTileMap } = threejsMaplibre;
export * from './index.js';
export * as THREE from 'three';
