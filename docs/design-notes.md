# Design notes

## M1 Tile foundations

### Why a native tile engine and not 3d-tiles-renderer's generated surface

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

### How LOD works

`TileTree.update()` (shared by the raster and vector maps) runs two walks
per frame:

1. **Selection**: from the root tiles, a tile splits while one of its texels
   projects to more than `maxScreenTexel` pixels (1.4 for raster, 2 for
   vector, where there is no texel to blur and 2 matches the zoom MapLibre
   fetches a tile at), computed from the tile's latitude-corrected ground
   texel size and its bounding-box distance to the camera; capped at the
   source's `maxZoom`. Culling prunes whole subtrees.
2. **Replace refinement**: a selected tile draws once its content is loaded
   and fully faded in; until all children of an inner node cover their area,
   the nearest ready ancestor keeps drawing beneath them (`polygonOffset` and
   `renderOrder` resolve the coplanar overlap), so refinement never opens
   holes. Ancestors are requested for that only within `backfillLevels`
   (default 4) of the leaves: at street level the z0..z10 chain covers
   nothing visible and was a third of the requests.

Culling on a globe needs more than a box against frustum planes
(`TileBounds.js`). The frustum continues underground past the horizon, an
axis-aligned box around a large curved tile reaches deep into the planet and
meets it there, and a plane-only test accepts boxes that sit past a frustum
edge. So a tile gets an oriented box in its own east/north/up frame, grown
by `contentHeight` (default 1000 m) for buildings, the view is the frustum
cut at the horizon distance for that height, and the two are tested with all
separating axes (exact for convex shapes). A per-tile bounding cone against
the visible cap of the sphere rejects the far side of the planet before the
box test. Before this, a street-level view over Paris requested 5 to 20x the
tiles MapLibre did; after, the two engines request within a few tiles of
each other (see the vector benchmark under M2).

Decoded textures reach the GPU through a per-frame time budget
(`uploadBudgetMs`, default 2 ms, at least one upload per frame): the walk
queues the tiles it wants, `renderer.initTexture()` uploads them in order
after the walk, and a tile whose texture is not uploaded yet counts as not
ready, so its ancestor keeps drawing. A burst of arrivals (typical after a
fast zoom, when a whole level lands within a few frames) then costs a few
milliseconds per frame instead of one long frame. Textures for tiles that
leave the selection are parked in an LRU cache (dispose on evict); in-flight
fetches for deselected tiles are aborted.

### Measured against 3d-tiles-renderer

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

### Precision

Tile meshes anchor their vertices relative to the tile center
(`TilePatchGeometry`), so Float32 vertex precision holds at street-level
zoom; the center itself lives in the mesh transform (Float64 in JS until it
reaches the GPU as a matrix). Patch grids are uniform in Web Mercator space,
so the (Mercator) tile texture maps linearly with no reprojection artifacts.

### Controls

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

### Known limits (accepted for M1)

- Perspective cameras only (SSE uses `camera.fov`).
- Frustum culling only; no horizon culling yet, so the far side of the globe
  costs traversal (not draws) at low altitude.
- Web Mercator polar caps (above ~85.05 degrees) are not filled.
- One raster source per `RasterTileMap`; overlay compositing is out of scope
  until M2.

## M2 Vector tiles

### Vector tile decoding

`VectorTileLoader` fetches the `.pbf` on the main thread (abortable, same as
the raster loader) and hands the buffer to a small pool of Workers that decode
it with `@mapbox/vector-tile`. The worker answers with flat arrays per source
layer (`decodeVectorTile`): feature types, ids and properties, plus a single
`Int32Array` of tile coordinates indexed through `featureStart` and
`ringStart`. That is the layout the geometry builders read, and it transfers
between threads without copying. Without Workers (Node, tests) the same
function runs inline. Polygon rings keep their MVT winding; classifying
exterior rings and holes belongs to the polygon builder.

