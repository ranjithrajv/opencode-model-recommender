import { beforeEach, describe, expect, test, vi } from "vitest"

// Deterministic provider discovery: availableProviders() reads the real
// ~/.local/share/opencode/auth.json — partially mock the kit so the rest of
// its helpers stay real.
vi.mock("opencode-plugin-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("opencode-plugin-kit")>()),
  availableProviders: vi.fn(() => ["opencode", "opencode-go"]),
}))

import { createComponent, createRoot, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { PluginContextProvider } from "@opencode-ai/plugin/tui"
import tuiPlugin, { buildFilters } from "./tui.js"

const paid = (input: number, output: number, read: number) => [{ input, output, cache: { read } }]

function baseCatalog(): Array<Record<string, unknown>> {
  return [
    { id: "cheap", providerID: "opencode", name: "cheap", cost: paid(1, 2, 0.25) },
    { id: "cache-king", providerID: "opencode", name: "cache-king", cost: paid(2, 4, 1) },
    { id: "pricey", providerID: "opencode", name: "pricey", cost: paid(10, 20, 4) },
    { id: "go-1", providerID: "opencode-go", name: "go-1", cost: paid(2, 4, 0.5) },
    { id: "free-a", providerID: "opencode", name: "A-free", cost: [{ input: 0, output: 0 }] },
    { id: "free-b", providerID: "opencode", name: "B-free", cost: [{ input: 0, output: 0 }] },
    { id: "free-c", providerID: "opencode", name: "C-free", cost: [{ input: 0, output: 0 }] },
    { id: "free-d", providerID: "opencode", name: "D-free", cost: [{ input: 0, output: 0 }] },
    { id: "disabled", providerID: "opencode", name: "disabled", enabled: false, cost: paid(1, 1, 0.5) },
    { id: "outsider", providerID: "google", name: "outsider", cost: paid(1, 1, 0.5) },
  ]
}

function fakeTuiCtx(
  opts: {
    list?: () => Promise<unknown>
    defaultModel?: () => Promise<unknown>
    messages?: Array<Record<string, unknown>>
    catalog?: Array<Record<string, unknown>>
  } = {},
) {
  const slotCalls: Array<Record<string, any>> = []
  const layerCalls: Array<any> = []
  const toastCalls: Array<Record<string, unknown>> = []
  const storageCells: Record<string, unknown> = {}
  const messages = opts.messages ?? []
  const ctx = {
    storage: {
      store: (key: string, o: { initial: unknown }) => {
        const cell = (storageCells[key] ??= structuredClone(o.initial)) as unknown
        return [cell, cell]
      },
    },
    ui: {
      slot: vi.fn((options: Record<string, any>) => {
        slotCalls.push(options)
        return () => {}
      }),
      toast: { show: vi.fn((input: Record<string, unknown>) => void toastCalls.push(input)) },
      dialog: { alert: vi.fn(async () => {}), select: vi.fn(async () => undefined) },
    },
    keymap: {
      layer: vi.fn((register: () => unknown) => void layerCalls.push(register())),
    },
    data: {
      session: { message: { list: vi.fn(() => messages) } },
    },
    client: {
      model: {
        list: vi.fn(opts.list ?? (async () => ({ data: opts.catalog ?? baseCatalog() }))),
        default: vi.fn(opts.defaultModel ?? (async () => ({ data: { providerID: "opencode", modelID: "cheap" } }))),
      },
      integration: { list: vi.fn(async () => ({ data: [] })) },
    },
    theme: { text: { default: "#fff", subdued: "#888" } },
  }
  return { ctx: ctx as never, raw: ctx as any, slotCalls, layerCalls, toastCalls, messages }
}

/** The picker command only materializes when its app slot renders. */
function appCommand(f: ReturnType<typeof fakeTuiCtx>): {
  id: string
  slash: { name: string }
  title: string
  run: (arg?: string) => Promise<void>
} {
  const slot = f.slotCalls.find((s) => s.append === "app")
  expect(slot).toBeDefined()
  slot!.render()
  expect(f.layerCalls.length).toBeGreaterThan(0)
  return f.layerCalls[0].commands[0] as {
    id: string
    slash: { name: string }
    title: string
    run: (arg?: string) => Promise<void>
  }
}

async function setupTui(opts: Parameters<typeof fakeTuiCtx>[0] = {}) {
  const f = fakeTuiCtx(opts)
  await tuiPlugin.setup(f.ctx)
  const sidebar = f.slotCalls.find((s) => s.after === "sidebar.content")
  expect(sidebar).toBeDefined()
  return f
}

let cleanups: Array<() => void> = []
beforeEach(() => {
  cleanups = []
  document.body.textContent = ""
})

function mountPicks(f: ReturnType<typeof fakeTuiCtx>, sessionID?: string): () => string {
  const slot = f.slotCalls.find((s) => s.after === "sidebar.content")
  let root: JSX.Element
  createRoot((dispose) => {
    cleanups.push(dispose)
    createRoot(() => {
      root = PluginContextProvider({
        value: f.ctx as never,
        get children() {
          return createComponent(slot!.render as never, { sessionID })
        },
      })
    })
    render(() => root, document.body)
  })
  return () => document.body.textContent ?? ""
}

function text(t: () => string): string {
  return t().replace(/\s+/g, " ").trim()
}

describe("buildFilters", () => {
  test("starts with All and maps each authenticated provider to a filter", () => {
    const filters = buildFilters()
    expect(filters.map((f) => f.id)).toEqual(["all", "zen", "go"])
    expect(filters[0]).toMatchObject({ title: "All", providers: [] })
    expect(filters[1]).toMatchObject({ id: "zen", title: "Zen", providers: ["opencode"] })
    expect(filters[2]).toMatchObject({ id: "go", title: "Go", providers: ["opencode-go"] })
  })
})

describe("Picks sidebar widget", () => {
  test("registers the picker command and renders through a sidebar slot", async () => {
    const f = await setupTui({
      messages: [{ info: { type: "assistant", model: { providerID: "opencode", id: "cache-king" } } }],
    })
    expect(f.raw.ui.slot).toHaveBeenCalledTimes(2)
    const cmd = appCommand(f)
    expect(f.raw.keymap.layer).toHaveBeenCalledTimes(1)
    expect(cmd.id).toBe("models.view")
    expect(cmd.slash.name).toBe("model-view")
    expect(cmd.title).toBe("Model picks: provider filter (All)")
  })

  test("shows the loading fallback while the catalog is pending", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const f = await setupTui({ list: () => gate.then(() => ({ data: baseCatalog() })) })
    const t = mountPicks(f, "s1")
    expect(text(t)).toContain("model picks: loading…")
    release()
    await vi.waitFor(() => expect(text(t)).toContain("MODEL PICKS"))
  })

  test("shows the error fallback when the catalog fetch rejects", async () => {
    const f = await setupTui({ list: () => Promise.reject(new Error("boom")) })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("⚠ model picks unavailable"))
  })

  test("renders the picks table: best rows, free rows, save line, now line, basis", async () => {
    const f = await setupTui({
      messages: [{ info: { type: "assistant", model: { providerID: "opencode", id: "cache-king" } } }],
    })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("MODEL PICKS"))
    const s = text(t)
    expect(s).toContain("MODEL PICKS · all (all)")
    expect(s).toContain("sess$ cheap (zen) $0.26")
    expect(s).toContain("cache cache-king (zen) 0.50x")
    expect(s).toContain("token cheap (zen) $1.300/M")
    expect(s).toContain("free free-a (zen)")
    expect(s).toContain("free free-b (zen)")
    expect(s).toContain("free free-c (zen)")
    expect(s).toContain("+1 more free")
    expect(s).toContain("💡 save ~$0.42/session → cheap")
    expect(s).toContain("now cache-king (zen)")
    expect(s).not.toContain("✅")
    expect(s).toContain("basis 400k input (80% cached) + 50k output")
    expect(s).not.toContain("disabled")
    expect(s).not.toContain("outsider")
    expect(s).not.toContain("go-1")
  })

  test("marks the cheapest current model as matching the session", async () => {
    const f = await setupTui({
      messages: [{ info: { type: "assistant", model: { providerID: "opencode", id: "cheap" } } }],
    })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("✅ current model is the cheapest"))
    const s = text(t)
    expect(s).toContain("now cheap (zen) ✅")
    expect(s).not.toContain("save ~$")
  })

  test("falls back to the workspace default when the session has no model", async () => {
    const f = await setupTui({ messages: [] })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("MODEL PICKS"))
    const s = text(t)
    expect(s).toContain("now cheap (zen)")
    expect(s).toContain("✅ current model is the cheapest")
  })

  test("keeps going when there is no current model anywhere", async () => {
    const f = await setupTui({
      messages: [],
      defaultModel: () => Promise.reject(new Error("no default")),
    })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("MODEL PICKS"))
    const s = text(t)
    expect(s).not.toContain("now ")
    expect(s).not.toContain("save ~$")
    expect(s).toContain("basis")
  })

  test("drops the save line when the current model is not among the picks", async () => {
    const f = await setupTui({
      messages: [{ info: { type: "assistant", model: { providerID: "opencode", id: "ghost" } } }],
    })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("MODEL PICKS"))
    const s = text(t)
    expect(s).toContain("now ghost (zen)")
    expect(s).not.toContain("save ~$")
    expect(s).not.toContain("✅")
  })

  test("scopes rows to the active provider filter via /model-view", async () => {
    const f = await setupTui({
      messages: [{ info: { type: "assistant", model: { providerID: "opencode", id: "cache-king" } } }],
    })
    const cmd = appCommand(f)
    await cmd.run("zen")
    expect(f.toastCalls[0]).toMatchObject({ message: "Model picks: Zen view", variant: "success" })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("MODEL PICKS · zen"))
    const s = text(t)
    expect(s).not.toContain("go-1")
    expect(s).toContain("sess$ cheap")
  })

  test("shows the empty message when a provider filter has no models", async () => {
    const f = await setupTui({
      catalog: baseCatalog().filter((m) => m.providerID === "opencode"),
      messages: [],
    })
    const cmd = appCommand(f)
    await cmd.run("go")
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("no models for this provider"))
    expect(text(t)).toContain("MODEL PICKS · go")
  })

  test("renders only free rows without picking best-paid lines", async () => {
    const f = await setupTui({
      catalog: [{ id: "only-free", providerID: "opencode", cost: [{ input: 0, output: 0 }] }],
      messages: [],
    })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("MODEL PICKS"))
    const s = text(t)
    expect(s).toContain("free only-free (zen)")
    expect(s).not.toContain("sess$")
  })

  test("falls back to the model id when the catalog omits the name", async () => {
    const f = await setupTui({
      catalog: [{ id: "bare", providerID: "opencode", cost: paid(1, 2, 0.25) }],
      messages: [],
    })
    const t = mountPicks(f, "s1")
    await vi.waitFor(() => expect(text(t)).toContain("sess$ bare (zen)"))
  })

  test("never fetches without a session id", async () => {
    const f = await setupTui()
    const t = mountPicks(f)
    expect(text(t)).toContain("model picks: loading…")
    expect(f.raw.client.model.list).not.toHaveBeenCalled()
  })
})
