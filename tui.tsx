/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal, For, Show } from "solid-js"
import {
  asArray,
  availableProviders,
  createCachedResource,
  createCachedStore,
  createViewPicker,
  line,
  providerLabel,
  providerTitle,
  resolveCurrentModel,
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

/** Width assumed until the first layout pass measures the real sidebar. */
const FALLBACK_WIDTH = 40

/** Per-side padding the host reserves around slot content. */
const GUTTER = 2

/** Non-negotiable width of a rendered row: label, id column and provider tag. */
const MIN_ROW = 12

/** Widest the model-id column ever grows, regardless of sidebar size. */
const MAX_ID = 30

/**
 * Usable content width for a measured sidebar width. `avail` is 0 until the
 * first layout pass lands, in which case the fallback keeps today's layout.
 */
export function budgetFor(avail: number): number {
  return Math.max(MIN_ROW, (avail > 0 ? avail : FALLBACK_WIDTH) - GUTTER)
}

/**
 * Model-id column width for a row budget. `wanted` is the width the ids would
 * like; the rest of the row (6-char label, spaces, `(tag)`) is paid for first so
 * the row cannot spill past the sidebar and wrap onto a second line.
 */
export function columnFor(budget: number, wanted: number): number {
  return Math.min(wanted, MAX_ID, Math.max(6, budget - 18))
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
export function buildFilters(): ProviderFilter[] {
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

    // Durable cache of the catalog picks: the sidebar restores the last known
    // view instantly after a TUI restart (stale-while-revalidate) instead of
    // showing "loading…" until the catalog refetch completes.
    type PicksData = { rows: Row[]; current: { data?: { providerID: string; modelID: string } | null } | undefined }
    const picksCache = createCachedStore<PicksData | null>(context, "picks", {
      initial: null,
      staleAfterMs: 5 * 60_000,
    })

    async function loadPicks(ctx: any, sid?: string): Promise<PicksData> {
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
      const sessionCurrent = resolveCurrentModel(ctx, sid)
      const current = sessionCurrent
        ? { data: sessionCurrent }
        : await ctx.client.model.default().catch(() => undefined)
      return { rows, current }
    }

    function Picks(props: { sessionID?: string }) {
      const ctx = usePlugin()
      // The sidebar slot publishes only { sessionID } — no width — so measure the
      // laid-out box instead. `layout-changed` is emitted from calculateLayout()
      // on every relayout (including terminal resize) and carries no payload,
      // so the handler just re-reads the element's current width.
      const [avail, setAvail] = createSignal(0)
      let boxEl: { width?: number } | undefined
      const measure = () => setAvail(boxEl?.width ?? 0)
      const cached = createCachedResource(
        () => props.sessionID,
        (sid) => loadPicks(ctx, sid),
        { cache: picksCache },
      )
      const picks = cached.data

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
                  <box flexDirection="column" width="100%" overflow="hidden">
                    <text wrapMode="none" overflow="hidden">
                      MODEL PICKS · {active.title.toLowerCase()}
                    </text>
                    <text wrapMode="none" overflow="hidden">
                      no models for this provider
                    </text>
                  </box>
                )
              }
              const paid = scoped.filter((r) => !r.free)
              const free = scoped.filter((r) => r.free).toSorted((a, b) => a.name.localeCompare(b.name))
              // Paid rows always have numeric metrics, so the Infinity
              // fallbacks below are unreachable ordering hints only.
              /* v8 ignore start */
              const b = {
                session: paid.toSorted((a, b) => (a.sessionCost ?? Infinity) - (b.sessionCost ?? Infinity))[0],
                cache: paid.toSorted((a, b) => (a.cacheRatio ?? Infinity) - (b.cacheRatio ?? Infinity))[0],
                token: paid.toSorted((a, b) => (a.tokenCost ?? Infinity) - (b.tokenCost ?? Infinity))[0],
              }
              /* v8 ignore stop */

              const cur = p().current?.data
              const curScoped = cur && (active.providers.length === 0 || active.providers.includes(cur.providerID))
              const currentRow = curScoped
                ? scoped.find((r) => r.providerID === cur!.providerID && r.modelID === cur!.modelID)
                : undefined
              const save = currentRow ? savings(currentRow.sessionCost, b.session?.sessionCost) : undefined
              const currentMatchesSession = !!cur && !!b.session && cur.modelID === b.session.modelID

              // Dynamic column width so nothing silently truncates, then clamp
              // it to the measured sidebar so a row can never wrap onto a second
              // line.
              const shown = [b.session, b.cache, b.token, ...free.slice(0, 3)].filter(Boolean) as Row[]
              const budget = budgetFor(avail())
              const idWidth = columnFor(budget, Math.max(10, ...shown.map((r) => short(r.modelID).length)))

              const row = (label: string, r: Row | undefined, value: string | undefined): string =>
                r ? line(label, r.modelID, r.providerID, value, idWidth) : ""

              // Separator spans the usable width rather than a fixed 40 cells,
              // which wrapped onto the next line on narrow sidebars.
              const rule = "─".repeat(Math.max(1, budget))

              const lines = [
                `MODEL PICKS · ${active.title.toLowerCase()}${active.providers.length === 0 ? " (all)" : ""}`,
                row("sess$", b.session, b.session ? `$${b.session.sessionCost?.toFixed(2)}` : undefined),
                row("cache", b.cache, b.cache ? `${b.cache.cacheRatio?.toFixed(2)}x` : undefined),
                row("token", b.token, b.token ? `$${b.token.tokenCost?.toFixed(3)}/M` : undefined),
                ...free.slice(0, 3).map((r) => row("free", r, undefined)),
                free.length > 3 ? `       +${free.length - 3} more free` : "",
                rule,
                // save is a number or undefined, never null, and the save line
                // only renders when b.session exists — both guards are dead.
                /* v8 ignore start */
                save !== null && save !== undefined
                  ? `💡 save ~$${save.toFixed(2)}/session → ${short(b.session?.modelID ?? "", idWidth)}`
                  : currentMatchesSession
                    ? "✅ current model is the cheapest"
                    : "",
                /* v8 ignore end */
                curScoped && cur
                  ? `now    ${short(cur.modelID, idWidth)} (${providerLabel(cur.providerID)})${currentMatchesSession ? " ✅" : ""}`
                  : "",
                `basis  ${sessionBasis(SESSION)}`,
              ].filter(Boolean)

              return (
                <box
                  flexDirection="column"
                  width="100%"
                  overflow="hidden"
                  ref={(el: { width?: number }) => {
                    boxEl = el
                    measure()
                  }}
                  on:layout-changed={measure}
                >
                  <For each={lines}>
                    {(l) => (
                      <text wrapMode="none" overflow="hidden">
                        {l}
                      </text>
                    )}
                  </For>
                </box>
              )
            }}
          </Show>
        </Show>
      )
    }

    return context.ui.slot({
      before: "sidebar.footer",
      render: ({ sessionID }: { sessionID?: string }) => <Picks sessionID={sessionID} />,
    })
  },
})
