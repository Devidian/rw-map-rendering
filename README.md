# RW Map Rendering

Standalone renderer for Rising World map tiles. It polls the native Admin Utils
map route, writes PNG tiles and can publish them through any static web server.

## Native host setup

For a setup without Docker, use the platform-specific guides:

- [Linux](docs/setup-linux.md)
- [Windows](docs/setup-windows.md)

## Docker Hub quick start: HTTPS map host

The following setup runs the published image and Caddy on a separate host. It
does not require RW Manager: the renderer talks directly to the Rising World
HTTP server and Caddy serves only the generated map files.

### Prerequisites

- Docker Engine with the Compose plugin.
- A public DNS `A`/`AAAA` record such as `map.example.org` pointing to this
  host. TCP ports 80 and 443 must reach this host and not be claimed by another
  web server.
- Outbound DNS and HTTPS access for the Caddy container so it can obtain a
  Let's Encrypt certificate.
- Network access from the renderer container to the Rising World HTTP server.
- Admin Utils `0.10.2` or later. Enable `exposeMapData` for each world to be
  rendered. This deliberately exposes terrain data to the renderer; do not
  enable it on a server whose map must remain private.

Create an empty directory and add these three files.

`compose.yml`:

```yaml
services:
  renderer:
    image: devidian/rw-map-rendering:0.1.4
    restart: unless-stopped
    environment:
      HOST: 0.0.0.0
      PORT: 3000
      MAP_ROOT_DIR: /data
      POLL_INTERVAL_MS: ${POLL_INTERVAL_MS:-15000}
      RENDER_SERVERS_CONFIG_FILE: /app/config/server-config.json
      LOG_LEVEL: ${LOG_LEVEL:-info}
    # Useful when Docker cannot use the host's systemd-resolved stub.
    dns:
      - ${DNS_PRIMARY:-1.1.1.1}
      - ${DNS_SECONDARY:-1.0.0.1}
    volumes:
      - ${RENDER_SERVERS_CONFIG_FILE:?Set RENDER_SERVERS_CONFIG_FILE in .env}:/app/config/server-config.json:ro
      - map_tiles:/data

  web:
    image: caddy:2.10.2-alpine
    restart: unless-stopped
    depends_on:
      - renderer
    environment:
      MAP_HOSTNAME: ${MAP_HOSTNAME:?Set MAP_HOSTNAME in .env}
      ACME_EMAIL: ${ACME_EMAIL:?Set ACME_EMAIL in .env}
    dns:
      - ${DNS_PRIMARY:-1.1.1.1}
      - ${DNS_SECONDARY:-1.0.0.1}
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - map_tiles:/srv:ro
      # Transparent fallback served only for missing map tiles.
      - ./empty.png:/srv/empty.png:ro
      - caddy_data:/data
      - caddy_config:/config
      - ./Caddyfile:/etc/caddy/Caddyfile:ro

volumes:
  map_tiles:
  caddy_data:
  caddy_config:
```

`.env`:

```dotenv
# This name must resolve to this Docker host before Caddy starts.
MAP_HOSTNAME=map.example.org
ACME_EMAIL=admin@example.org

POLL_INTERVAL_MS=15000
LOG_LEVEL=info

# Change these when the host requires its own DNS resolvers.
DNS_PRIMARY=1.1.1.1
DNS_SECONDARY=1.0.0.1

# Path to the JSON file next to this .env file. Compose mounts it read-only.
RENDER_SERVERS_CONFIG_FILE=./server-config.json
```

`server-config.json` contains the server array. `ip` and `port` identify the
stable tile directory; `baseUrl` is the Rising World HTTP endpoint:

```json
[
  {
    "ip": "203.0.113.10",
    "port": 4355,
    "baseUrl": "http://203.0.113.10:4354",
    "name": "My Rising World server",
    "timeoutMs": 5000,
    "retryAttempts": 2,
    "retryBackoffMs": 1000
  }
]
```

Create `empty.png` beside the Compose file. It must be a transparent 1×1 PNG:

```sh
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL3NwAAAABJRU5ErkJggg==' | base64 -d > empty.png
```

`Caddyfile`:

```caddyfile
{
    email {$ACME_EMAIL}
}

{$MAP_HOSTNAME} {
    # Keep renderer cache and cursors private.
    @rendererState path /.state /.state/*
    respond @rendererState 404

    root * /srv
    # Preserve the file server's ETag and require conditional revalidation.
    # RW Manager redraws only tiles around online players, avoiding timestamp
    # query strings and full PNG transfers when a tile is unchanged.
    header {
        Cache-Control "no-cache"
    }

    # A map may legitimately not have rendered every requested Leaflet tile.
    # Only missing server/zoom/x/z PNGs receive the transparent fallback;
    # .state and every other missing path remain a real 404.
    @mapTile path_regexp mapTile ^/[^/]+/[0-9]+/-?[0-9]+/-?[0-9]+\.png$
    handle @mapTile {
        try_files {path} /empty.png
        file_server {
            precompressed gzip zstd
        }
    }

    file_server {
        precompressed gzip zstd
    }
}
```

Start and inspect the stack:

```sh
docker compose up -d
docker compose logs -f renderer web
docker compose ps
```

Caddy obtains and renews the TLS certificate automatically. If the log shows
DNS failures while requesting the certificate, first verify that the Docker
host has working DNS and outbound HTTPS; set `DNS_PRIMARY` and `DNS_SECONDARY`
to resolvers reachable from that host if necessary.

### Connect the rendered map

The renderer creates `metadata.json` and tiles beneath a deterministic server
directory. Calculate it from the exact `ip` and `port` in
`server-config.json` (not from `baseUrl`):

```sh
printf '203.0.113.10:4355' | sha256sum | cut -c1-24
# prepend "server-" to the result
```

Then verify the published metadata:

```sh
curl -fsS https://map.example.org/<server-id>/metadata.json
```

To let RW Manager use a separately hosted renderer, set Admin Utils'
`general.nativeMapUrl` for that world to the complete server-specific URL:

```text
https://map.example.org/<server-id>
```

The backend then requests `<mapUrl>/metadata.json` and uses the tile URL
contained there. Consequently, the backend and tiles may be hosted on entirely
different machines. Do not set `nativeMapUrl` to the generic host root when
several worlds share the renderer.

Run only one renderer instance per Rising World server. Multiple renderers
polling the same source create redundant native-route traffic and race on their
own render state.

To stop the stack while retaining tiles and certificates:

```sh
docker compose down
```

Use `docker compose down -v` only when the rendered tiles and Caddy's ACME
data should be discarded.

## How it works

The renderer polls one or more configured servers through Rising World's native Admin Utils route:

```text
GET <baseUrl>/plugins/oz---admin-utils/map?lastChange=<cursor>
```

Install an Admin Utils version supporting public terrain exports and enable
`exposeMapData=true` in its world settings (the current default). Point `baseUrl`
at the Rising World HTTP server, including its HTTP port. The renderer fetches
terrain directly without a Manager backend, pairing or an Authorization header.
`exposeMapData=false` makes the route return 404; other plugin routes remain
subject to their own authentication. No player-position or server-config route
is needed to render terrain. Ensure the game HTTP server is reachable from the
renderer. To stop public terrain downloads, disable map exposure.

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
| `RENDER_SERVERS_CONFIG_FILE` | required | Path to the server-config JSON file. In Docker Compose it is mounted read-only at `/app/config/server-config.json`. |
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
