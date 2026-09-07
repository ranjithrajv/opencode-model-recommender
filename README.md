# opencode-model-recommender

An [OpenCode](https://opencode.ai) plugin that recommends the best models on
**OpenCode Zen** (`opencode`) and **OpenCode Go** (`opencode-go`) using live
catalog pricing.

## Metrics

- **Cache ratio** — cache-read price ÷ input price. Higher = cached context
  (the bulk of agent traffic) is relatively cheaper.
- **Token cost** — blended $/1M tokens: `0.7 × input + 0.3 × output`
  (agent traffic is input-heavy).
- **Session cost** — estimated cost of a representative coding session:
  400k input tokens (80% cache reads, 20% cache writes) + 50k output tokens.

## Usage

Once loaded, the plugin provides:

- **`models_recommend` tool** — call with `{ sort: "cacheRatio" | "tokenCost" | "sessionCost", providers?, limit?, free?, session? }`.
- **`models_details` tool** — price breakdown for one model (defaults to the current model).
- **`/recommend-models` command** — asks the agent to run the tool and present three rankings, plus how your current model compares.
- **`/model-details` command** — price breakdown for the current model (or pass `<providerID> <modelID>`).
- **`/model-view` command** — pick which providers the sidebar picks cover (All / Zen / Go); persisted across restarts.

The sidebar widget shows the top picks, free models, and whether your current
model is already the cheapest — or how much you'd save per session by switching.

### Session-cost assumptions

Session cost assumes 400k input tokens (80% cache reads) + 50k output tokens.
Override per call:

```json
{ "sort": "sessionCost", "session": { "freshInput": 200000, "cacheReadShare": 0.6, "output": 30000 } }
```

## Screenshot

Sidebar widget:

![Model picks sidebar](docs/screenshot.png)

<!-- To capture: install the plugin, open opencode2's TUI, and screenshot the sidebar; save as docs/screenshot.png -->


## Install (project-local)

```sh
cp -r opencode-model-recommender .opencode/plugins/
opencode2 service restart
```

## Install (global / package)

```sh
opencode2 plugin add ./opencode-model-recommender   # or publish to npm and add the name
```

Or in `opencode.jsonc`:

```jsonc
{ "plugins": ["./opencode-model-recommender"] }
```

## Extending to other providers

Edit `DEFAULT_PROVIDERS` in `index.ts` (e.g. `["opencode", "opencode-go", "openai", "anthropic"]`)
or pass `providers` per call — no code change needed for ad-hoc lookups.

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).
