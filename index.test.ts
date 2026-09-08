import { beforeAll, describe, expect, test, vi } from "vitest"

// Deterministic provider discovery: availableProviders() reads
// ~/.local/share/opencode/auth.json — never touch the real one. Partially
// mock the kit so every other helper stays real.
vi.mock("opencode-plugin-kit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("opencode-plugin-kit")>()),
  availableProviders: vi.fn(() => ["opencode", "opencode-go"]),
}))

import plugin from "./index.js"

type AnyModel = Record<string, unknown>

const model = (id: string, providerID: string, cost?: unknown, name?: string): AnyModel => ({
  id,
  providerID,
  name: name ?? id,
  cost,
})

const CATALOG: AnyModel[] = [
  model("free-a", "opencode", [{ input: 0, output: 0, cache: { read: 0 } }]),
  model("cheap", "opencode", [{ input: 1, output: 2, cache: { read: 0.25, write: 1 } }]),
  model("cache-king", "opencode", [{ input: 2, output: 4, cache: { read: 1 } }]),
  model("pricey", "opencode", [{ input: 10, output: 20, cache: { read: 4 } }]),
  model("gofast", "opencode-go", [{ input: 3, output: 6, cache: { read: 1 } }], "Go Fast"),
]

function fakeEditor() {
  const added: Array<Record<string, any>> = []
  const namespaces: Array<Record<string, unknown>> = []
  return {
    added,
    namespaces,
    editor: {
      namespace: vi.fn((n: Record<string, unknown>) => namespaces.push(n)),
      add: vi.fn((t: Record<string, any>) => added.push(t)),
    },
  }
}

type CtxOverrides = Partial<Record<string, unknown>>

function fakeCtx(overrides: CtxOverrides = {}) {
  const tool = fakeEditor()
  const command = fakeEditor()
  const prompt = vi.fn(async (_input: unknown) => {})
  const ctx = {
    catalog: {
      model: {
        list: vi.fn(async () => ({ data: structuredClone(CATALOG) })),
        default: vi.fn(async () => ({ data: { providerID: "opencode", modelID: "cheap" } })),
      },
    },
    session: {
      get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "pricey" } } })),
      prompt,
    },
    tool: { transform: vi.fn(async (fn: (e: unknown) => unknown) => fn(tool.editor)) },
    command: { transform: vi.fn(async (fn: (e: unknown) => unknown) => fn(command.editor)) },
    ...overrides,
  }
  return { ctx: ctx as never, tool, command, prompt, raw: ctx }
}

async function setup(overrides: CtxOverrides = {}) {
  const f = fakeCtx(overrides)
  await plugin.setup(f.ctx)
  expect(f.raw.tool.transform).toHaveBeenCalledOnce()
  expect(f.raw.command.transform).toHaveBeenCalledOnce()
  expect(f.tool.namespaces).toEqual([
    { name: "models", description: "Model recommendations for OpenCode Zen and OpenCode Go" },
  ])
  return f
}

const rec = (f: Awaited<ReturnType<typeof setup>>) =>
  f.tool.added.find((t) => t.name === "recommend") as {
    execute: (i: unknown, c?: unknown) => Promise<{ content: string }>
  }
const details = (f: Awaited<ReturnType<typeof setup>>) =>
  f.tool.added.find((t) => t.name === "details") as {
    execute: (i: unknown, c?: unknown) => Promise<{ content: string }>
  }
const cmd = (f: Awaited<ReturnType<typeof setup>>, name: string) =>
  f.command.added.find((t) => t.name === name) as { execute: (i: unknown) => Promise<void> }

beforeAll(() => {
  delete process.env.HF_TOKEN
})

describe("plugin setup", () => {
  test("registers both tools and both commands", async () => {
    const f = await setup()
    expect(f.tool.added.map((t) => t.name).sort()).toEqual(["details", "recommend"])
    expect(f.command.added.map((t) => t.name).sort()).toEqual(["model-details", "recommend-models"])
  })
})

