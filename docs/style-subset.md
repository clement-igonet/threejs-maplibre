# MapLibre style subset

`Style` reads a MapLibre style document (`version: 8`) and compiles its
filters and property values with `@maplibre/maplibre-gl-style-spec`, the
reference implementation, so expressions, zoom functions and legacy stops
evaluate exactly as in MapLibre. What the engine then does with the values is
limited to the table below; everything else is kept on the layer and reported
in `style.warnings`, one line per layer.

## Sources

| type | status |
|---|---|
| `vector` with `tiles` or `url` (TileJSON) | supported (`VectorTileSource`, `VectorTileSource.loadTileJSON`) |
| `raster`, `raster-dem`, `geojson`, `image`, `video` | not supported (warning) |

The tile schema (OpenMapTiles, Shortbread) is not interpreted: layers read
the `source-layer` and attributes the style names.

## Layers

Layer order is the style's order. `minzoom`, `maxzoom`, `filter` (legacy and
expression forms) and `layout.visibility` apply to every type. `ref` layers
are dereferenced.

| type | paint | layout | status |
|---|---|---|---|
| `background` | `background-color`, `background-opacity` | | rendered |
| `fill` | `fill-color`, `fill-opacity`, `fill-outline-color` | | rendered |
| `line` | `line-color`, `line-width`, `line-opacity`, `line-gap-width`, `line-offset` | `line-cap`, `line-join`, `line-miter-limit` | rendered |
| `fill-extrusion` | `fill-extrusion-color`, `fill-extrusion-opacity`, `fill-extrusion-height`, `fill-extrusion-base` | | rendered |
| `symbol` | | | parsed and kept, not rendered (M2 label decision pending) |
| `circle`, `heatmap`, `raster`, `hillshade`, `color-relief` | | | not rendered (warning) |

Properties not in the table (`*-pattern`, `*-translate`, `line-dasharray`,
`line-blur`, `line-gradient`, `fill-antialias`, `fill-extrusion-vertical-gradient`, ...)
are ignored with a warning.

## Evaluation

`layer.get( name, zoom, feature )` returns the value MapLibre would use:
numbers, enums, or a style-spec `Color` (premultiplied `r g b a` in 0..1,
`.rgb` for the plain components). `layer.kind( name )` says how a property
varies, which decides where the builders evaluate it:

| kind | varies with | handled |
|---|---|---|
| `constant` | nothing | material |
| `camera` | zoom | material uniform, updated per frame |
| `source` | feature | baked per vertex when the tile is built |
| `composite` | zoom and feature | baked per vertex at the tile's zoom, rebuilt when the tile's zoom changes |

Feature objects are `{ type: 1 | 2 | 3, properties, id }` as decoded from the
tile (`decodeVectorTile`); `$type` / `geometry-type` filters read `type`.
