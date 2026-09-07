import { Plugin, usePlugin } from "@opencode-ai/plugin/tui"
import { createResource, createSignal, For, Show } from "solid-js"
import { metrics, savings, sessionBasis, SESSION, type CostTier } from "./metrics.js"

const DEFAULT_PROVIDERS = ["opencode", "opencode-go"]

type Row = {
  providerID: string
  modelID: string
  name: string
  cacheRatio: number | null
  tokenCost: number | null
  sessionCost: number | null
  free: boolean
}

function short(id: string, max = 24): string {
  return id.length > max ? id.slice(0, max - 1) + "…" : id
}

function providerLabel(pid: string): string {
  if (pid === "opencode") return "zen"
  if (pid === "opencode-go") return "go"
  return pid
}

// ---------------------------------------------------------------------------
// Provider filter registry — the single extension point, mirroring the
// usage-quota plugin's VIEWS: adding a provider means appending one entry,
// and the picker, slash command, persistence, and widget renderer all derive
// from it.
// ---------------------------------------------------------------------------

type FilterID = "all" | "zen" | "go"

interface ProviderFilter {
  readonly id: FilterID
  readonly title: string
  readonly description: string
  /** Provider IDs included in this view; empty = all. */
  readonly providers: string[]
}

const FILTERS: ProviderFilter[] = [
  { id: "all", title: "All", description: "Picks across Zen and Go", providers: [] },
  { id: "zen", title: "Zen", description: "OpenCode Zen models only", providers: ["opencode"] },
  { id: "go", title: "Go", description: "OpenCode Go models only", providers: ["opencode-go"] },
]

