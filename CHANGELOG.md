# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0-alpha.5] - 2026-09-27

### Fixed

- `@opencode/plugin` is now a real dependency instead of a peer. The plugin
  calls `Plugin.define()`, which is a runtime function, so a peer-only
  declaration left `@opencode/plugin` uninstalled — installing this package
  produced a plugin that failed to load with `Cannot find module
'@opencode/plugin'`. Pinned to `^2.0.15` so the host the runtime provides is
  the one that gets used.
- `opencode-plugin-kit` moved to `dependencies` for the same reason: it is
  imported at runtime, not just for types.
- `solid-js` moved from a peer to a dependency. The kit's barrel export pulls
  in `createSignal`/`createResource` from it, and `tui.tsx` imports `For`/`Show`
  directly, so a peer-only declaration left it uninstalled.
- Added the `/** @jsxImportSource @opentui/solid */` pragma to `tui.tsx`. Bun
  ignores `tsconfig.json` inside `node_modules`, so without the file-level
  pragma it fell back to React's JSX runtime and the TUI entrypoint failed to
  load with `Cannot find package 'react'`.

## [1.0.0-alpha.4] - 2026-09-27

### Breaking

- Requires an OpenCode v2 host. The TUI/context types moved from the legacy
  `@opencode-ai/plugin` package to `@opencode/plugin@^2.0.15`, so this plugin
  no longer loads on a v1 runtime.

### Changed

- Sidebar rendering and keymap wiring use the v2 `ui.slot` / `keymap.layer`
  contract. Slot ownership is claimed before render so the widget anchors
  correctly in the sidebar.
- Provider discovery now reads connected providers from the host's integration
  list rather than scraping `auth.json`, so newly connected providers appear
  without a code change.

## [0.1.0] - 2026-09-08

### Added

- `models_recommend` tool — ranks models by cache ratio, token cost, session cost
- `model-details` tool — price breakdown for a specific model
- `/recommend-models` and `/model-details` slash commands
- Sidebar widget showing best models by session cost, cache ratio, token cost
- Provider filter picker (All / per-provider) with persistence
- Providers default to connected providers discovered from auth.json (new providers appear without code changes)

[Unreleased]: https://github.com/ranjithraj/opencode-model-recommender/compare/v1.0.0-alpha.5...HEAD
[1.0.0-alpha.5]: https://github.com/ranjithraj/opencode-model-recommender/releases/tag/v1.0.0-alpha.5
[1.0.0-alpha.4]: https://github.com/ranjithraj/opencode-model-recommender/releases/tag/v1.0.0-alpha.4
[0.1.0]: https://github.com/ranjithraj/opencode-model-recommender/releases/tag/v0.1.0
