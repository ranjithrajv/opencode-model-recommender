# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/ranjithraj/opencode-model-recommender/compare/v1.0.0-alpha.4...HEAD
[1.0.0-alpha.4]: https://github.com/ranjithraj/opencode-model-recommender/releases/tag/v1.0.0-alpha.4
[0.1.0]: https://github.com/ranjithraj/opencode-model-recommender/releases/tag/v0.1.0