`npm run decode-check` decodes the stub city's tiles in headless Chrome
through real Workers and inline. The stub tiles are small (under 1 kB each,
the city is 2.4 km of grid), so they time the pipeline, not the parser: 0.6
to 1.4 ms per tile inline, 1.7 to 3.5 ms per tile through the Workers once
they are warm (the first Worker start under the dev server costs ~600 ms of
module loading). A real OpenMapTiles tile is another order: the z14 tile over
central Paris from OpenFreeMap is 1.07 MB, 13 layers, 16 952 features,
96 027 vertices, and decodes in 93 ms cold, 25 to 35 ms warm in Node 20 on the
shared VM; z12 (338 kB) and z10 (268 kB) take 10 to 12 ms. This is what the
Workers are for: at street zoom a screen shows a handful of such tiles, and
the geometry build that follows (M2 PR B) costs more than the decode.

### Style evaluation

`Style` compiles a MapLibre style with `@maplibre/maplibre-gl-style-spec`
(the first runtime dependency besides three.js: `featureFilter`,
`normalizePropertyExpression` and the v8 spec for defaults, 76 kB minified
with the engine's own code, 23 kB gzipped). The honoured layer types and
properties are listed in `style-subset.md`; anything else stays on the layer
and is reported once per layer in `style.warnings`. Each property's
`kind` (constant, camera, source, composite) tells the builders whether a
value is a material constant, a per-frame uniform or baked per vertex, which
is the same split MapLibre makes between paint uniforms and data-driven
attributes.

### Geometry and rendering

The Worker that decodes a tile also builds its geometry (`buildTile`): one
block per style layer with something to draw, as flat attribute arrays that
transfer to the main thread and become `BufferAttribute`s there within the
per-frame budget the raster map already uses for texture uploads. Every layer
is built for every tile carrying its data, evaluated at the tile's zoom
clamped into the layer's zoom range; whether a block is drawn is decided per
frame from the map zoom (MapLibre's convention, a 512 px tile at integer
zoom, derived from the ground distance under the view center). One view
mixes tiles of several zooms, so a layer can not be tied to the tile zoom
the way MapLibre does it: a far z13 tile must still carry the extrusions a
minzoom 14 layer shows once the map is past 14.

What the style evaluates from the feature (`source` and `composite` kinds) is
baked per vertex; what it evaluates from zoom alone (`camera` kind) or from
nothing is a per-frame uniform, with the baked value set to 1 so the shader
computes `baked * uniform`. A zoom-dependent line width is a uniform update,
not a rebuild. A composite value is frozen at the tile's zoom, the one
known limitation of the scheme.

Tile coordinates are projected relative to the tile center (`TileProjection`)
so Float32 attributes keep street-level precision on the globe, where ECEF
coordinates are millions of meters; the tile object carries the offset. Both
modes expose the same `project` and `up` functions, so the builders never
branch on the mode.

Polygons are clipped to the tile square, grouped into exterior plus holes by
their MVT winding and triangulated with three.js's own Earcut (`fill`), or
extruded along the local up vector with flat-shaded sides (`fill-extrusion`,
lit by a `MeshLambertMaterial`). Lines are triangle strips extruded in the
vertex shader by a screen-space half width (`VectorLineMaterial`): each
vertex carries its tangent direction and side, the width in pixels is
converted to local units at the vertex's depth, edges are antialiased in the
fragment shader and lines thinner than a pixel are drawn one pixel wide and
faded, as MapLibre does. Joins are miter up to `line-miter-limit`, then
bevel; caps are butt. A run cut by the tile edge is extruded along that edge
so the neighbour's half meets it without a notch. `line-gap-width` builds two
strips, `line-offset` shifts them, `fill-outline-color` adds a line block to
a fill layer.

Draw order follows the style: meshes render in layer order, extrusions
opaque with depth, fills and lines without depth writes so coplanar layers
stack instead of fighting. Fills and lines drawn with an image pattern
(`fill-pattern`, `line-pattern`) are skipped rather than painted in the
default black; Liberty's `road_area_pattern` is the visible case.

Draw calls are one per tile per layer as in MapLibre; folding a layer's
tiles into one `BatchedMesh` is the next step. What a view costs today is in
the benchmark below.

### Measured against maplibre-gl-js

`npm run bench:vector` (or `compose run --rm bench-vector`, env `BENCH_DATA`
louvre or openfreemap, `BENCH_MODE` globe or planar) loads the same style
and the same tiles in this engine and in maplibre-gl-js 5.24.0, in headless
Chrome, and drives both through three poses (district z13 nadir, louvre
z14.6 pitched 50 degrees, street z16.5 pitched 62 degrees) and a 240-frame
fly from district to street. Draw calls and triangles are counted the same
way for both, by wrapping the `WebGL2RenderingContext` draw functions; tile
requests are counted at each engine's tile URL hook (MapLibre fetches from a
worker, so a `bench://` protocol handler stands in for its network). Zoom is
converted to camera distance with MapLibre's field of view so the two views
cover the same ground. Full output is in `bench/vector-results-*.json`; the
tables are from runs on 2026-09-24, SwiftShader on 2 CPUs of a shared VM,
800x500 viewport. Timings there vary by +-30 % between runs, so read the
ratios, not the milliseconds.

