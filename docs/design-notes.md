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
  come exactly from that adaptation layer. That one is fixed upstream now,
  by [#1730](https://github.com/NASA-AMMOS/3DTilesRendererJS/pull/1730)
  (a texel-size floor on the split tiles' error, merged 2026-09-28), but the
  impedance is in the design and the next case will look like it. A raster
  map needs one thing:
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
- wheel and trackpad zoom is MapLibre's `ScrollZoomHandler` ported: the
  device is told apart by the deltas (multiples of 4.000244140625 are a
  macOS mouse, values under 4 a trackpad, a pinch arrives as a trackpad
  with ctrlKey) and by their timing (a lone event is a wheel, a run of
  them a trackpad); a frame's deltas scale the map by
  `2 / ( 1 + e^( -|delta| * rate ) )`, two at most, at 1/450 for a wheel and
  1/100 for a trackpad; the target is approached over 200 ms; the ground
  under the cursor stays in place; a touch pinch zooms around the fingers'
  midpoint while their motion pans and their twist turns;
- keys as MapLibre's `KeyboardHandler`: + and - a level (two with shift),
  with cmd or ctrl as well, since the map is the page; arrows pan 100 px,
  with shift they turn 15 and tilt 10 degrees;
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
extruded along the local up vector (`fill-extrusion`, lit by a
`MeshLambertMaterial` with `flatShading`, which takes the normal of a face
from the derivatives of the view position, so no normal is built,
transferred or kept: 12 bytes a vertex on the heaviest block type). Lines
are triangle strips extruded in the vertex shader by a screen-space half
width (`VectorLineMaterial`): each
vertex carries its tangent direction and side, the width in pixels is
converted to local units at the vertex's depth, edges are antialiased in the
fragment shader and lines thinner than a pixel are drawn one pixel wide and
faded, as MapLibre does. Joins are miter up to `line-miter-limit`, then
bevel; caps are butt. A run cut by the tile edge is extruded along that edge
so the neighbour's half meets it without a notch. `line-gap-width` builds two
strips, `line-offset` shifts them, `fill-outline-color` adds a line block to
a fill layer. A line vertex is the one this engine builds most of, so its
attributes are quantized (`build/quantize.js`): the extrude direction and
the baked width, gap and offset as normalized Int16 against a fixed scale,
the side and gap flags as Int8, which takes a line vertex from 48 bytes to
30 with no visible difference (the sub-pixel shift on an antialiased edge is
the only thing a screenshot diff shows).

Draw order follows the style: meshes render in layer order, extrusions
opaque with depth, fills and lines without depth writes so coplanar layers
stack instead of fighting. Fills and lines drawn with an image pattern
(`fill-pattern`, `line-pattern`) are skipped rather than painted in the
default black; Liberty's `road_area_pattern` is the visible case.

Draw calls do not follow tiles. Each style layer owns one `BatchedMesh`:
uploading a tile copies its blocks into the batch of their layer, drawing it
adds one instance placed at the tile center, so a layer costs one draw call
however many tiles are on screen. The Louvre view is 9 draw calls whether it
holds 9 tiles or 39, and Liberty's hundred layers are about 50, one per
layer with something in view, against MapLibre's 218 at the same pose.

Instance matrices are float32, so a batch cannot sit at the origin of the
globe: ECEF coordinates are millions of meters and float32 would leave half
a meter of precision. The batches sit at a floating origin that follows the
camera and each instance holds its tile center minus that origin; when the
camera drifts more than `originRadius` (10 km) away the origin moves with it
and the instance matrices are rewritten, a few dozen at a time. A batch
starts at twice the first tile it holds and grows by half when a tile does
not fit, repacking what deleted tiles left behind first; when a tile leaves
and half the batch is idle it repacks and gives the buffers back, so a view
that flies out of a dense city does not keep its batches.
`stats.batchBytes` and `stats.geometryBytes` report what the batches reserve
against what the tiles in them occupy. What a view costs is in the
benchmark below.

### Measured against maplibre-gl-js

`npm run bench:vector` (or `compose run --rm bench-vector`, env `BENCH_DATA`
louvre or openfreemap, `BENCH_MODE` globe or planar) loads the same style
and the same tiles in this engine and in maplibre-gl-js 6.11.2, in headless
Chrome, and drives both through three poses (district z13 nadir, louvre
z14.6 pitched 50 degrees, street z16.5 pitched 62 degrees) and a 240-frame
fly from district to street. Draw calls and triangles are counted the same
way for both, by wrapping the `WebGL2RenderingContext` draw functions and
the `WEBGL_multi_draw` extension a `BatchedMesh` draws through (one call,
its ranges summed into the triangle count); tile requests are counted at
each engine's tile URL hook (MapLibre fetches from a worker, so a `bench://`
protocol handler stands in for its network). Heap is read after a forced
collection, so both engines are measured on what they hold rather than on
what the collector has not got to yet. Zoom is converted to camera distance
with MapLibre's field of view so the two views cover the same ground. Full
output is in `bench/vector-results-*.json`; the tables are from runs on
2026-09-27, SwiftShader on 2 CPUs of a shared VM, 800x500 viewport. Timings
there vary by +-30 % between runs, so read the ratios, not the
milliseconds.

Louvre extract (own Overpass export, z13 to z15), globe:

| pose | metric | threejs-maplibre | maplibre-gl-js |
|---|---|---|---|
| district | tiles requested / draw calls / triangles | 9 / 9 / 62 490 | 10 / 60 / 25 990 |
| | time to stable / heap | 4.0 s / 103 MB | 3.3 s / 56 MB |
| louvre | tiles requested / draw calls / triangles | 17 / 9 / 91 922 | 0 / 68 / 76 827 |
| | time to stable / heap | 6.9 s / 160 MB | 3.1 s / 52 MB |
| street | tiles requested / draw calls / triangles | 6 / 9 / 44 878 | 7 / 143 / 53 275 |
| | time to stable / heap | 3.3 s / 104 MB | 2.6 s / 59 MB |
| fly district to street | tiles requested | 8 | 15 |
| | mean / p95 / max frame | 133 / 302 / 505 ms | 153 / 314 / 585 ms |
| | settle after fly / draw calls / heap | 1.5 s / 9 / 104 MB | 2.4 s / 143 / 67 MB |

Same data, planar:

| pose | metric | threejs-maplibre | maplibre-gl-js |
|---|---|---|---|
| district | tiles requested / draw calls / triangles | 6 / 9 / 48 674 | 10 / 60 / 25 990 |
| | time to stable / heap | 3.4 s / 64 MB | 2.9 s / 52 MB |
| louvre | tiles requested / draw calls / triangles | 17 / 9 / 88 388 | 0 / 68 / 76 827 |
| | time to stable / heap | 5.7 s / 84 MB | 2.3 s / 52 MB |
| street | tiles requested / draw calls / triangles | 7 / 9 / 44 757 | 7 / 143 / 53 275 |
| | time to stable / heap | 2.5 s / 122 MB | 3.4 s / 58 MB |
| fly district to street | tiles requested | 3 | 15 |
| | mean / p95 / max frame | 123 / 242 / 625 ms | 141 / 260 / 494 ms |
| | settle after fly / draw calls / heap | 1.6 s / 9 / 102 MB | 2.6 s / 143 / 68 MB |

OpenFreeMap's Liberty style, live planet tiles (z14 max, 1 MB and 17 k
features per tile over Paris), about a hundred layers, globe:

