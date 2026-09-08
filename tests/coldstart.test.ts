import { describe, expect, test } from "vitest"
import plugin from "../tui.js"
import serverPlugin from "../index.js"

// Cold start: a fresh install has empty durable storage, no cached catalog,
// and a service whose clients may be unreachable. setup() must complete
// without throwing, register the expected slot, and yield working cleanup.
function emptyCtx() {
  const slots: Array<Record<string, unknown>> = []
  const stores: Record<string, unknown> = {}
  const ctx: any = {
    storage: {
      store: (key: string, opts: { initial: unknown }) => {
        if (!(key in stores)) stores[key] = structuredClone(opts.initial)
        return [{ ...(stores[key] as object) }]
      },
    },
    ui: {
      slot: (o: Record<string, unknown>) => {
        slots.push(o)
        return () => {}
      },
      toast: { show: () => {} },
      dialog: {},
    },
    keymap: { layer: () => {} },
    options: {},
    location: { directory: "/nonexistent-project" },
    theme: { text: { default: "#fff", subdued: "#888" } },
  }
  return { ctx, slots, stores }
}

describe("cold start", () => {
  test("server entrypoint registers tools/commands and completes", async () => {
    const tools: string[] = []
    const commands: string[] = []
    const ctx: any = {
      tool: { transform: (cb: any) => cb({ namespace: () => {}, add: (d: any) => tools.push(d.name) }) },
      command: { transform: (cb: any) => cb({ add: (d: any) => commands.push(d.name) }) },
    }
    await expect(serverPlugin.setup(ctx)).resolves.toBeUndefined()
    expect(tools).toContain("recommend")
    expect(tools).toContain("details")
    expect(commands).toContain("recommend-models")
    expect(commands).toContain("model-details")
  })

  test("setup completes with empty storage and registers the sidebar slot", async () => {
    const { ctx, slots } = emptyCtx()
    const cleanup = await plugin.setup(ctx)
    expect(typeof cleanup).toBe("function")
    // Both the sidebar slot and the keymap-layer app slot are registered.
    const targets = slots.map((s) => s.after ?? s.append ?? s.replace)
    expect(targets).toContain("sidebar.content")
    expect(targets).toContain("app")
    expect(() => cleanup()).not.toThrow()
  })

  test("repeated setup on empty stores is idempotent", async () => {
    const { ctx } = emptyCtx()
    await plugin.setup(ctx)
    await expect(Promise.resolve(plugin.setup(ctx))).resolves.toBeDefined()
  })
})
