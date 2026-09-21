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

Decoded textures reach the GPU through a per-frame time budget
(`uploadBudgetMs`, default 2 ms, at least one upload per frame): the walk
queues the tiles it wants, `renderer.initTexture()` uploads them in order
after the walk, and a tile whose texture is not uploaded yet counts as not
ready, so its ancestor keeps drawing. A burst of arrivals (typical after a
fast zoom, when a whole level lands within a few frames) then costs a few
milliseconds per frame instead of one long frame. Textures for tiles that
leave the selection are parked in an LRU cache (dispose on evict); in-flight
fetches for deselected tiles are aborted.

## Measured against 3d-tiles-renderer

`npm run bench` (or `compose run --rm bench`) drives both engines through the
same four camera poses and a scripted city-to-street fly-in, over the same
offline stub tile source, in headless Chrome. Both engines fetch tiles through
`fetch()` + `createImageBitmap`, so "requests" counts the same thing for both.
Full output is in `bench/results.json`; the table below is from a run on
2026-09-21 with three.js 0.180 and 3d-tiles-renderer 0.5.3, SwiftShader on
2 CPUs of a shared VM (load average 5), 800x500 viewport. Absolute times are for that environment only; the
ratios are what matters.

| pose | metric | native (maxScreenTexel 1.4) | native (maxScreenTexel 1) | 3d-tiles-renderer (errorTarget 1) |
|---|---|---|---|---|
| earth, 20 000 km | requests / draw calls / triangles | 5 / 4 / 2 048 | 5 / 4 / 2 048 | 21 / 16 / 18 432 |
| | time to stable | 0.5 s | 0.5 s | 0.9 s |
| region, 400 km over Paris | requests / draw calls / triangles | 93 / 59 / 30 208 | 121 / 84 / 43 008 | 112 / 57 / 62 016 |
| | time to stable | 3.0 s | 3.9 s | 15.3 s |
| city, 8 km nadir | requests / draw calls / triangles | 43 / 58 / 29 696 | 46 / 74 / 37 888 | 52 / 55 / 59 840 |
| | time to stable | 4.1 s | 2.3 s | 10.0 s |
| street, 1.5 km tilted 60 degrees | requests / draw calls / triangles | 167 / 149 / 76 288 | 268 / 229 / 117 248 | 316 / 238 / 258 944 |
| | time to stable | 9.0 s | 12.9 s | 78.9 s |
| | JS heap | 15 MB | 20 MB | 75 MB |
| fly city to street, 240 frames | requests during fly and settle | 17 | 42 | 24 |
| | mean / p95 frame CPU | 8.7 / 7.1 ms | 4.9 / 7.4 ms | 6.1 / 9.5 ms |
| | settle after fly | 3.8 s | 5.1 s | 5.7 s |

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
- **Frame spikes**: the max frame is not a usable number in this
  environment. Logging every fly-in frame over 16 ms showed most of them with
  nothing happening in the engine (no new mesh, no upload, no request; up to
  540 ms on a frame that only redrew 58 tiles), which is the software
  rasterizer and the shared host, so the table reports the p95 instead. The
  engine-side burst that was visible before (six textures uploaded in one
  frame at 318 ms) is gone: uploads are budgeted per frame, and one 256x256
  upload with mipmaps costs ~100 ms under SwiftShader, well under a
  millisecond on a GPU.

## Precision

Tile meshes anchor their vertices relative to the tile center
(`TilePatchGeometry`), so Float32 vertex precision holds at street-level
zoom; the center itself lives in the mesh transform (Float64 in JS until it
reaches the GPU as a matrix). Patch grids are uniform in Web Mercator space,
so the (Mercator) tile texture maps linearly with no reprojection artifacts.

## Controls

Stock `OrbitControls` around the globe center do not make a map: their rotate
and zoom speeds are an orbit angle and a distance-to-center factor, constant
from 20 000 km down to street level (a 100 px drag moved the ground by
~100 km at 2 km altitude), a horizontal drag rotates about the pole, and the
camera always looks at the center, so there is no tilt. `MapControls` keeps
MapLibre's camera state instead: a ground point at the screen center
(lat, lon), the distance from it to the camera, a heading and a pitch. The
camera is placed from that state each frame, and the gestures edit the state
in ground units:

- one pointer drag pans by `2 * distance * tan(fov / 2) / clientHeight` meters
  per pixel (divided by `cos(pitch)` along the screen's vertical axis);
- a wheel notch scales the distance by 0.95 and keeps the ground under the
  cursor in place; a pinch does the same around the fingers' midpoint while
  their motion pans and their twist turns;
- two fingers sliding vertically together at a steady spread tilt the view
  (0.5 degree per pixel); on desktop, a right drag (or ctrl/shift + drag)
  turns (0.25 degree per pixel) and tilts;
- pitch is clamped to [0, 85] degrees, latitude to +/-85 (the Web Mercator
  edge), and the distance so the camera stays above `minAltitude`;
- `mode: 'planar'` places the same state on the Web Mercator plane, in
  mercator meters like the scene, so both demos share one set of gestures.

Pointer events arrive one finger at a time, so the two-finger intent is
decided once both fingers have moved 8 px (or one finger 30 px with the other
still, which is a pinch with an anchor). `npm run controls-check` drives all
of this in headless Chrome with real multi-touch emulation: x0.950 per notch,
439 m moved for 439 m of pixels on a 100 px drag at 1.9 km, a 1.2x pinch
combined with a 100 px two-finger drag lowers the distance x0.850 and moves
the ground by 337 m for 373 m of pixels at the new scale, a 100 px two-finger
slide tilts by 46 degrees without zooming, a 100 px right drag turns by
25 degrees, and the camera altitude matches `distance * cos(pitch)`; the same
run passes on the planar demo.
No inertia yet; MapLibre-style fling and easing are M3 work with the camera
bridge, together with the exact pan (raycast the pointer onto the ellipsoid
rather than scale by the center's meters per pixel).

## Known limits (accepted for M1)

- Perspective cameras only (SSE uses `camera.fov`).
- Frustum culling only; no horizon culling yet, so the far side of the globe
  costs traversal (not draws) at low altitude.
- Web Mercator polar caps (above ~85.05 degrees) are not filled.
- One raster source per `RasterTileMap`; overlay compositing is out of scope
  until M2.