| pose | metric | threejs-maplibre | maplibre-gl-js |
|---|---|---|---|
| district | tiles requested / draw calls / triangles | 9 / 52 / 352 633 | 10 / 187 / 204 532 |
| | time to stable / heap | 14.6 s / 81 MB | 9.2 s / 30 MB |
| louvre | tiles requested / draw calls / triangles | 6 / 55 / 822 587 | 0 / 311 / 1 519 628 |
| | time to stable / heap | 22.0 s / 128 MB | 18.7 s / 28 MB |
| street | tiles requested / draw calls / triangles | 0 / 48 / 519 817 | 7 / 345 / 714 167 |
| | time to stable / heap | 7.9 s / 128 MB | 16.0 s / 30 MB |
| fly district to street | tiles requested | 1 | 15 |
| | mean / p95 / max frame | 426 / 807 / 1136 ms | 431 / 973 / 1460 ms |
| | settle after fly / draw calls / heap | 7.7 s / 48 / 137 MB | 6.3 s / 345 / 36 MB |

Reading it:

- **Tile requests are on par.** MapLibre's 0 at the louvre pose is a cache
  effect: it fetched the tiles it needs there at the district pose (it loads
  the integer zoom, this engine picks z13 there and z14 later). Getting
  there took three changes to the shared quadtree (horizon cone, oriented
  boxes against a horizon-cut view volume, `backfillLevels`, see M1); before
  them the engine requested 49 / 58 / 79 tiles at the three Louvre poses.
