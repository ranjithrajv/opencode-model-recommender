# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-08

### Added

- `models_recommend` tool — ranks models by cache ratio, token cost, session cost
- `model-details` tool — price breakdown for a specific model
- `/recommend-models` and `/model-details` slash commands
- Sidebar widget showing best models by session cost, cache ratio, token cost
- Provider filter picker (All / per-provider) with persistence
- Providers default to connected providers discovered from auth.json (new providers appear without code changes)

[Unreleased]: https://github.com/ranjithraj/opencode-model-recommender/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ranjithraj/opencode-model-recommender/releases/tag/v0.1.0
