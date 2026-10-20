# Apache/PHP archive tile server

Copy `.htaccess` and `archive-tile.php` into the public tile root. The renderer
publishes `server-<id>/metadata.json`, optional satellite metadata, and ZIP
archives at `server-<id>/<z>/<x>.zip` or
`server-<id>/satellite/<z>/<x>.zip`. Apache maps the existing PNG URLs to PHP;
metadata JSON remains a static file. PHP requires the ZIP extension.

Upload these two example files separately from the renderer. The renderer only
publishes the per-server trees and does not modify files at the web root.
Keep `PUBLISH_MODE=archive` on the renderer. Set `SFTP_TARGET` or
`RSYNC_TARGET` as described in the main README. A plain static server cannot
serve the archive mode without an equivalent tile reader or a client that
reads ZIPs directly.