- **Draw calls are one per layer, not per tile.** The Louvre style is 9
  draws at every pose, against MapLibre's 60 to 143; Liberty is 48 to 55
  against 187 to 345. Two things get there. MapLibre draws every antialiased
  fill layer twice per tile (the fill, then its outline as `GL_LINES`), the
  background once per tile, and two stencil mask passes per tile each time
  the source changes, where here a fill is one draw and an outline exists
  only when the style gives it a color; that alone had this engine at half
  MapLibre's count with a mesh per tile per layer (32 / 71 / 56 on the
  Louvre globe, 144 / 162 / 117 on Liberty, measured on the same machine
  before this change). MapLibre 6 draws more than 5 did at the steep poses
  (143 against 110 at street on the Louvre extract, 345 against 218 on
  Liberty), since it keeps more tiles in view there. Batching the tiles of a layer into one `BatchedMesh`
  took the rest: what is left is one draw per style layer with something in
  view, and it no longer grows as the view widens.
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
- **Time to stable is 1.2 to 2.5x MapLibre's on a direct jump on the Louvre
  extract**, and it is worker time: `stats.buildMs` puts one Louvre tile at
  100 to 200 ms to decode, style and triangulate on this VM, and the
  poses wait on 6 to 17 of them through 2 CPUs. Where the build spends it is
  not profiled yet (the expressions are MapLibre's own compiled ones, so the
  suspects are the clipping and Earcut per feature and the per-layer block
  assembly); a per-stage timing in the worker is the next measurement.
  Uploading now copies a tile into its layers' batches instead of wrapping
  its arrays, which the upload budget meters like any other upload; it did
  not move time to stable out of the run-to-run spread, but it is the first
  place to look if it does. On Liberty, where a tile is 1 MB and the network
  is in the loop, this engine is slower to the district (14.6 s against
  9.2 s) and louvre poses (22.0 against 18.7) and twice as fast at street
  (7.9 against 16.0), while MapLibre settles faster after the fly (6.3 s
  against 7.7 s).
- **Memory is the cost of this design.** The main-thread heap is 1.8 to
  3x MapLibre's on the Louvre extract and 4x on Liberty (128 vs 30 MB at
  street); neither number includes the workers, where MapLibre keeps its
  decoded tiles. `stats.batchBytes` and `stats.geometryBytes` say where it
  goes: at the Louvre street pose the batches reserve 36 MB and the tiles in
  them occupy 29 MB, on Liberty 118 and 96 MB. Both came down from the first
  batched version: a built z14 Liberty tile went from 15.6 to 10.8 MB by
  dropping the normals (`flatShading` takes them from the winding) and
  quantizing the line attributes, which took what a Liberty view holds from
  104 to 84 MB, and a batch now gives its buffers back when the tiles that
  filled it leave. What is left is the geometry itself, held on the CPU side
  as well as on the GPU because `BufferAttribute` keeps its array, plus the
  slack of growing by half. Next, in order: `LineSegments` for
  `fill-outline-color` instead of a
  tessellated strip (3.8 of those 10.8 MB, and the triangle
  count below), and quantized positions, which need the tile scale folded
  into the instance matrix.
- **Frame times** are the software rasterizer's, as in the raster benchmark,
  and they do not separate the two engines. Across the runs behind these
  tables the mean frame on the fly went from 0.65x to 1.2x MapLibre's and
  the ordering flipped between runs of the same build, on a machine whose
  load changed under us. Ranking them needs a quiet machine and a real GPU;
  what this benchmark can say is that the work per frame is in the same
  range.

### The budget CI enforces

`npm run budget` (or `compose run --rm budget`) drives the same three poses
and fly on the committed Louvre extract, this engine only, and fails when a
number is over its ceiling in `bench/budget.json`. It runs on every pull
request.

What it enforces is what a machine without a GPU can answer for: the tiles a
view asks for, the draw calls and the triangles it hands the GPU, and the
engine's own CPU per frame once the view is still and every tile has landed.
That last one is the 60 fps target, stated the only way CI can state it: at
16.7 ms a frame the engine has to leave the frame to the GPU, and it takes
1.1 ms on the fly today, so it does. The counts are exact numbers with a
little headroom (a slower machine can take an extra frame to settle and ask
for one more ancestor on the way); the draw calls are the tight one, since a
layer is one call and a regression there is what this guards.

Two things are printed and not enforced. Frame times, because a software
rasterizer's are not the target machine's. And the engine's CPU while tiles
are landing, which is 3 to 30 ms at the p95 of a pose and moves by a factor
of three between runs of the same build: one frame in twenty carries a tile
upload (4 to 5 ms of copying into the batches, measured in Node) or the
collector, and a ceiling over that would either be too loose to mean
anything or too tight to stay green. Smoothing that burst is real work,
listed with the rest under the benchmark above.

