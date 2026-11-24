# Rising World map renderer
<!-- codemap-id: rw-map-rendering -->

## Purpose

Polls native Admin Utils exports and produces map tiles and metadata. [Startup](../src/index.ts) starts [runtime](../src/service/render-runtime.ts) and [health server](../src/server.ts).

## Modules

- [Polling, rendering and state](modules/render.md)
- [Tile publication](modules/publication.md)

## Build and tests

[Package scripts](../package.json) define `yarn build` and `yarn test`; focused tests are in [tests](../tests/).
