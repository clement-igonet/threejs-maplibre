# threejs-maplibre

**A three.js map engine for OpenStreetMap data, with MapLibre interop.**

MapLibre GL JS is the leading open web map renderer, but it is a *map* engine: a
specialized 2.5D renderer. three.js is a *general* 3D engine: full scene graph,
physics-friendly, PBR lighting, post-processing, XR. This project connects the
two worlds so that OSM data and the MapLibre ecosystem become first-class
citizens inside three.js, and three.js scenes become first-class citizens on
MapLibre maps.

What none of the existing bridges (threebox, maplibre-three-plugin) provide:
a three.js-**native** map engine (tiles, vector styling, buildings, indoor)
rather than a thin overlay, plus the bridge in both directions.

## Live demo

[clement-igonet.github.io/threejs-maplibre](https://clement-igonet.github.io/threejs-maplibre/): M1 globe and
planar demos plus the engine benchmark, deployed from `main` by the Pages workflow.
Run locally with `docker compose up dev` (or `podman compose`), no install needed.

Globe controls follow MapLibre: drag to pan, wheel or pinch to zoom, right drag
(ctrl/shift + drag on a trackpad) to turn and tilt, two fingers sliding together
to tilt. `?lat=&lon=&alt=&heading=&pitch=` opens a view, e.g.
[Paris, tilted](https://clement-igonet.github.io/threejs-maplibre/demo/globe.html?lat=48.8566&lon=2.3522&alt=1500&heading=30&pitch=60).

## Milestones

| Milestone | Tracking issue |
|---|---|
| [M1 Tile foundations](../../milestone/1): OSM XYZ tiles on a three.js globe and plane | [#1](../../issues/1) |
| [M2 Vector tiles and styling](../../milestone/2): MVT to three.js geometry, MapLibre style subset | [#2](../../issues/2) |
| [M3 MapLibre bridge](../../milestone/3): two-way maplibre-gl / three.js interop | [#3](../../issues/3) |
| [M4 Buildings and indoor](../../milestone/4): Simple 3D Buildings + Simple Indoor Tagging | [#4](../../issues/4) |
| [M5 Gamification showcase](../../milestone/5): character navigation on real OSM data | [#5](../../issues/5) |
| [M6 Documentation and adoption](../../milestone/6): docs, releases, upstream, corpus | [#6](../../issues/6) |

## Related work by the author

- [maplibre-gl-indoor](https://github.com/clement-igonet/maplibre-gl-indoor): indoor display and client-side navigation for MapLibre
- OpenEarthView (2016-2018): OSM tiles projected on a three.js globe; [three.js PR #12586](https://github.com/mrdoob/three.js/pull/12586)
- Upstream three.js example proposal for an OSM raster-tile globe (in preparation)

## Funding

A grant application to the [NLnet Foundation](https://nlnet.nl/) covers M1-M6.
This repository is the public tracking point: one milestone and one tracking
issue per work package.

## License

MIT (code to come).