`BUDGET_UPDATE=1` records the run as the new ceilings, for a change that is
meant to move a number.

### How far the map goes

The camera here is free: street level, inside a building, a tunnel, a
cockpit, a satellite. Tilt it towards the horizon and the quadtree does what
it is asked, which is to cover the view, and the view reaches the edge of the
world. That is right for a map and wrong for a walk down a street, where
everything past the next junction is a few pixels of grey that still cost a
request, a build and a draw.

`viewDistance` (meters, `TileTree`, `Infinity` by default) cuts the
selection walk: a tile whose content box is further than that from the
camera is culled, so it is never requested, never built and never drawn. The
distance is to the box, which stands `contentHeight` above the surface, so
the tile under a camera is always in range however high it flies.

Cutting leaves an edge, so `createFog( style, { viewDistance } )` returns a
`three.Fog` that fades the last 40 % of the range into the colour the style
says the horizon has. MapLibre keeps the sky as a root property of the style
document rather than a layer, so `sky.fog-color` is the value it blends the
ground into, with `sky.horizon-color` and then the background layer as
fallbacks. `VectorLineMaterial` gained the fog chunks, since a
`ShaderMaterial` gets none of what the built-in materials get for free.

Measured on Liberty over Paris, tilted 67 degrees at 700 m, 1200x800:

| | tiles built | tiles drawn | draw calls | triangles |
|---|---|---|---|---|
| no view distance | 13 | 6 | 55 | 919 300 |
| `viewDistance` 2 km | 9 | 3 | 49 | 453 130 |
| `viewDistance` 500 m | 5 | 1 | 39 | 155 082 |
| street level, pitch 85, 300 m | 5 | 1 | 39 | 155 082 |

And the case that says whether the default is right: a camera 36 000 km up,
where the whole disc is in frame, still selects 4 tiles and draws 4 calls
with 20 319 triangles, because the horizon at that altitude is 40 000 km
away and the default cuts nothing. One number covers a room and a
geostationary orbit.

### What the map may hold

A free camera can be tilted at the horizon, and a tilt towards the horizon
over a city asks for everything out to it. Measured on Liberty over Paris at
300 m, 1200x800, pitch swept 60 to 89.5 and back in one session, the way a
user tilts: the tiles in view went from 2 to 54, but the page went from 91
MB to 510 MB and kept climbing. Three things were wrong, and the sweep
found each one in turn.

- **Retention was counted in frames.** A tile that left the view kept its
  object and content for 60 frames, which is a second at 60 fps and minutes
  on a software renderer at 0.2 fps: the frame is slow exactly when the
  view is heavy, which is when memory matters. The whole sweep advanced 86
  frames, so nothing was ever let go. Retention is `retainMs` now, 1000 by
  default.
- **The cache was a count.** 512 entries of parked content, and a Liberty
  z14 tile is 10 MB built where a tile of sea is nothing. `cacheBytes`
  (96 MB) bounds it, with `_contentBytes` saying what a tile weighs: the
  block arrays for a vector tile, the RGBA pixels for a raster one.
- **Nothing bounded what a frame could ask for.** One tilt issued 84 loads
  in a single frame, and every one of them landed and stayed. `memoryBudget`
  (192 MB) is the bound on resident content, in view and parked: past it the
  walk starts no new load and the coarser ancestor draws. Two details make
  it hold rather than leak. Loads in flight count against it at what a
  tile has weighed so far, since a budget that only sees landed tiles sees
  none of a burst, and a tile that lands is counted at once rather than at
  the next sweep. And parked content goes first: the cache is evicted to
  make room before a tile in view is refused, since what is parked is the
  least valuable thing held. `maxLoading` (16) caps the loads in flight on
  top, so a burst is sixteen tiles wide however many a frame wants.

The same sweep after:

| pitch | before: heap | after: resident | after: heap | refused | parked evicted |
|---|---|---|---|---|---|
| 60 | 131 MB | 41 MB | 123 MB | 0 | 0 |
| 80 | 362 MB | 209 MB | 253 MB | 11 | 0 |
| 89.5 | 425 MB | 195 MB | 261 MB | 20 | 8 |
| back to 60 | 476 MB | 219 MB | 285 MB | 0 | 27 |
| 89.5 again | 510 MB | 192 MB | 277 MB | 41 | 62 |

