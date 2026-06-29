# RW Map Rendering

Standalone renderer for Rising World map tiles.

The renderer polls one or more configured servers through the bridge/native route:

```text
GET <baseUrl>/plugins/ozadminutils/map?lastChange=<cursor>
```

Tiles are written under:

```text
<MAP_ROOT_DIR>/<server-id>/...
```

`server-id` is compatible with `rw-manager-backend`: `server-${sha256("<ip>:<port>").slice(0, 24)}`.

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