describe("models_recommend", () => {
  test("returns the no-models message for an empty catalog", async () => {
    const f = await setup({
      catalog: { model: { list: vi.fn(async () => ({ data: [] })), default: vi.fn(async () => ({ data: null })) } },
    })
    const out = await rec(f).execute({})
    expect(out.content).toContain("No models found for providers: opencode, opencode-go.")
    expect(out.content).toContain("Possible fixes:")
  })

  test("tolerates a bare-array catalog response", async () => {
    const f = await setup({
      catalog: { model: { list: vi.fn(async () => structuredClone(CATALOG)), default: vi.fn() } },
    })
    const out = await rec(f).execute({ sort: "tokenCost" })
    expect(out.content).toContain("cheap")
  })

  test("lists free models sorted by name, honoring limit", async () => {
    const f = await setup({
      catalog: {
        model: {
          list: vi.fn(async () => ({
            data: [
              model("zeta", "opencode", [{ input: 0, output: 0 }], "Zeta"),
              model("alpha", "opencode", [{ input: 0, output: 0 }], "Alpha"),
              model("mid", "opencode", [{ input: 0, output: 0 }], "Mid"),
            ],
          })),
          default: vi.fn(),
        },
      },
    })
    const all = await rec(f).execute({ free: true })
    expect(all.content).toBe("# Free models (3)\n\n- Alpha (zen)\n- Mid (zen)\n- Zeta (zen)")

    const limited = await rec(f).execute({ free: true, limit: 2 })
    expect(limited.content).toBe("# Free models (2)\n\n- Alpha (zen)\n- Mid (zen)")
  })

  test("reports no free models found", async () => {
    const f = await setup({
      catalog: {
        model: {
          list: vi.fn(async () => ({
            data: [model("cheap", "opencode", [{ input: 1, output: 2, cache: { read: 0.5, write: 1 } }])],
          })),
          default: vi.fn(),
        },
      },
    })
    const out = await rec(f).execute({ free: true })
    expect(out.content).toContain("No models found for providers: opencode, opencode-go (free only).")
  })

  test("sorts by cacheRatio descending", async () => {
    const f = await setup()
    const out = await rec(f).execute({ sort: "cacheRatio", providers: ["opencode"] })
    expect(out.content).toContain("# Best models by cacheRatio")
    const order = ["cheap", "pricey", "cache-king"].map((id) => out.content.indexOf(id))
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
  })

  test("sorts by tokenCost ascending (explicit and default)", async () => {
    const f = await setup()
    for (const input of [{ sort: "tokenCost" as const }, {}]) {
      const out = await rec(f).execute(input)
      const order = ["cheap", "cache-king", "pricey"].map((id) => out.content.indexOf(id))
      expect(order[0]).toBeLessThan(order[1])
      expect(order[1]).toBeLessThan(order[2])
    }
  })

  test("sorts by sessionCost ascending by default", async () => {
    const f = await setup()
    const out = await rec(f).execute({ providers: ["opencode"] })
    expect(out.content).toContain("# Best models by sessionCost")
    const order = ["cheap", "cache-king", "pricey"].map((id) => out.content.indexOf(id))
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
    expect(out.content).toContain("Showing 3 priced models.")
  })

  test("truncates with a top-N header and showing line", async () => {
    const f = await setup()
    const out = await rec(f).execute({ limit: 2 })
    expect(out.content).toContain("# Best models by sessionCost (top 2)")
    expect(out.content).toContain("Showing 2 of 4 priced models.")
  })

  test("marks the current model and reports savings when switching", async () => {
    const f = await setup()
    const out = await rec(f).execute({}, { sessionID: "s1" })
    expect(out.content).toContain("pricey (zen) ← current")
    expect(out.content).toContain(
      "💡 Switching from pricey to cheap would save ~$2.82 per session (current: $3.08, best: $0.26; assumes 400k input (80% cached) + 50k output).",
    )
  })

  test("says so when the current model is already the cheapest", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "cheap" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await rec(f).execute({}, { sessionID: "s1" })
    expect(out.content).toContain("cheap (zen) ← current")
    expect(out.content).not.toContain("💡")
    expect(out.content).not.toContain("✅ Your current model")
  })

  test("notes a free current model", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "free-a" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await rec(f).execute({}, { sessionID: "s1" })
    expect(out.content).toContain("Your current model is free — the ranked models below all cost money.")
  })

  test("omits the savings line when there is no current model", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => {
          throw new Error("nope")
        }),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
      catalog: {
        model: {
          list: vi.fn(async () => ({ data: structuredClone(CATALOG) })),
          default: vi.fn(async () => {
            throw new Error("nope")
          }),
        },
      },
    })
    const out = await rec(f).execute({})
    expect(out.content).not.toContain("💡")
    expect(out.content).not.toContain("✅")
  })

  test("omits the savings line when the current model is not in the catalog", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "ghost" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await rec(f).execute({}, { sessionID: "s1" })
    expect(out.content).not.toContain("💡")
  })

  test("reports a singular priced model and excluded free one", async () => {
    const f = await setup({
      catalog: {
        model: {
          list: vi.fn(async () => ({
            data: [
              model("solo", "opencode-go", [{ input: 1, output: 1, cache: { read: 0.5 } }], "Solo Max"),
              { id: "noname", providerID: "opencode-go", cost: [{ input: 0, output: 0 }] },
            ],
          })),
          default: vi.fn(async () => ({ data: { providerID: "opencode-go", modelID: "solo" } })),
        },
      },
    })
    const out = await rec(f).execute({ providers: ["opencode-go"] })
    expect(out.content).toContain("Showing 1 priced model.")
    expect(out.content).toContain("Solo Max (solo) (go) ← current")
    expect(out.content).not.toContain("💡")
  })

  test("returns the no-pricing-data message when the sort key is null for every row", async () => {
    const f = await setup({
      catalog: {
        model: {
          list: vi.fn(async () => ({ data: [model("half", "opencode", [{ input: 0, output: 1 }])] })),
          default: vi.fn(),
        },
      },
    })
    const out = await rec(f).execute({ sort: "cacheRatio", providers: ["opencode"] })
    expect(out.content).toBe("# Best models by cacheRatio\n\nNo models with pricing data matched.")
  })

  test("honors session overrides and explicit providers", async () => {
    const f = await setup()
    const out = await rec(f).execute({
      providers: ["opencode"],
      session: { freshInput: 100_000, output: 10_000, cacheReadShare: 0.5 },
    })
    expect(out.content).toContain("$0.05")
    expect(out.content).toContain("$0.60")
  })

  test("falls back to availableProviders for an empty providers array", async () => {
    const f = await setup()
    const out = await rec(f).execute({ providers: [] })
    expect(out.content).toContain("Best models by sessionCost")
  })

  test("reads the current model without a sessionID context", async () => {
    const f = await setup()
    await rec(f).execute({}, undefined)
    expect(f.raw.catalog.model.default).toHaveBeenCalled()
  })
})

