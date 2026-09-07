# Changelog

## [0.1.0] - 2026-09-07

### Added

- `models_recommend` tool ranking OpenCode Zen (`opencode`) and OpenCode Go (`opencode-go`) models by cache ratio, token cost, or estimated session cost.
- `/recommend-models` command asking the agent to present the three rankings in-session.
- Sidebar widget ("MODEL PICKS") showing the cheapest session, best cache ratio, cheapest token cost, and free-model picks, plus the current default model.
- Optional `sort` (defaults to `sessionCost`), `providers`, `limit`, and `free` parameters on the tool.

### Changed

- Licensed under the GNU Affero General Public License v3.0.
