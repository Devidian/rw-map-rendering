# Native Linux setup

This guide runs the renderer and Caddy directly on a Linux host, without
Docker. The renderer polls Rising World's public Admin Utils terrain route;
Caddy publishes only the generated tiles.

## Prerequisites

- Node.js 24.x and Corepack.
- Git, Caddy, and (only when `RSYNC_TARGET` is used) `rsync` plus
  `openssh-client`.
- A public DNS `A`/`AAAA` record such as `map.example.org` pointing to this
  host when HTTPS is required. TCP ports 80 and 443 must reach this host.
- Network access from this host to the Rising World HTTP server.
- Admin Utils 0.10.2 or later with `exposeMapData=true` for every rendered
  world. This exposes terrain data; do not enable it for a private map.

The commands below use `/opt/rw-map-rendering` for the application and
`/var/lib/rw-map-rendering/tiles` for generated data. Adjust them consistently
if another location is preferred.

## Install and build

```sh
sudo install -d -o "$USER" -g "$USER" /opt/rw-map-rendering
git clone https://github.com/devidian/rw-map-rendering.git /opt/rw-map-rendering
cd /opt/rw-map-rendering
corepack enable
corepack yarn install --immutable
corepack yarn build

sudo install -d -o "$USER" -g "$USER" /var/lib/rw-map-rendering/tiles
```

Create `/opt/rw-map-rendering/.env.local` with restrictive permissions:

```dotenv
HOST=127.0.0.1
PORT=3000
MAP_ROOT_DIR=/var/lib/rw-map-rendering/tiles
POLL_INTERVAL_MS=15000
LOG_LEVEL=info
RENDER_SERVERS_CONFIG_FILE=/opt/rw-map-rendering/server-config.json
```

Create `/opt/rw-map-rendering/server-config.json`. Its `ip` and `port`
determine the stable tile directory; `baseUrl` is the game HTTP endpoint:

```json
[
  { "ip": "203.0.113.10", "port": 4355, "baseUrl": "http://203.0.113.10:4354", "name": "My Rising World server", "timeoutMs": 5000, "retryAttempts": 2, "retryBackoffMs": 1000 }
]
```

```sh
chmod 600 /opt/rw-map-rendering/.env.local
cd /opt/rw-map-rendering
node --env-file=.env.local dist/index.js
```

In a second terminal, confirm that the local health endpoint is available:

```sh
curl -fsS http://127.0.0.1:3000/health
```

Stop the foreground process with `Ctrl+C` after the check.

## Start on boot with systemd

Create a dedicated service account and give it ownership of the tile directory:

```sh
sudo useradd --system --home /opt/rw-map-rendering --shell /usr/sbin/nologin rw-map-rendering
sudo chown -R rw-map-rendering:rw-map-rendering /opt/rw-map-rendering /var/lib/rw-map-rendering
```

Create `/etc/systemd/system/rw-map-rendering.service`:

```ini
[Unit]
Description=Rising World map renderer
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=rw-map-rendering
Group=rw-map-rendering
WorkingDirectory=/opt/rw-map-rendering
ExecStart=/usr/bin/node --env-file=/opt/rw-map-rendering/.env.local /opt/rw-map-rendering/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Verify the Node path with `command -v node` and replace `/usr/bin/node` if
needed. Then enable and inspect the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now rw-map-rendering
sudo systemctl status rw-map-rendering
journalctl -u rw-map-rendering -f
```

## Publish tiles with Caddy

Install Caddy using its official package instructions for the distribution, then
create `/etc/caddy/Caddyfile`:

```caddyfile
map.example.org {
    # Never publish render cursors or the source cache.
    @rendererState path /.state /.state/*
    respond @rendererState 404

    root * /var/lib/rw-map-rendering/tiles
    header {
        Cache-Control "no-cache"
    }
    file_server {
        precompressed gzip zstd
    }
}
```

Replace `map.example.org` with the DNS name. Caddy automatically obtains and
renews a Let's Encrypt certificate when DNS and ports 80/443 are reachable.
Reload and check its configuration:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

If this host is only on a private network, use an internal Caddy hostname or
place the same static-directory rule behind the existing reverse proxy instead
of exposing public ports.

## Connect RW Manager

Calculate the server directory from the exact `ip` and `port` used above:

```sh
printf '203.0.113.10:4355' | sha256sum | cut -c1-24
```

Prepend `server-`, then verify the published metadata:

```sh
curl -fsS https://map.example.org/<server-id>/metadata.json
```

Set Admin Utils `general.nativeMapUrl` to the full server-specific URL, for
example `https://map.example.org/<server-id>`. Do not use the generic host root
when one renderer serves multiple worlds. Run only one renderer per Rising
World server.

For upgrades, stop the service, update the checkout, run `corepack yarn install
--immutable` and `corepack yarn build`, then start it again. Preserve the tile
directory so cursors and generated tiles survive the update.