describe("models_details", () => {
  test("shows a full breakdown for an explicitly named model", async () => {
    const f = await setup()
    const out = await details(f).execute({ providerID: "opencode", modelID: "pricey" })
    expect(out.content).toContain("# pricey (zen)")
    expect(out.content).toContain("| Cache read $/M | 4.000 |")
    expect(out.content).toContain("| Cache write $/M | 0.000 |")
    expect(out.content).toContain("| Cache ratio | 0.40x |")
    expect(out.content).toContain("| Blended $/M | 13.000 |")
    expect(out.content).toContain("| Est. session cost | $3.08 |")
    expect(out.content).toContain("| Rank by session cost | #4 of 4 priced models |")
    expect(out.content).not.toContain("Switching")
  })

  test("defaults to the current model and suggests switching when it is not the cheapest", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "cache-king" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await details(f).execute({}, { sessionID: "s1" })
    expect(out.content).toContain("# cache-king (zen)")
    expect(out.content).toContain("This is your currently active model.")
    expect(out.content).toContain("💡 Switching to cheap would save ~$0.42 per session.")
  })

  test("suppresses the switching hint when the active model is the cheapest", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "cheap" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await details(f).execute({}, { sessionID: "s1" })
    expect(out.content).toContain("This is your currently active model.")
    expect(out.content).not.toContain("💡")
  })

  test("marks a free model and skips the rank row", async () => {
    const f = await setup()
    const out = await details(f).execute({ providerID: "opencode", modelID: "free-a" })
    expect(out.content).toContain("| Pricing | 🆓 free |")
    expect(out.content).toContain("| Est. session cost | free |")
    expect(out.content).not.toContain("Rank by session cost")
    expect(out.content).not.toContain("💡")
  })

  test("reports the current free model as a warning when inspecting a paid one", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "free-a" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await details(f).execute({ providerID: "opencode", modelID: "cache-king" }, { sessionID: "s1" })
    expect(out.content).toContain("⚠️ Your current model is free; this one costs $0.68/session.")
  })

  test("reports savings when switching from a pricier current model", async () => {
    const f = await setup()
    const out = await details(f).execute({ providerID: "opencode", modelID: "cheap" }, { sessionID: "s1" })
    expect(out.content).toContain("💡 Switching from pricey would save ~$2.82 per session.")
  })

  test("returns a not-found message for unknown models", async () => {
    const f = await setup()
    const out = await details(f).execute({ providerID: "opencode", modelID: "nope" })
    expect(out.content).toContain("Model not found: opencode/nope. Call models_recommend to list available models.")
  })

  test("shows question marks when there is no model to resolve", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => {
          throw new Error("nope")
        }),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
      catalog: {
        model: {
          list: vi.fn(async () => ({ data: [] })),
          default: vi.fn(async () => {
            throw new Error("nope")
          }),
        },
      },
    })
    const out = await details(f).execute({})
    expect(out.content).toContain("Model not found: ?/?.")
  })

  test("prints the active-model header without savings for a free active model", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "free-a" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await details(f).execute({ providerID: "opencode", modelID: "free-a" }, { sessionID: "s1" })
    expect(out.content).toContain("This is your currently active model.")
    expect(out.content).toContain("| Pricing | 🆓 free |")
    expect(out.content).not.toContain("💡")
  })

  test("skips the comparison block when there is no current model", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => {
          throw new Error("nope")
        }),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
      catalog: {
        model: {
          list: vi.fn(async () => ({ data: structuredClone(CATALOG) })),
          default: vi.fn(async () => {
            throw new Error("nope")
          }),
        },
      },
    })
    const out = await details(f).execute({ providerID: "opencode", modelID: "cache-king" })
    expect(out.content).toContain("# cache-king (zen)")
    expect(out.content).not.toContain("💡")
    expect(out.content).not.toContain("⚠️")
  })

  test("keeps the generic wording when the current model is not in the catalog", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode", id: "ghost" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await details(f).execute({ providerID: "opencode", modelID: "cheap" }, { sessionID: "s1" })
    expect(out.content).toContain("# cheap (zen)")
    expect(out.content).not.toContain("⚠️")
  })
})

