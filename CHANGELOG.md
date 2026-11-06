# Changelog

## Unreleased

## [0.2.0](https://github.com/Devidian/rw-map-rendering/compare/rw-map-rendering-v0.1.7...rw-map-rendering-v0.2.0) (2026-11-06)


### Features

* load render servers from config file ([69ca76e](https://github.com/Devidian/rw-map-rendering/commit/69ca76e0a7265085690f8e72c23b7104f6794a48))
* prepare satellite renderer RC 0.1.5-rc.3 ([682b5bc](https://github.com/Devidian/rw-map-rendering/commit/682b5bc4b0ebfa51309995100500b7ff1e87d77a))
* publish renderer tiles over SFTP in v0.1.5 ([5b325df](https://github.com/Devidian/rw-map-rendering/commit/5b325df13002c2c574fdc604ecffe85f67eb0124))
* render maps from native plugin route ([542fff9](https://github.com/Devidian/rw-map-rendering/commit/542fff92bef2c5a6656eaec7276d7e3415502798))


### Bug Fixes

* accept null map page offset ([96ded03](https://github.com/Devidian/rw-map-rendering/commit/96ded034a180d8787d5964bde75a976086eab6b7))
* derive component release version for Docker ([c7beb22](https://github.com/Devidian/rw-map-rendering/commit/c7beb2298d12cb2ca25c583f3e0e8970a44942ee))
* keep image release successful when description update is forbidden ([1701814](https://github.com/Devidian/rw-map-rendering/commit/17018147f2014668a46743ceddcc82ffbea804fc))
* persist sharded source cache safely ([232a50c](https://github.com/Devidian/rw-map-rendering/commit/232a50c7cc7e5f35d61f7a0269b0ce7b3ff3540e))
* preserve renderer metadata context ([451e6b4](https://github.com/Devidian/rw-map-rendering/commit/451e6b466220cb5292f898e98ef2fff65cec6f53))
* stream paged native map exports ([963ea02](https://github.com/Devidian/rw-map-rendering/commit/963ea027dd140596a1c9adb9cff9b4b2265a393a))
* write renderer state atomically ([0719c11](https://github.com/Devidian/rw-map-rendering/commit/0719c11a483cb7480ba5fa58b7227770092e649e))

## [0.1.7] - 2026-11-06

- feat: optionally acknowledge rendered Admin Utils terrain chunks per server after local cache and tile writes.
- fix: retain cached chunks and tiles across full syncs when acknowledged source rows have already been removed from Admin Utils.
- docs: document per-server tokens, persistent renderer storage, and the seven-day retention rollout.

## [0.1.5] - 2026-10-20

- feat: poll optional Admin Utils satellite images and publish a separate satellite tile pyramid when data exists.
- feat: publish changed map and satellite files over SFTP using rclone, with optional idle and hourly reconciliation.
- fix: keep SFTP full synchronization within a validated server directory and allow it to be disabled during initial seeding.

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