Resident holds at the budget through the swing, and the heap above it is
the engine itself plus the batches' own slack. The numbers a reader sees are
in the demo HUD (`resident`) and in `stats.residentBytes`, `stats.refused`;
the demo takes `?memoryMB= ?cacheMB= ?retainMs= ?maxLoading=` to try
others. A phone wants a smaller budget than a desktop, and a scene that
must never show a coarse tile wants a larger one; neither is a reason for
the default to be unbounded.

What a refusal looks like on screen is a coarser tile where a finer one
would have been, which is what the engine does while a tile loads anyway.
Not done here: choosing which tile to refuse. The walk is spatial, not
nearest first, so under pressure the budget goes to whichever tiles the
walk reaches first rather than to the ones in front of the camera.

### Labels and symbols

Symbol layers are parsed and kept but not drawn yet (`style-subset.md`).
What they ask for, measured on the z14 OpenFreeMap tile over the Louvre
(1.1 MB, the densest kind this engine sees) with Liberty's 25 symbol
layers: at street zoom 2 431 symbols in 12 layers, 30 859 glyphs from 92
distinct characters, 1 707 of them with an icon and 1 461 placed along a
line rather than at a point; at district zoom 392 symbols and 7 156 glyphs,
since the POI layers only switch on past z15. A street view holds several
such tiles, so a label engine here has to consider a few thousand candidates
per frame and draw a few hundred quads.

The plan, and what makes it different from drawing a fill:

- **Glyphs come from the style's `glyphs` URL**, the SDF ranges MapLibre
  serves (256 code points per PBF, one 8-bit signed distance bitmap per
  glyph). A style already points at a glyph server, and the format covers
  the scripts a map needs; rendering text with canvas measurements instead
  would tie the map to the browser's fonts. The ranges a tile needs are
  fetched once per font stack, decoded in a Worker and packed into an atlas
  texture. Paris Latin text is 92 distinct characters, so one 256x256 page
  at 24 px covers a European view; the atlas grows by pages.
- **Anchors are built in the Worker, placement runs per frame.** A point
  label's anchor and its glyph quads are tile data and belong with the rest
  of the block. A line label's glyphs follow the line as it turns on screen,
  so their angles depend on the camera and have to be recomputed on the main
  thread, as MapLibre does; the Worker's share is the line, the anchors
  along it and the shaping.
- **Collision is a screen-space pass over a uniform grid**, labels taken in
  layer order then `symbol-sort-key`, each box tested against the boxes
  already placed in the cells it spans. The prototype behind these numbers
  (the same real anchors, 800x500, 32 px cells) places 970 candidates in
  0.09 ms and 7 760 in 0.26 ms, so the pass fits in a frame with room to
  spare; the cost that matters will be the per-frame line placement, not the
  collision.
- **Drawing is one `BatchedMesh` per symbol layer**, like every other layer:
  a quad per glyph, the anchor in world space and the glyph offset applied
  in screen space in the vertex shader, the way `VectorLineMaterial` already
  turns a pixel width into local units. Labels then share the depth buffer
  with the buildings instead of floating over them in a DOM overlay, which
  is the point of doing this in three.js: a label can be occluded by a
  building, or stood up in 3D, and it still costs one draw call per layer.
- **Fading and cross-tile identity**: a label that wins or loses a collision
  fades over 300 ms rather than blinking, and a label keeps its identity
  across a zoom change through its feature id, so the same name does not
  flicker when the tile under it is replaced.

Deferred until the above works: `text-variable-anchor`, `icon-text-fit`,
vertical writing for CJK, the RTL shaping plugin, and curved labels beyond
one angle per glyph.

The strategy is settled here; the engine is built after M3. The bridge
decides something this design depends on: with maplibre-gl and three.js
sharing a camera, a map can keep MapLibre's own symbol layers drawn over
the scene, and that is worth knowing before writing a second label engine.
Either way the work above is the same shape, so nothing here is wasted, and
a style's labels are the last thing missing from a view that already has
its roads, water and buildings.

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


## M3 MapLibre bridge

### A three.js scene inside a maplibre-gl map

