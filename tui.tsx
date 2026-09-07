import { Plugin, usePlugin } from "@opencode-ai/plugin/tui"
import { createResource, For, Show } from "solid-js"
import {
  asArray,
  availableProviders,
  createViewPicker,
  line,
  providerLabel,
  providerTitle,
  short,
  type PickerOption,
} from "opencode-plugin-kit"
import { metrics, savings, sessionBasis, SESSION, type CostTier } from "./metrics.js"

type Row = {
  providerID: string
  modelID: string
  name: string
  cacheRatio: number | null
  tokenCost: number | null
  sessionCost: number | null
  free: boolean
}

// ---------------------------------------------------------------------------
// Provider filter registry — the single extension point, mirroring the
// usage-quota plugin's VIEWS: adding a provider means appending one entry,
// and the picker, slash command, persistence, and widget renderer all derive
// from it.
// ---------------------------------------------------------------------------

interface ProviderFilter extends PickerOption {
  /** Provider IDs included in this view; empty = all. */
  readonly providers: string[]
}

// One filter per authenticated provider, plus "All". Built from the same
// discovery call the tool uses, so new providers appear without edits.
// Ids are the short labels (zen/go/google/zai/hf) — legacy persisted picks
// ("zen", "go") still resolve.
function buildFilters(): ProviderFilter[] {
  return [
    { id: "all", title: "All", description: "Picks across all authenticated providers", providers: [] },
    ...availableProviders().map((pid) => ({
      id: providerLabel(pid),
      title: providerTitle(pid),
      description: `${providerTitle(pid)} models only`,
      providers: [pid],
    })),
  ]
}

type CurrentModel = { providerID: string; modelID: string } | undefined

/** Resolve the model the session is actually using from its last assistant message. */
function currentFromSession(context: any, sessionID?: string): CurrentModel {
  if (!sessionID) return undefined
  try {
    const messages = context.data.session.message.list(sessionID) ?? []
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = (messages[i] as any)?.info ?? messages[i]
      if (m?.role !== "assistant") continue
      const providerID = String(m?.model?.providerID ?? m?.providerID ?? "")
      const modelID = String(m?.model?.id ?? m?.modelID ?? m?.id ?? "")
      if (providerID && modelID) return { providerID, modelID }
    }
  } catch {}
  return undefined
}

export default Plugin.define({
  id: "model-recommender.cli",
  setup(context: any) {
    const picker = createViewPicker(context, {
      registry: buildFilters(),
      storageKey: "filter",
      command: {
        id: "models.view",
        group: "Models",
        name: "model-view",
        aliases: ["models-view"],
        title: (f) => `Model picks: provider filter (${f.title})`,
        description: "Pick which providers the sidebar model recommendations cover",
      },
      dialog: { title: "Model picks", message: "Choose which providers the sidebar picks cover" },
      toastPrefix: "Model picks",
    })
    picker.registerCommand()

    function Picks(props: { sessionID?: string }) {
      const ctx = usePlugin()
      const [picks] = createResource(
        () => props.sessionID,
        async (sid) => {
          const out = await ctx.client.model.list()
          const models = asArray<any>(out)
          const rows: Row[] = models
            .filter((m) => availableProviders().includes(m.providerID) && m.enabled !== false)
            .map((m) => ({
              providerID: m.providerID,
              modelID: m.modelID ?? m.id,
              name: m.name ?? m.modelID ?? m.id,
              ...metrics(m.cost as CostTier[] | undefined),
            }))
          const sessionCurrent = currentFromSession(ctx, sid)
          const current = sessionCurrent
            ? { data: sessionCurrent }
            : await ctx.client.model.default().catch(() => undefined)
          return { rows, current }
        },
      )

      return (
        <Show when={!picks.error} fallback={<text>⚠ model picks unavailable</text>}>
          <Show when={picks()} fallback={<text>model picks: loading…</text>}>
            {(p) => {
              // Apply the active provider filter, then derive picks.
              const active = picker.current()
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

              const row = (label: string, r: Row | undefined, value: string | undefined): string =>
                r ? line(label, r.modelID, r.providerID, value, idWidth) : ""

              const lines = [
                `MODEL PICKS · ${active.title.toLowerCase()}${active.providers.length === 0 ? " (all)" : ""}`,
                row("sess$", b.session, b.session ? `$${b.session.sessionCost?.toFixed(2)}` : undefined),
                row("cache", b.cache, b.cache ? `${b.cache.cacheRatio?.toFixed(2)}x` : undefined),
                row("token", b.token, b.token ? `$${b.token.tokenCost?.toFixed(3)}/M` : undefined),
                ...free.slice(0, 3).map((r) => row("free", r, undefined)),
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
      render: ({ sessionID }: { sessionID?: string }) => <Picks sessionID={sessionID} />,
    })
  },
})
