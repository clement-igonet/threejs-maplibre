# M1 design notes

## Why a native tile engine and not 3d-tiles-renderer's generated surface

[3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS)'s
`GeneratedSurfacePlugin` + `XYZTilesOverlay` (the former `XYZTilesPlugin`)
already put XYZ raster tiles on a globe, and this project reuses that library
where it fits (the three.js example submitted upstream in M1 is built on it).
The native engine exists because the goals diverge:

- **3D Tiles is the wrong intermediate model for a map engine.** The plugin
  adapts XYZ pyramids into a 3D Tiles tileset, inheriting its traversal,
  error semantics and content pipeline. Issues like
  [#1636](https://github.com/NASA-AMMOS/3DTilesRendererJS/issues/1636)
  (overlay splitting stalling on the geometric-error impedance mismatch)
  come exactly from that adaptation layer. A raster map needs one thing:
  screen-space texel error over a quadtree, which is ~200 lines here
  (`RasterTileMap`) instead of a tileset emulation.
- **M2-M4 build on this tree.** Vector tiles, MapLibre styling, buildings and
  indoor need direct control of the tile tree (per-layer geometry builders,
  style-driven rebuilds, worker pipelines). A 3D Tiles facade would have to
  be unwound for each of those.
- **The MapLibre bridge needs MapLibre semantics.** Zoom levels, mercator
  tile addressing and style sources map one-to-one here, which keeps the M3
  two-way bridge honest.

What is deliberately reused instead of rebuilt: gkjohnson's globe controls
work (the upstream example uses `GlobeControls`), and the ellipsoid math
conventions (+Y pole, lat/lon frames) so scenes are interoperable between the
two libraries.

## How LOD works

`RasterTileMap.update()` runs two walks per frame:

1. **Selection**: from the root tiles, a tile splits while one of its texels
   projects to more than `maxScreenTexel` pixels (default 1.4), computed from
   the tile's latitude-corrected ground texel size and its bounding-box
   distance to the camera; capped at the source's `maxZoom`. Frustum culling
   prunes whole subtrees.
2. **Replace refinement**: a selected tile draws once its texture is loaded
   and fully faded in; until all children of an inner node cover their area,
   the nearest ready ancestor keeps drawing beneath them (`polygonOffset` and
   `renderOrder` resolve the coplanar overlap), so refinement never opens
   holes.

Textures for tiles that leave the selection are parked in an LRU cache
(dispose on evict); in-flight fetches for deselected tiles are aborted.

## Measured against 3d-tiles-renderer

`npm run bench` (or `compose run --rm bench`) drives both engines through the
same four camera poses and a scripted city-to-street fly-in, over the same
offline stub tile source, in headless Chrome. Both engines fetch tiles through
`fetch()` + `createImageBitmap`, so "requests" counts the same thing for both.
Full output is in `bench/results.json`; the table below is from a run on
2026-09-20 with three.js 0.180 and 3d-tiles-renderer 0.5.3, SwiftShader on
2 CPUs, 800x500 viewport. Absolute times are for that environment only; the
ratios are what matters.

| pose | metric | native (maxScreenTexel 1.4) | native (maxScreenTexel 1) | 3d-tiles-renderer (errorTarget 1) |
|---|---|---|---|---|
| earth, 20 000 km | requests / draw calls / triangles | 5 / 4 / 2 048 | 5 / 4 / 2 048 | 21 / 16 / 18 432 |
| | time to stable | 0.4 s | 0.4 s | 1.0 s |
| region, 400 km over Paris | requests / draw calls / triangles | 93 / 59 / 30 208 | 121 / 84 / 43 008 | 112 / 57 / 62 016 |
| | time to stable | 2.4 s | 3.7 s | 18.2 s |
| city, 8 km nadir | requests / draw calls / triangles | 43 / 58 / 29 696 | 46 / 74 / 37 888 | 52 / 55 / 59 840 |
| | time to stable | 2.2 s | 3.1 s | 9.6 s |
| street, 1.5 km tilted 60 degrees | requests / draw calls / triangles | 167 / 149 / 76 288 | 268 / 229 / 117 248 | 316 / 238 / 258 944 |
| | time to stable | 6.3 s | 14.3 s | 80.2 s |
| | JS heap | 14 MB | 19 MB | 64 MB |
| fly city to street, 240 frames | requests during fly and settle | 17 | 42 | 24 |
| | mean / max frame CPU | 3.4 / 84 ms | 5.9 / 221 ms | 3.5 / 141 ms |
| | settle after fly | 3.9 s | 4.5 s | 5.6 s |

Reading it:

- **Draw counts are comparable once converged** (street: 149 vs 238 draws,
  with the plugin's `errorTarget 1` sitting between the two native settings),
  and the plugin's per-frame CPU is as good as the native engine's. Rendering
  is not where the two differ.
- **The load path is.** On a direct jump to the street pose the plugin
  enqueues 449 tiles for parsing at once (every ancestor within the frustum
  out to the horizon; the generated surface has no download step, so the
  whole tree lands in the 5-wide parse queue and drains at a few tiles per
  second while each parse waits on its overlay texture), and it takes 80 s to
  settle where the native quadtree requests 167 tiles and settles in 6 s. The
  same difference shows at region scale (18 s vs 2.4 s). Arriving at the pose
  progressively (the fly-in) hides it, which is why it is easy to miss in an
  interactive demo.
- **Triangles**: the plugin's surface meshes are denser (30x15 vertex
  minimum per tile) than the 16x16 patches here, hence 2 to 3x the triangles
  for a similar draw count.
- **Memory**: the native engine's heap stays 3 to 4x smaller at street level.
- **Native follow-up**: the native max frame CPU (84 to 221 ms) is most
  likely the burst of patch-geometry building when many tiles arrive in one
  frame (to be profiled in M1's fade polish task, which should spread mesh
  creation across frames).

## Precision

Tile meshes anchor their vertices relative to the tile center
(`TilePatchGeometry`), so Float32 vertex precision holds at street-level
zoom; the center itself lives in the mesh transform (Float64 in JS until it
reaches the GPU as a matrix). Patch grids are uniform in Web Mercator space,
so the (Mercator) tile texture maps linearly with no reprojection artifacts.

## Globe controls

The globe demo uses stock `OrbitControls` around the globe center, whose
rotate and zoom speeds are an orbit angle and a distance-to-center factor:
constant from 20 000 km down to street level, where a 100 px drag moved the
ground by ~100 km and one wheel notch by 16 km of altitude. `globeOrbitSpeeds`
rescales both every frame from the camera's height above the ellipsoid so a
drag moves the ground by what the pointer covered at nadir and a wheel notch
or pinch changes the altitude by 5% (`npm run controls-check` measures both
in headless Chrome: x0.951 per notch, 262 m moved for 297 m expected at 2 km).
Remaining OrbitControls behaviour: a horizontal drag rotates about the pole,
so it moves cos(latitude) of the pointer distance and the map stays north-up;
proper globe controls (drag the ground under the pointer, heading, tilt) are
M3 work alongside the MapLibre camera bridge.

## Known limits (accepted for M1)

- Perspective cameras only (SSE uses `camera.fov`).
- Frustum culling only; no horizon culling yet, so the far side of the globe
  costs traversal (not draws) at low altitude.
- Web Mercator polar caps (above ~85.05 degrees) are not filled.
- One raster source per `RasterTileMap`; overlay compositing is out of scope
  until M2.
