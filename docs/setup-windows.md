# Native Windows setup

This guide runs the renderer and Caddy directly on Windows, without Docker.
The renderer polls Rising World's public Admin Utils terrain route; Caddy
publishes only the generated tiles.

## Prerequisites

- Node.js 24.x (includes Corepack) and Git for Windows.
- Caddy for Windows. `rsync` and an SSH client are required only when using
  `RSYNC_TARGET`; install a Windows-compatible rsync implementation in that
  case.
- Network access from this computer to the Rising World HTTP server.
- Admin Utils 0.10.2 or later with `exposeMapData=true` for each world. This
  deliberately exposes terrain data; do not enable it for a private map.
- For public HTTPS, a public DNS `A`/`AAAA` record such as `map.example.org`
  pointing to this computer. TCP ports 80 and 443 must reach it and must not be
  claimed by another web server.

Use an elevated PowerShell only for firewall rules or a Caddy service. The
renderer itself should run as an ordinary dedicated Windows account.

## Install and build

The following example uses `C:\RWMapRendering` for the application and
`C:\RWMapTiles` for generated data.

```powershell
git clone https://github.com/devidian/rw-map-rendering.git C:\RWMapRendering
Set-Location C:\RWMapRendering
corepack enable
corepack yarn install --immutable
corepack yarn build
New-Item -ItemType Directory -Force C:\RWMapTiles
```

Create `C:\RWMapRendering\.env.local`:

```dotenv
HOST=127.0.0.1
PORT=3000
MAP_ROOT_DIR=C:/RWMapTiles
POLL_INTERVAL_MS=15000
LOG_LEVEL=info
RENDER_SERVERS_CONFIG_FILE=C:/RWMapRendering/server-config.json
```

Create `C:\RWMapRendering\server-config.json`. Its `ip` and `port` determine
the stable tile directory; `baseUrl` is the game HTTP endpoint:

```json
[
  { "ip": "203.0.113.10", "port": 4355, "baseUrl": "http://203.0.113.10:4354", "name": "My Rising World server", "timeoutMs": 5000, "retryAttempts": 2, "retryBackoffMs": 1000 }
]
```

Restrict access to `.env.local` if it contains an rsync key path or other local
secrets.

Start it in the foreground for the first check:

```powershell
Set-Location C:\RWMapRendering
node --env-file=.env.local dist/index.js
```

In another PowerShell window, confirm the local health endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
```

Stop the foreground process with `Ctrl+C` after the check.

## Run automatically with Task Scheduler

Create `C:\RWMapRendering\start-renderer.cmd`:

```bat
@echo off
cd /d C:\RWMapRendering
node --env-file=.env.local dist\index.js
```

In Task Scheduler, create a task with these settings:

- Run whether the user is logged on or not, using the dedicated account.
- Trigger: At startup.
- Action: start `C:\RWMapRendering\start-renderer.cmd`.
- Start in: `C:\RWMapRendering`.
- Enable “Restart the task if it fails”, with a five-minute retry interval.

Keep `HOST=127.0.0.1`: Caddy is the public endpoint, while the renderer health
server remains local.

## Publish tiles with Caddy

Extract `caddy.exe` to `C:\Caddy` and create `C:\Caddy\Caddyfile`:

```caddyfile
map.example.org {
    # Never publish render cursors or the source cache.
    @rendererState path /.state /.state/*
    respond @rendererState 404

    root * C:/RWMapTiles
    header {
        Cache-Control "no-cache"
    }
    file_server {
        precompressed gzip zstd
    }
}
```

Replace `map.example.org` with the DNS name. Test Caddy from an elevated
PowerShell:

```powershell
Set-Location C:\Caddy
.\caddy.exe validate --config .\Caddyfile
.\caddy.exe run --config .\Caddyfile
```

Allow inbound web traffic if Windows Firewall is enabled:

```powershell
New-NetFirewallRule -DisplayName 'RW map HTTPS' -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow
```

For automatic Caddy startup, create a second Task Scheduler task using the
same account, triggered at startup, with program `C:\Caddy\caddy.exe` and
arguments `run --config C:\Caddy\Caddyfile`. Caddy stores its certificate data
under the service account's application-data directory; retain that directory
across upgrades so certificate renewal continues normally.

Caddy automatically obtains and renews a Let's Encrypt certificate when DNS
and ports 80/443 are reachable. For a private network, use an internal Caddy
hostname or serve `C:\RWMapTiles` through an existing internal web server
instead of opening public ports.

## Connect RW Manager

Calculate the server directory from the exact `ip` and `port` in the renderer
configuration:

```powershell
$bytes = [Text.Encoding]::UTF8.GetBytes('203.0.113.10:4355')
$hash = [Security.Cryptography.SHA256]::HashData($bytes)
$id = -join ($hash | ForEach-Object { $_.ToString('x2') })
"server-$($id.Substring(0, 24))"
```

Verify the published metadata:

```powershell
Invoke-RestMethod https://map.example.org/<server-id>/metadata.json
```

Set Admin Utils `general.nativeMapUrl` to the complete server-specific URL, for
example `https://map.example.org/<server-id>`. Do not set it to the generic
host root when multiple worlds share the renderer. Run only one renderer per
Rising World server.

For upgrades, stop the renderer task, update the checkout, run `corepack yarn
install --immutable` and `corepack yarn build`, then start the task again.
Preserve `C:\RWMapTiles` so cursors and generated tiles survive the update.