Louvre extract (own Overpass export, z13 to z15), globe:

| pose | metric | threejs-maplibre | maplibre-gl-js |
|---|---|---|---|
| district | tiles requested / draw calls / triangles | 9 / 32 / 62 490 | 10 / 65 / 26 011 |
| | time to stable / heap | 4.1 s / 84 MB | 3.4 s / 78 MB |
| louvre | tiles requested / draw calls / triangles | 17 / 71 / 91 737 | 0 / 75 / 76 846 |
| | time to stable / heap | 5.4 s / 116 MB | 2.8 s / 86 MB |
| street | tiles requested / draw calls / triangles | 6 / 56 / 44 871 | 4 / 110 / 53 025 |
| | time to stable / heap | 3.3 s / 135 MB | 1.9 s / 79 MB |
| fly district to street | tiles requested | 8 | 15 |
| | mean / p95 / max frame | 128 / 244 / 347 ms | 147 / 283 / 469 ms |
| | settle after fly / draw calls / heap | 1.8 s / 56 / 106 MB | 2.4 s / 110 / 88 MB |

Same data, planar:

| pose | metric | threejs-maplibre | maplibre-gl-js |
|---|---|---|---|
| district | tiles requested / draw calls / triangles | 6 / 17 / 48 674 | 10 / 64 / 26 010 |
| | time to stable / heap | 3.6 s / 78 MB | 2.6 s / 77 MB |
| louvre | tiles requested / draw calls / triangles | 17 / 71 / 88 219 | 0 / 74 / 76 845 |
| | time to stable / heap | 5.0 s / 116 MB | 2.9 s / 83 MB |
| street | tiles requested / draw calls / triangles | 7 / 56 / 44 750 | 4 / 110 / 53 025 |
| | time to stable / heap | 2.3 s / 118 MB | 4.4 s / 76 MB |
| fly district to street | tiles requested | 3 | 15 |
| | mean / p95 / max frame | 116 / 211 / 435 ms | 146 / 290 / 523 ms |
| | settle after fly / draw calls / heap | 1.5 s / 56 / 105 MB | 2.0 s / 110 / 102 MB |

OpenFreeMap's Liberty style, live planet tiles (z14 max, 1 MB and 17 k
features per tile over Paris), about a hundred layers, globe:

| pose | metric | threejs-maplibre | maplibre-gl-js |
|---|---|---|---|
| district | tiles requested / draw calls / triangles | 9 / 144 / 349 999 | 10 / 191 / 205 120 |
| | time to stable / heap | 8.9 s / 63 MB | 10.5 s / 34 MB |
| louvre | tiles requested / draw calls / triangles | 6 / 162 / 820 963 | 0 / 323 / 1 519 775 |
| | time to stable / heap | 20.2 s / 142 MB | 21.6 s / 30 MB |
| street | tiles requested / draw calls / triangles | 0 / 117 / 518 281 | 1 / 218 / 961 640 |
| | time to stable / heap | 8.1 s / 142 MB | 17.2 s / 39 MB |
| fly district to street | tiles requested | 1 | 8 |
| | mean / p95 / max frame | 398 / 783 / 1200 ms | 564 / 1014 / 1903 ms |
| | settle after fly / draw calls / heap | 4.5 s / 117 / 155 MB | 10.0 s / 218 / 46 MB |

Reading it:

