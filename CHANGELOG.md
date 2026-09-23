# Changelog

## [0.1.4](https://github.com/Devidian/rw-map-rendering/compare/rw-map-rendering-v0.1.4...rw-map-rendering-v0.1.4) (2026-09-23)


### Features

* load render servers from config file ([69ca76e](https://github.com/Devidian/rw-map-rendering/commit/69ca76e0a7265085690f8e72c23b7104f6794a48))


### Bug Fixes

* write renderer state atomically ([0719c11](https://github.com/Devidian/rw-map-rendering/commit/0719c11a483cb7480ba5fa58b7227770092e649e))

## [0.1.4] - 2026-09-08

- fix: preserve the renderer instance while writing metadata after a streamed full map synchronization.

## [0.1.3] - 2026-09-08

- fix: accept the `nextOffset: null` final-page marker emitted by Admin Utils map exports.

## [0.1.2] - 2026-09-08

- fix: consume paged native map exports safely, serialize concurrent renderer requests, and write full-sync pages directly to the source cache.
- docs: document direct public Admin Utils terrain-map access for standalone rendering.

## [0.1.1](https://github.com/Devidian/rw-map-rendering/compare/rw-map-rendering-v0.1.1...rw-map-rendering-v0.1.1) (2026-09-05)


### Features

* render maps from native plugin route ([542fff9](https://github.com/Devidian/rw-map-rendering/commit/542fff92bef2c5a6656eaec7276d7e3415502798))


### Bug Fixes

* persist sharded source cache safely ([232a50c](https://github.com/Devidian/rw-map-rendering/commit/232a50c7cc7e5f35d61f7a0269b0ce7b3ff3540e))

## [0.1.1](https://github.com/Devidian/rw-map-rendering/compare/rw-map-rendering-v0.1.0...rw-map-rendering-v0.1.1) (2026-09-05)


### Features

* render maps from native plugin route ([542fff9](https://github.com/Devidian/rw-map-rendering/commit/542fff92bef2c5a6656eaec7276d7e3415502798))


### Bug Fixes

* persist sharded source cache safely ([232a50c](https://github.com/Devidian/rw-map-rendering/commit/232a50c7cc7e5f35d61f7a0269b0ce7b3ff3540e))

## [0.1.0] - Unreleased

- Initial standalone map renderer scaffold.
