# Tile publication
<!-- codemap-id: rw-map-rendering/publication -->

## Responsibility

Publish generated tiles and metadata using configured archive, rsync or SFTP paths.

## Source and tests

- [Archive publisher](../../src/service/archive-publisher.ts), [rsync publisher](../../src/service/rsync-publisher.ts), and [SFTP publisher](../../src/service/sftp-publisher.ts) implement publication.
- [Configuration](../../src/utils/app-config.ts) selects output and publication. [Publisher tests](../../tests/archive-publisher.test.ts) and [rsync tests](../../tests/rsync-publisher.test.ts) exercise delivery.