- **Tile requests are on par.** MapLibre's 0 at the louvre pose is a cache
  effect: it fetched the tiles it needs there at the district pose (it loads
  the integer zoom, this engine picks z13 there and z14 later). Getting
  there took three changes to the shared quadtree (horizon cone, oriented
  boxes against a horizon-cut view volume, `backfillLevels`, see M1); before
  them the engine requested 49 / 58 / 79 tiles at the three Louvre poses.
- **Draw calls are half of MapLibre's** at street level on both datasets
  (56 vs 110, 117 vs 218) with one mesh per tile per layer, before any
  batching. MapLibre draws every antialiased fill layer twice per tile (the
  fill, then its outline as `GL_LINES`), the background once per tile, and
  two stencil mask passes per tile each time the source changes; here a
  fill is one draw and an outline exists only when the style gives it a
  color.
- **Triangles are 1.7 to 2.4x MapLibre's at district**, which is not the
  meshes: `fill-outline-color` is tessellated into a line strip here (two
  triangles per segment, so an outline costs about as much as the fill it
  wraps), where MapLibre draws outlines with `GL_LINES`. Drawing outlines as
  `LineSegments` is the cheap fix and would bring district under MapLibre's
  count. At street level on the Louvre extract, where outlines are a small
  share, this engine already draws fewer triangles (44 k vs 53 k). On
  Liberty over the globe MapLibre draws about twice the triangles at the
  louvre and street poses; part of that is its globe subdivision (fills and
  lines are cut to follow the curvature), part is that it served those poses
  from the tiles it had, so the two are not like for like there.
- **Time to stable is 1.5 to 2x MapLibre's on a direct jump on the Louvre
  extract**, and it is worker time: `stats.buildMs` puts one Louvre tile at
  100 to 200 ms to decode, style and triangulate on this VM, and the poses
  wait on 6 to 17 of them through 2 CPUs. Where the build spends it is not
  profiled yet (the expressions are MapLibre's own compiled ones, so the
  suspects are the clipping and Earcut per feature and the per-layer block
  assembly); a per-stage timing in the worker is the next measurement. On
  Liberty, where a tile is 1 MB and the network is in the loop, the two
  engines settle in the same time at district and louvre and this engine
  twice as fast at street, and the settle after the fly is 4.5 s against
  10 s.
- **Memory**: the main-thread heap is 1.3 to 1.7x MapLibre's at street
  level on the Louvre extract and 3 to 4x on Liberty (142 vs 39 MB); neither
  number includes the workers, where MapLibre keeps its decoded tiles. Not
  profiled yet; the first suspect is the CPU copy of every attribute that
  `BufferAttribute` keeps after upload, and the batching PR will measure
  what dropping it saves.
- **Frame times** are the software rasterizer's, as in the raster benchmark;
  the ordering (this engine 15 to 30 % faster mean and p95 on the fly) is
  consistent across runs, the absolute values are not.

### Objects on the map

`MapAnchor` is a `Group` placed by latitude, longitude and height whose
children live in a local frame in meters, x east, y up, -z north, on the
globe as on the plane, so a three.js object built the usual way (y up, facing
-z) stands level and faces north wherever it is put; a heading turns it
clockwise from north. The objects demo places a 34 m dish antenna and a
marker pin over the Louvre this way, with `?model=` loading a glTF instead,
as MapLibre's "Add a 3D model" example does through a custom layer. Here the
object is an ordinary scene member: it shares the depth buffer with the
buildings, takes the scene's lights and shadows, and can be picked or
animated like anything else in three.js.

### Distribution

`npm run build` produces two files with Vite in library mode: an ES module
that keeps `three` as an import, for bundlers and import maps, and a
standalone UMD script that bundles three.js under the global
`threejsMaplibre` (`threejsMaplibre.THREE` exposes it), for a page with no
build step. The tile Worker is inlined in both as a Blob URL, so one file
works from any origin or CDN; the sources swap the Worker factory only in
the library build (a Vite alias on `createWorker.js`). Earcut is bundled from
`three/src/extras/Earcut.js` even in the module build, since import maps
only know the bare `three` specifier. The package's `exports` point at the
module build and keep `./src/*` open for a bundler that prefers sources.