describe("current model resolution", () => {
  test("reads the session model from a bare { model } response", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ model: { providerID: "opencode", id: "cache-king" } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await rec(f).execute({}, { sessionID: "s1" })
    expect(out.content).toContain("cache-king (zen) ← current")
  })

  test("falls back to the default when the session model has no id", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => ({ data: { model: { providerID: "opencode" } } })),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await rec(f).execute({}, { sessionID: "s1" })
    expect(out.content).toContain("cheap (zen) ← current")
  })

  test("falls back to the workspace default when session lookup fails", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => {
          throw new Error("nope")
        }),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
    })
    const out = await rec(f).execute({})
    expect(out.content).toContain("cheap (zen) ← current")
  })

  test("resolves to no current model when the default is null", async () => {
    const f = await setup({
      session: {
        get: vi.fn(async () => {
          throw new Error("nope")
        }),
        prompt: vi.fn(async (_input: unknown) => {}),
      },
      catalog: {
        model: {
          list: vi.fn(async () => ({ data: structuredClone(CATALOG) })),
          default: vi.fn(async () => ({ data: null })),
        },
      },
    })
    const out = await rec(f).execute({})
    expect(out.content).not.toContain("← current")
    expect(out.content).not.toContain("💡")
  })
})

describe("commands", () => {
  test("recommend-models forwards a prompt with extra user criteria", async () => {
    const f = await setup()
    await cmd(f, "recommend-models").execute({ sessionID: "s1", prompt: { text: "prefer cheap" }, delivery: "chat" })
    expect(f.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionID: "s1",
        delivery: "chat",
        text: expect.stringContaining("Additional criteria from the user: prefer cheap"),
      }),
    )
    expect((f.prompt.mock.calls[0] as [any])[0].text).toContain("models_recommend tool")
  })

  test("recommend-models omits the criteria line when the text is blank", async () => {
    const f = await setup()
    await cmd(f, "recommend-models").execute({ sessionID: "s2", prompt: { text: "   " }, delivery: "chat" })
    await cmd(f, "recommend-models").execute({ sessionID: "s2", prompt: {}, delivery: "chat" })
    expect(f.prompt).toHaveBeenCalledTimes(2)
    expect((f.prompt.mock.calls[0] as [any])[0].text).not.toContain("Additional criteria")
    expect((f.prompt.mock.calls[1] as [any])[0].text).not.toContain("Additional criteria")
  })

  test("model-details without arguments asks about the current model", async () => {
    const f = await setup()
    await cmd(f, "model-details").execute({ sessionID: "s3", prompt: { text: "" }, delivery: "chat" })
    expect(f.prompt).toHaveBeenCalledTimes(1)
    const text = (f.prompt.mock.calls[0] as [any])[0].text as string
    expect(text).toContain("models_details tool")
    expect(text).not.toContain('providerID "')
  })

  test("model-details parses '<providerID> <modelID>' from the prompt text", async () => {
    const f = await setup()
    await cmd(f, "model-details").execute({
      sessionID: "s4",
      prompt: { text: " opencode cheap " },
      delivery: "chat",
    })
    const text = (f.prompt.mock.calls[0] as [any])[0].text as string
    expect(text).toContain('with providerID "opencode" and modelID "cheap"')
  })
})