`MapLibreLayer` is a maplibre-gl custom layer (`renderingMode: '3d'`, so
it shares the map's depth buffer) that draws a three.js scene with the
map's own camera. The scene lives in meters around an anchor, in the frame
`MapAnchor` gives its children (x east, y up, -z north), so an object built
the usual way stands level and faces north, and `layer.place( object, lng,
lat, altitude, heading )` puts it somewhere else on the map.

The whole bridge is one matrix product, done on the CPU in float64. Every
frame MapLibre hands the layer its projection as 64-bit matrices
(`CustomLayerProjectionData`, new in maplibre-gl 6, added for exactly this
reason: so a layer can transform before rounding to float32). The layer
multiplies the one that applies by the matrix from the anchor's frame into
MapLibre's space and gives three.js the product as the camera's projection.
The anchor's world coordinates never reach the GPU, only offsets of a few
hundred meters do, which is what keeps a building-scale scene still at
street level.

MapLibre has three spaces, not one, and `MapLibreFrames.js` builds the
matrix into each:

- mercator, 0..1 across the world, y southwards, z up in the same units
  (a meter is the same length in every direction, what MapLibre calls
  conformal); `mercatorFrame( lng, lat, altitude )`;
- the globe, a unit sphere with a point at `(sin lng cos lat, sin lat, cos
  lng cos lat)` (`globe_utils.ts`) and altitude along the radius;
  `globeFrame( lng, lat, altitude )`;
- the morph between them from zoom 11 to 12, where MapLibre's shader mixes
  the two clip-space results per vertex (`projectionTransition` going from 1
  to 0). A three.js camera holds one matrix, so the layer mixes the two
  matrices, which is the same thing at the anchor and drifts with the square
  of the distance from it, like the meters frame itself.

Both spaces are MapLibre's sphere, 6 371 008.8 m in radius, not the WGS84
ellipsoid this engine's own globe uses. On MapLibre's map, MapLibre's earth
is the one to stand on, and `MAPLIBRE_EARTH_RADIUS` is where that number
lives.

The frames are unit-tested against maplibre-gl's own `MercatorCoordinate`
and its sphere formula, and the whole path is measured against the map
(`npm run bridge-check`): for zooms 2 to 19, pitched and turned, points a
third of the view away from the anchor land within 0.08 px of where
`map.project()` puts the same ground, in both projections and through the
morph. A three.js box and a MapLibre `fill-extrusion` of the same size,
drawn one at a time and compared by the pixels they cover, overlap at 0.999
at every zoom where the map is flat.

On the pure globe that same box test first came out at 0.81, with MapLibre's
own square drawn up to 300 m north of `map.project()` at mid-latitudes,
which looked like a bug in maplibre-gl's globe path. It was not: the same
page on a real GPU (Apple, Safari) gives 0 at every latitude and zoom. The
offset is SwiftShader's, the software renderer the VM's headless Chrome uses,
so a sub-pixel discrepancy seen only there is not evidence of anything until
a real GPU has drawn it.

Evidence: the antenna and the pin from the objects demo, drawn inside a
MapLibre map on OpenFreeMap's Liberty style, on its globe and on its flat
map, standing where this engine's own map puts them, and occluded by
MapLibre's buildings because the depth buffer is one.

![Bridge, globe](../evidence/m3/bridge-globe.png)
![Bridge, mercator](../evidence/m3/bridge-mercator.png)

### Terrain, and two spaces

With terrain on the map, the anchor stands on it. Its elevation is asked of
the map every frame (`map.queryTerrainElevation`, exaggeration included,
which is what MapLibre's own three.js-on-terrain example does), so the
scene settles as DEM tiles land, and an object placed through
`layer.place()` is settled every frame on its own ground rather than the
anchor's: a pole 2 m above a hillside 240 m higher than the anchor stands
242 m up. The port of that example, `demo/bridge-terrain.html`, puts two
antennas on a Tyrolean hillside over Mapterhorn's keyless terrarium DEM;
the HUD reads the ground under each.

The layer has two spaces. `local`, the default, is meters around the
anchor, for anything building-sized, where float32 has to hold a
centimetre. `world` is MapLibre's own units, mercator 0..1 on the flat map
and the unit sphere on the globe, for content the size of a continent,
where a meters frame would drift (it is mercator linearised at one point)
and a kilometre of float32 precision is plenty. `worldPosition( lng, lat,
altitude )` gives a place in the space of the current frame and `onGlobe`
says which; content that must survive the morph rebuilds itself when that
flips, which is what MapLibre's own shaders do per vertex. Two of
MapLibre's examples are ported that way in `demo/bridge-world.html`: the
sine wave of "Animate a line", a point per frame across the world, and the
red triangle of "Add a custom style layer" over Helsinki, Berlin and Kyiv,
its raw WebGL replaced by a `Mesh`. Both are drawn without a depth test,
as MapLibre draws its 2D layers: at altitude 0 a line fights the globe's
own surface for the depth buffer and loses.

![Bridge, terrain](../evidence/m3/bridge-terrain.png)
![Bridge, world space](../evidence/m3/bridge-world-triangle.png)

### Direction B: the map under the scene

The mirror of the layer: a maplibre-gl map in its own element beneath a
transparent three.js canvas, this engine's `MapControls` owning the input,
and every frame the map's camera derived from the scene's
(`MapLibreUnderlay.sync( camera )`). MapLibre's whole style shows through
under the 3D, labels and icons included, which is everything this engine
does not draw yet.

Flat, it is exact by construction. The scene is this library's planar
frame, Web Mercator meters with x east, y up and -z north; MapLibre's flat
map is the same projection. The underlay reads the camera, not the
controls: the ground point under the screen centre is the map's centre,
the distance to it against the vertical field of view gives the zoom
(`cameraToCenterDistance` is `0.5 * height / tan( fov / 2 )` pixels in
`transform`), the view direction gives bearing and pitch, the camera's
right against the level right gives roll, and `fov` is passed through with
`setVerticalFieldOfView`. `jumpTo` takes all of it. Measured (`npm run
underlay-check`), ground points a third of the view out land 0.000 px from
where `map.project()` puts them, straight down, at pitch 85 and turned,
from zoom 1.5 to 18. A free camera works as long as its view ray still
meets the ground; looking at the sky, `sync()` returns false and the map
stays where it was.

What a DOM underlay cannot do is share a depth buffer. The scene is always
over the map, so a building drawn here hides a label drawn there, and
MapLibre's own extrusions, if the style has them, are under everything.
That is the layer's job (direction A): three.js content in among
MapLibre's, one depth buffer. The underlay is for the other case, when the
scene is the thing and MapLibre is the basemap under it.

On the globe the two engines drew different shapes of the earth: this
engine's globe was WGS84, MapLibre's is a sphere of 6 371 008.8 m with
geodetic latitude taken as spherical, and the two surfaces are 21 km apart
on the ground at Paris (11.45 arcminutes of latitude, 5 km of radius). No
camera sync bridges that; it is a datum question. So the shape of the
earth is now a parameter, a `datum` of `{ radius, polarRadius }` that
every function of `Ellipsoid.js` takes and that `RasterTileMap`,
`VectorTileMap`, `MapControls` and `MapAnchor` pass down to the tile
patches, the build workers, the horizon culling and the camera. `WGS84` is
the default and `MAPLIBRE_SPHERE` the other; a plain object, so it crosses
`postMessage` to the workers. A scene built on `MAPLIBRE_SPHERE` stands
where MapLibre's globe puts the same place.

The globe camera then follows MapLibre's own construction
(`VerticalPerspectiveTransform._calcMatrices`): the point the view ray
meets the sphere at is the centre, pitch and bearing are read in the local
frame there, and the zoom comes from the ground at the centre, which
MapLibre sizes to the flat map's meters per pixel at that latitude on a
sphere of its radius (`getGlobeRadiusPixels`: `worldSize / 2π / cos lat`).
Measured the same way, ground points a third of the view out land 0.000 px
from `map.project()` from the whole earth at zoom 0.95 to zoom 7.6, at
every pitch and heading tried. Past zoom 12 MapLibre's globe is a flat map
again while the scene stays on the sphere; the two are 0.25 px apart over
what a view spans at zoom 12.9 and 0.01 px at zoom 17, the sag of a sphere
under a plane, which is what MapLibre's own morph at zoom 11 to 12 exists
to hide.

One thing to know when measuring: MapLibre picks globe or flat for the
zoom when it draws a frame, so `map.project()` right after a `jumpTo`
across zoom 12 answers in the other projection until a frame has gone by,
30 px off at the whole-earth view. The check waits for one.

Evidence: the antenna and the pin over MapLibre's Liberty style, flat,
MapLibre's labels showing through under them; with this engine's extruded
Louvre buildings over the same basemap; on MapLibre's globe, the scene on
its sphere; and the whole earth from 20 000 km, the pin still on the
pyramid.

![Underlay](../evidence/m3/underlay.png)
![Underlay, with this engine's buildings](../evidence/m3/underlay-buildings.png)
![Underlay, globe](../evidence/m3/underlay-globe.png)
![Underlay, the whole earth](../evidence/m3/underlay-globe-far.png)

### Compared with threebox, maplibre-three-plugin and maplibre-gl-three

The kickoff table, filled in from the sources rather than the READMEs, all
read on 2026-10-03. Three libraries put three.js content on a MapLibre or
Mapbox map; this one does that both ways and also draws the map itself.

| | [threebox](https://github.com/jscastro76/threebox) | [maplibre-three-plugin](https://github.com/dvt3d/maplibre-three-plugin) | [maplibre-gl-three](https://github.com/safwat-halaby/maplibre-gl-three) | threejs-maplibre |
|---|---|---|---|---|
| map engine | Mapbox GL 1.11 / 2.x; MapLibre declined ([#375](https://github.com/jscastro76/threebox/issues/375)) | maplibre-gl, no version declared (v5 implied) | maplibre-gl ^6.11.2 | maplibre-gl ^6.11.2 for the bridge; none for the engine |
| three.js | r132, bundled | ^0.178 | ^0.186 | ^0.180 peer |
| camera | rebuilt from `map.transform` private fields | rebuilt from `map.painter.transform` | `mainMatrix` times a local frame, decomposed back into a camera | `mainMatrix` times a local frame, kept as a float64 product |
| precision | one 1 024 000-unit mercator world, float32 | the same world, per-object "RTC" groups | ECEF scene, anchor moved to the map centre on every `move` | meters around an anchor, or MapLibre's units for continent-sized content |
| globe | no ([#367](https://github.com/jscastro76/threebox/issues/367)) | no | `mainMatrix` passed through; the morph (`fallbackMatrix`, `projectionTransition`) not read | globe, flat, and the morph mixed as MapLibre mixes it |
| terrain | adds Mapbox's DEM; objects do not settle ([#241](https://github.com/jscastro76/threebox/issues/241)) | not integrated ([#6](https://github.com/dvt3d/maplibre-three-plugin/issues/6)) | no settling; EGM96 geoid applied to heights | anchor and placed objects settled every frame on `queryTerrainElevation` |
| depth with MapLibre layers | shared | shared, except behind its post-processing ([#8](https://github.com/dvt3d/maplibre-three-plugin/issues/8)) | cleared before and after by default; shared on request | shared |
| the other direction | no | no | no | the map under the scene, flat and globe |
| measured alignment | none stated | none stated | none stated | 0.08 px (layer), 0.000 px (underlay) against `map.project()` |
| toolkit | loaders, CSS2D labels, drag and rotate, sun, shadows, tubes, extrusions | sun, shadow ground, post-processing, flyTo | 3D Tiles, raycasting, several layers | the style itself; anchors; fog; no labels yet |
| last release | 2.2.7, 2022-06 | 1.7.1, 2026-07 | 2.0.0, 2026-10 | not on npm yet |

What the table does not say. threebox is the richest object toolkit of
the four and the one with the most users (63 000 npm downloads a month),
and it is frozen: three r132 bundled, Mapbox only, the maintainer's last
own commit in 2022. maplibre-three-plugin is threebox's camera sync
rewritten in TypeScript for MapLibre, flat map only, with post-processing
through an `EffectComposer` that costs it the shared depth buffer.
maplibre-gl-three is the closest in intent and the one to watch: it reads
the matrix MapLibre hands a custom layer rather than rebuilding it, moves
its anchor with the map, and is the only one that thinks about vertical
datums, fetching the EGM96 geoid so ECEF data lands on MapLibre's
orthometric terrain. It does not read `fallbackMatrix` or
`projectionTransition`, so content crosses the zoom 11 to 12 morph on the
globe's matrix alone, and it clears the depth buffer around its scene by
default. Its author's criticism in
[discussion 8552](https://github.com/maplibre/maplibre-gl-js/discussions/8552)
(shaders, a compose build, custom low-level math) is fair as a description
and is also where this library's numbers come from: the alignment and the
budget are measured because the math is ours.

What this library takes from them, in order: the vertical datum, which
maplibre-gl-three has and this one lacks (heights here are MapLibre's own
meters, right for objects placed on its terrain, wrong by up to 100 m for
an ECEF dataset like 3D Tiles until a geoid is applied); the toolkit
breadth of threebox, which the label engine after M3 and the anchor API
chip at; and a contribution upstream where one fits, which for this
milestone is the custom layer documentation of `defaultProjectionData`
under globe, since none of the three libraries, nor MapLibre's own 3D
model example, handles the morph, and this one does.

### The typed API

The library is plain JavaScript and stays so; what an application written
in TypeScript needs is the declarations, so `types/index.d.ts` is written
by hand against the sources rather than generated from JSDoc, which would
have typed half the options as `any`. Every option bag, every stats object
and the two slices of maplibre-gl's `Map` that the bridge calls
(`MapLibreMapLike` for the layer, `MapLibreUnderlayMapLike` for the
underlay, so a real map satisfies them and a test double does too) are
declared. Two things keep the file honest: `types/check.ts` uses the API
the way an application would and is compiled with `tsc --strict` on every
CI run (`npm run types-check`), and `test/types.test.js` checks that every
export of `src/index.js` is declared and nothing is declared that is not
exported.
