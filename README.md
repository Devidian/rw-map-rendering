# RW Map Rendering

Standalone renderer for Rising World map tiles.

The renderer polls one or more configured servers through Rising World's native Admin Utils route:

```text
GET <baseUrl>/plugins/oz---admin-utils/map?lastChange=<cursor>
```

Tiles are written under:

```text
<MAP_ROOT_DIR>/<server-id>/...
```

`server-id` is compatible with `rw-manager-backend`: `server-${sha256("<ip>:<port>").slice(0, 24)}`.

Renderer state and source-cache files are stored below `<MAP_ROOT_DIR>/.state/`.
The source cache is sharded by `256x256` chunk sectors and indexed by a compact
`<server-id>.meta.json` file, so delta renders only load affected sector shards
instead of one large full-world JSON file. Full-sync responses replace the
server cache; delta responses update shards and render only affected native
tiles.

If rendered tiles were produced with an older cache version or already contain
incorrect transparent chunks, delete that server's render cursor/source-cache
state and let the renderer perform a full sync.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Health server port. |
| `HOST` | `0.0.0.0` | Health server host. |
| `MAP_ROOT_DIR` | `/appdata/rw-map-rendering/tiles` | Rendered tile root. |
| `POLL_INTERVAL_MS` | `15000` | Poll interval. |
| `RENDER_SERVERS_JSON` | `[]` | JSON array of server configs. |
| `RSYNC_TARGET` | empty | Optional rsync target for rendered tiles. |
| `RSYNC_SSH_KEY_FILE` | empty | Optional SSH key file for SSH rsync targets. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, or `off`. |

Server config shape:

```json
[
  {
    "ip": "127.0.0.1",
    "port": 4255,
    "baseUrl": "http://127.0.0.1:3000",
    "name": "Example",
    "timeoutMs": 5000,
    "retryAttempts": 1,
    "retryBackoffMs": 1000
  }
]
```

When `RSYNC_TARGET` is configured, rsync runs after each successful server render batch. If `RSYNC_SSH_KEY_FILE` is configured and the target is SSH-shaped, the key is passed through `rsync -e`.

## Validation

```sh
yarn build
yarn test
```
