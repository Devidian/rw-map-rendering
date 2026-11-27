# Polling, rendering and state
<!-- codemap-id: rw-map-rendering/render -->

## Responsibility

Poll native map and satellite data, render deterministic PNG tiles, and persist render progress. Per-server polling preserves terrain-before-satellite order and serializes duplicate server IDs. Do not advance cursors after render failure.

## Source and tests

- [`NativeMapSource`](../../src/service/native-map-source.ts) requests and acknowledges exports. [`MapRenderPoller`](../../src/service/map-render-poller.ts), [`MapTileRenderer`](../../src/service/map-tile-renderer.ts), and [`RenderStateStore`](../../src/service/render-state-store.ts) implement the flow.
- [Satellite poller](../../src/service/satellite-render-poller.ts) and [satellite source](../../src/service/native-satellite-source.ts) handle the satellite path.
- [Poller tests](../../tests/map-render-poller.test.ts), [native source tests](../../tests/native-map-source.test.ts), and [state tests](../../tests/render-state-store.test.ts) cover key boundaries.
- [Runtime tests](../../tests/render-runtime.test.ts) cover independent cadence, per-server serialization, and shutdown.

## Dependencies

- `rw-plugin-oz-admin-utils/map-export` — source HTTP export and acknowledgment. [Native source](../../src/service/native-map-source.ts)