export default Plugin.define({
  id: "model-recommender.cli",
  setup(context: any) {
    // Persisted provider filter: survives TUI restarts, same pattern as the
    // usage plugin's view store.
    const [filter, setFilter] = createSignal<FilterID>("all")
    try {
      const [store] = context.storage.store("filter", { initial: { filter: "all" as FilterID } })
      if (FILTERS.some((f) => f.id === store.filter)) setFilter(store.filter)
    } catch {
      // In-memory only.
    }
    const applyFilter = (next: FilterID) => {
      if (next === filter()) return
      setFilter(next)
      try {
        const [store] = context.storage.store("filter", { initial: { filter: "all" as FilterID } })
        store.filter = next
      } catch {
        // In-memory only.
      }
      try {
        context.ui.toast.show({
          message: `Model picks: ${FILTERS.find((f) => f.id === next)?.title ?? next} view`,
          variant: "success",
        })
      } catch {
        // Toast unavailable; the widget still re-renders.
      }
    }

    // Picker over the registry; a non-empty argument selects directly
    // (e.g. `/model-view zen`).
    const pickFilter = async (arg?: string) => {
      const wanted = arg?.trim().toLowerCase()
      if (wanted) {
        const match = FILTERS.find((f) => f.id === wanted || f.title.toLowerCase() === wanted)
        if (match) return applyFilter(match.id)
        try {
          await context.ui.dialog.alert({
            title: "Model picks",
            message: `Unknown view "${arg}". Available: ${FILTERS.map((f) => f.id).join(", ")}`,
          })
        } catch {
          // Dialog unavailable.
        }
        return
      }
      try {
        const selected = await context.ui.dialog.select({
          title: "Model picks",
          message: "Choose which providers the sidebar picks cover",
          current: filter(),
          options: FILTERS.map((f) => ({
            title: f.title,
            value: f.id,
            description: f.description,
            disabled: false,
          })),
        })
        if (selected) applyFilter(selected as FilterID)
      } catch {
        // Dialog unavailable.
      }
    }

    // Keymap layers must be registered from a rendered slot (an empty `app`
    // contribution); a layer registered directly in setup() never activates —
    // same as the usage-quota plugin.
    context.ui.slot({
      append: "app",
      render: () => {
        try {
          context.keymap.layer(() => ({
            mode: "global",
            priority: 10,
            commands: [
              {
                id: "models.view",
                title: `Model picks: provider filter (${FILTERS.find((f) => f.id === filter())?.title})`,
                description: "Pick which providers the sidebar model recommendations cover",
                group: "Models",
                palette: true,
                slash: { name: "model-view", aliases: ["models-view"], arguments: true },
                suggested: true,
                run: (input?: string) => {
                  void pickFilter(input)
                },
              },
            ],
          }))
        } catch (err) {
          console.warn("opencode-model-recommender: keymap.layer unavailable", err)
        }
        return null
      },
    })

    function Picks() {
      const ctx = usePlugin()
      const [picks] = createResource(async () => {
        const out = await ctx.client.model.list()
        const models: any[] = Array.isArray(out) ? (out as any) : ((out as any).data ?? [])
        const rows: Row[] = models
          .filter((m: any) => DEFAULT_PROVIDERS.includes(m.providerID) && m.enabled !== false)
          .map((m: any) => ({
            providerID: m.providerID,
            modelID: m.modelID ?? m.id,
            name: m.name ?? m.modelID ?? m.id,
            ...metrics(m.cost as CostTier[] | undefined),
          }))
        const current = await ctx.client.model.default().catch(() => undefined)
        return { rows, current }
      })

      return (
        <Show when={!picks.error} fallback={<text>⚠ model picks unavailable</text>}>
          <Show when={picks()} fallback={<text>model picks: loading…</text>}>
            {(p) => {
              // Apply the active provider filter, then derive picks.
              const active = FILTERS.find((f) => f.id === filter())!
              const scoped = active.providers.length
                ? p().rows.filter((r) => active.providers.includes(r.providerID))
                : p().rows
              if (scoped.length === 0) {
                return (
                  <box flexDirection="column">
                    <text>MODEL PICKS · {active.title.toLowerCase()}</text>
                    <text>no models for this provider</text>
                  </box>
                )
              }
              const paid = scoped.filter((r) => !r.free)
              const free = scoped.filter((r) => r.free).toSorted((a, b) => a.name.localeCompare(b.name))
              const b = {
                session: paid.toSorted((a, b) => (a.sessionCost ?? Infinity) - (b.sessionCost ?? Infinity))[0],
                cache: paid.toSorted((a, b) => (b.cacheRatio ?? -1) - (a.cacheRatio ?? -1))[0],
                token: paid.toSorted((a, b) => (a.tokenCost ?? Infinity) - (b.tokenCost ?? Infinity))[0],
              }

              const cur = p().current?.data
              const curScoped = cur && (active.providers.length === 0 || active.providers.includes(cur.providerID))
              const currentRow = curScoped
                ? scoped.find((r) => r.providerID === cur!.providerID && r.modelID === cur!.modelID)
                : undefined
              const save = currentRow ? savings(currentRow.sessionCost, b.session?.sessionCost) : undefined
              const currentMatchesSession = !!cur && !!b.session && cur.modelID === b.session.modelID

              // Dynamic column width so nothing silently truncates.
              const shown = [b.session, b.cache, b.token, ...free.slice(0, 3)].filter(Boolean) as Row[]
              const idWidth = Math.min(Math.max(10, ...shown.map((r) => short(r.modelID).length)), 30)

              const line = (label: string, r: Row | undefined, value: string | undefined): string => {
                if (!r) return ""
                const v = value ? ` ${value}` : ""
                const tag = `(${providerLabel(r.providerID)})`
                return `${label.padEnd(6)} ${short(r.modelID, idWidth).padEnd(idWidth)} ${tag}${v}`
              }

              const lines = [
                `MODEL PICKS · ${active.title.toLowerCase()}${active.providers.length === 0 ? " (zen+go)" : ""}`,
                line("sess$", b.session, b.session ? `$${b.session.sessionCost?.toFixed(2)}` : undefined),
                line("cache", b.cache, b.cache ? `${b.cache.cacheRatio?.toFixed(2)}x` : undefined),
                line("token", b.token, b.token ? `$${b.token.tokenCost?.toFixed(3)}/M` : undefined),
                ...free.slice(0, 3).map((r) => line("free", r, undefined)),
                free.length > 3 ? `       +${free.length - 3} more free` : "",
                "─".repeat(40),
                save !== null && save !== undefined
                  ? `💡 save ~$${save.toFixed(2)}/session → ${short(b.session?.modelID ?? "", idWidth)}`
                  : currentMatchesSession
                    ? "✅ current model is the cheapest"
                    : "",
                curScoped && cur
                  ? `now    ${short(cur.modelID, idWidth)} (${providerLabel(cur.providerID)})${currentMatchesSession ? " ✅" : ""}`
                  : "",
                `basis  ${sessionBasis(SESSION)}`,
              ].filter(Boolean)

              return (
                <box flexDirection="column">
                  <For each={lines}>{(l) => <text>{l}</text>}</For>
                </box>
              )
            }}
          </Show>
        </Show>
      )
    }

    return context.ui.slot({
      append: "sidebar.content",
      render: () => <Picks />,
    })
  },
})
