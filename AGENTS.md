# AGENTS.md

## Repository Purpose

This repository owns standalone Rising World map rendering.

It polls configured plugin bridge or future native plugin routes, renders PNG map tiles, and writes them under `<map-root-dir>/<server-id>/...`.

## Ownership

Owns:

- map data polling from `/plugins/ozadminutils/map`
- map source DTO validation and decoding
- PNG tile rendering
- render cursor/state persistence
- optional tile publication integration
- Docker deployment behavior

Does not own:

- manager frontend API behavior
- transitional plugin bridge behavior
- in-game plugin business logic
- workspace-root orchestration rules

## Mandatory Workflow Rules

- Use Yarn, not npm or pnpm.
- Preserve the configured Node.js LTS baseline and keep `package.json`, Docker, CI, and docs aligned when runtime changes.
- Keep TypeScript files in kebab-case.
- Keep rendering deterministic for identical map input.
- Do not advance render cursors when rendering fails.

## Validation

- Run `yarn build` for build-impacting changes.
- Run `yarn test` when tests are present or behavior changes.
- Run Docker build when deployment behavior changes.
