import { Plugin } from "@opencode-ai/plugin"
import {
  SESSION,
  fmt,
  fmtRatio,
  metrics,
  savings,
  sessionBasis,
  type CostTier,
  type Metrics,
  type SessionAssumptions,
} from "./metrics.js"
import { asArray, availableProviders, providerLabel } from "opencode-plugin-kit"

/**
 * Model Recommender plugin
 *
 * Registers:
 *  - `models_recommend` tool that ranks models from OpenCode Zen ("opencode")
 *    and OpenCode Go ("opencode-go") by:
 *      - cacheRatio : cache_read price / input price (higher = cheaper cached tokens)
 *      - tokenCost  : blended per-token cost (70% input / 30% output weight)
 *      - sessionCost: estimated cost of a representative coding session
 *  - `model-details` tool / `/model-details` command showing a price
 *    breakdown for a specific model (defaults to the current one)
 *  - `/recommend-models` command
 *
 * Providers come from availableProviders() (auth.json + env), so new providers appear automatically.
 */

type RankedModel = {
  providerID: string
  modelID: string
  name: string
} & Metrics
type CurrentModel = { providerID: string; modelID: string } | undefined

function displayName(r: RankedModel): string {
  return r.name !== r.modelID ? `${r.name} (${r.modelID})` : r.modelID
}

function table(rows: RankedModel[], sort: string, current: CurrentModel): string {
  const key = sort as keyof Metrics
  // Free models are excluded from paid rankings and listed separately.
  const sorted = [...rows]
    .filter((r) => r[key] !== null && !r.free)
    .sort((a, b) => (a[key] as number) - (b[key] as number))
  if (sorted.length === 0) return "No models with pricing data matched."

  const lines = [
    "| # | Model | Input $/M | Output $/M | Cache read $/M | Cache ratio | Blended $/M | Est. session cost |",
    "|---|-------|-----------|------------|----------------|-------------|-------------|-------------------|",
  ]
  sorted.forEach((r, i) => {
    const isCurrent = current && r.providerID === current.providerID && r.modelID === current.modelID
    const prefix = i === 0 ? "→ " : "  "
    const name = `${displayName(r)} (${providerLabel(r.providerID)})${isCurrent ? " ← current" : ""}`
    lines.push(
      `| ${prefix}${i + 1} | ${name} | ${fmt(r.input)} | ${fmt(r.output)} | ${fmt(r.cacheRead)} | ${fmtRatio(r.cacheRatio)} | ${fmt(r.tokenCost)} | $${fmt(r.sessionCost, 2)} |`,
    )
  })
  const free = rows.filter((r) => r.free)

  lines.push(
    "",
    `Showing ${sorted.length} priced model${sorted.length !== 1 ? "s" : ""}${free.length > 0 ? ` (${free.length} free, excluded)` : ""}.`,
  )
  lines.push(
    "",
    "Definitions:",
    "- Cache ratio = cache-read price / input price. Higher means cached context is cheaper relative to fresh input.",
    "- Blended $/M = 0.7 × input + 0.3 × output (typical agent mix is input-heavy).",
    `- Est. session cost assumes ${sessionBasis()}.`,
  )
  return lines.join("\n")
}

/** One-line savings summary comparing the current model to the cheapest paid one. */
function savingsLine(rows: RankedModel[], current: CurrentModel): string | undefined {
  if (!current) return undefined
  const cur = rows.find((r) => r.providerID === current.providerID && r.modelID === current.modelID)
  if (!cur || cur.free || cur.sessionCost === null) {
    return cur?.free ? "Your current model is free — the ranked models below all cost money." : undefined
  }
  const cheapest = rows
    .filter((r) => !r.free && r.sessionCost !== null)
    .toSorted((a, b) => (a.sessionCost as number) - (b.sessionCost as number))[0]
  if (!cheapest || cheapest.sessionCost === null) return undefined
  const save = savings(cur.sessionCost, cheapest.sessionCost)
  if (save === null) return undefined
  const verb = cheapest.modelID === cur.modelID && cheapest.providerID === cur.providerID
  if (verb) {
    return `✅ Your current model is already the cheapest by est. session cost ($${cur.sessionCost.toFixed(2)}/session).`
  }
  return `💡 Switching from ${cur.name} to ${cheapest.name} would save ~$${save.toFixed(2)} per session (current: $${cur.sessionCost.toFixed(2)}, best: $${(cheapest.sessionCost as number).toFixed(2)}; assumes ${sessionBasis()}).`
}

export default Plugin.define({
  id: "model-recommender",
  async setup(ctx) {
    const loadCatalog = async () => {
      const listOutput = await ctx.catalog.model.list()
      // list() returns { data: ModelInfo[] }; tolerate a bare array too.
      const catalogModels: any[] = asArray(listOutput)
      return catalogModels
    }

    const currentModel = async (): Promise<CurrentModel> => {
      try {
        const out = (await ctx.catalog.model.default()) as { data?: { providerID: string; modelID: string } | null }
        return out?.data ? { providerID: out.data.providerID, modelID: out.data.modelID } : undefined
      } catch {
        return undefined
      }
    }

    const buildRows = (catalogModels: any[], providers: string[], session?: SessionAssumptions): RankedModel[] => {
      const rows: RankedModel[] = []
      for (const m of catalogModels) {
        if (!providers.includes(m.providerID)) continue
        const cost = (m as unknown as { cost?: CostTier[] }).cost
        const r = metrics(cost, m as unknown as { input?: number; output?: number }, session)
        rows.push({
          providerID: m.providerID,
          modelID: m.id,
          name: (m as unknown as { name?: string }).name ?? m.id,
          ...r,
        })
      }
      return rows
    }

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "models",
        description: "Model recommendations for OpenCode Zen and OpenCode Go",
      })
      editor.add({
        name: "recommend",
        description:
          "Recommend the best models available on OpenCode Zen (provider 'opencode') and OpenCode Go (provider 'opencode-go'). Ranks by cache ratio, token cost, or estimated session cost.",
        input: {
          type: "object",
          properties: {
            sort: {
              type: "string",
              enum: ["cacheRatio", "tokenCost", "sessionCost"],
              description:
                "Ranking metric. cacheRatio: best cached-context value (descending). tokenCost: cheapest blended per-token cost. sessionCost: cheapest estimated full coding session. Defaults to sessionCost.",
            },
            providers: {
              type: "array",
              items: { type: "string" },
              description: "Provider IDs to include. Defaults to ['opencode', 'opencode-go'].",
            },
            limit: {
              type: "integer",
              description: "Max models to show (default 10).",
            },
            free: {
              type: "boolean",
              description: "If true, only include free models.",
            },
            session: {
              type: "object",
              description:
                "Override the session-cost assumptions (defaults: 400k input tokens, 80% cache reads, 50k output).",
              properties: {
                freshInput: { type: "integer", description: "Input tokens per session (default 400000)." },
                output: { type: "integer", description: "Output tokens per session (default 50000)." },
                cacheReadShare: {
                  type: "number",
                  description: "Share of input tokens served from cache reads, 0–1 (default 0.8).",
                },
              },
              additionalProperties: false,
            },
          },
          required: [],
          additionalProperties: false,
        },
        options: { namespace: "models", codemode: true },
        execute: async (rawInput) => {
          const input = rawInput as {
            sort?: "cacheRatio" | "tokenCost" | "sessionCost"
            providers?: string[]
            limit?: number
            free?: boolean
            session?: SessionAssumptions
          }
          const sort: "cacheRatio" | "tokenCost" | "sessionCost" = input.sort ?? "sessionCost"
          const providers = input.providers && input.providers.length > 0 ? input.providers : availableProviders()
          const session = input.session ?? {}
          const [catalogModels, current] = await Promise.all([loadCatalog(), currentModel()])

          const allRows = buildRows(catalogModels, providers, session)
          const rows = input.free ? allRows.filter((r) => r.free) : allRows.filter((r) => !r.free)

          if (rows.length === 0) {
            return {
              content: [
                `No models found for providers: ${providers.join(", ")}${input.free ? " (free only)" : ""}.`,
                "",
                "Possible fixes:",
                "• Check `opencode2 providers` to verify providers are configured",
                "• If using a custom provider, pass it via the `providers` parameter",
                "• Restart the service: `opencode2 service restart`",
              ].join("\n"),
            }
          }

          // cacheRatio ranks descending (higher = better); others ascending (cheaper = better).
          if (input.free) {
            // Free models have no pricing metrics — list them by name.
            const freeRows = rows.toSorted((a, b) => a.name.localeCompare(b.name))
            const limitedFree =
              typeof input.limit === "number" && input.limit > 0 ? freeRows.slice(0, input.limit) : freeRows
            const lines = limitedFree.map((r) => `- ${r.name} (${providerLabel(r.providerID)})`)
            return {
              content: `# Free models (${limitedFree.length})\n\n${lines.join("\n") || "None."}`,
            }
          }

          const key = sort
          const sorted = [...rows].sort((a, b) =>
            key === "cacheRatio" ? (b[key] as number) - (a[key] as number) : (a[key] as number) - (b[key] as number),
          )
          const limited = typeof input.limit === "number" && input.limit > 0 ? sorted.slice(0, input.limit) : sorted

          let out = `# Best models by ${key}\n\n${table(sorted, key, current)}`
          if (limited.length < rows.length) {
            out = `# Best models by ${key} (top ${limited.length})\n\n${table(limited, key, current)}\n\nShowing ${limited.length} of ${rows.length} priced models.`
          }

          const sLine = input.free ? undefined : savingsLine(allRows, current)
          if (sLine) out += `\n\n${sLine}`
          return { content: out }
        },
      })

      editor.add({
        name: "details",
        description:
          "Show a price and metric breakdown for one model (defaults to the currently active model): input/output/cache prices, cache ratio, blended token cost, estimated session cost, rank, and potential savings.",
        input: {
          type: "object",
          properties: {
            providerID: { type: "string", description: "Provider ID. Defaults to the current model's provider." },
            modelID: { type: "string", description: "Model ID. Defaults to the current model." },
            session: {
              type: "object",
              description:
                "Override the session-cost assumptions (defaults: 400k input tokens, 80% cache reads, 50k output).",
              properties: {
                freshInput: { type: "integer", description: "Input tokens per session (default 400000)." },
                output: { type: "integer", description: "Output tokens per session (default 50000)." },
                cacheReadShare: {
                  type: "number",
                  description: "Share of input tokens served from cache reads, 0–1 (default 0.8).",
                },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "models", codemode: true },
        execute: async (rawInput) => {
          const input = rawInput as { providerID?: string; modelID?: string; session?: SessionAssumptions }
          const [catalogModels, current] = await Promise.all([loadCatalog(), currentModel()])
          const allRows = buildRows(catalogModels, availableProviders(), input.session)
          const target = allRows.find(
            (r) =>
              (input.providerID ?? current?.providerID) === r.providerID &&
              (input.modelID ?? current?.modelID) === r.modelID,
          )
          if (!target) {
            return {
              content: `Model not found: ${input.providerID ?? current?.providerID ?? "?"}/${input.modelID ?? current?.modelID ?? "?"}. Call models_recommend to list available models.`,
            }
          }

          const paid = allRows
            .filter((r) => !r.free && r.sessionCost !== null)
            .toSorted((a, b) => (a.sessionCost as number) - (b.sessionCost as number))
          const rank = target.free
            ? undefined
            : paid.findIndex((r) => r.modelID === target.modelID && r.providerID === target.providerID) + 1

          const lines = [
            `# ${target.name} (${providerLabel(target.providerID)})`,
            "",
            "| Metric | Value |",
            "|---|---|",
            `| Input $/M | ${fmt(target.input)} |`,
            `| Output $/M | ${fmt(target.output)} |`,
            `| Cache read $/M | ${fmt(target.cacheRead)} |`,
            `| Cache write $/M | ${fmt(target.cacheWrite)} |`,
            `| Cache ratio | ${fmtRatio(target.cacheRatio)} |`,
            `| Blended $/M | ${fmt(target.tokenCost)} |`,
            `| Est. session cost | ${target.sessionCost === null ? "free" : `$${target.sessionCost.toFixed(2)}`} |`,
            `| Session basis | ${sessionBasis(input.session)} |`,
          ]
          if (rank) lines.push(`| Rank by session cost | #${rank} of ${paid.length} priced models |`)
          if (target.free) lines.push("| Pricing | 🆓 free |")

          if (current && current.providerID === target.providerID && current.modelID === target.modelID) {
            lines.push("", "This is your currently active model.")
            if (!target.free && target.sessionCost !== null && paid[0]?.sessionCost != null) {
              const save = savings(target.sessionCost, paid[0].sessionCost)
              if (save) lines.push(`💡 Switching to ${paid[0].name} would save ~$${save.toFixed(2)} per session.`)
            }
          } else if (current) {
            const cur = allRows.find((r) => r.providerID === current.providerID && r.modelID === current.modelID)
            const save = savings(cur?.sessionCost, target.sessionCost)
            if (save) {
              lines.push(
                "",
                `💡 Switching from ${cur?.name ?? "your current model"} would save ~$${save.toFixed(2)} per session.`,
              )
            } else if (cur?.free && !target.free) {
              lines.push(
                "",
                `⚠️ Your current model is free; this one costs $${target.sessionCost?.toFixed(2)}/session.`,
              )
            }
          }

          return { content: lines.join("\n") }
        },
      })
    })

    // /recommend-models asks the agent to answer in-session.
    await ctx.command.transform((editor) => {
      editor.add({
        name: "recommend-models",
        description: "Ask the agent to recommend the best Zen/Go models (by cache ratio, token cost, session cost)",
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text:
              "Use the models_recommend tool to list the best models on OpenCode Zen and OpenCode Go. " +
              "Show three short rankings: best cache ratio (descending), cheapest token cost, and cheapest estimated session cost. " +
              "Also report how my current model compares and whether switching would save money. " +
              (prompt.text?.trim() ? `Additional criteria from the user: ${prompt.text}` : ""),
            delivery,
          })
        },
      })

      // /model-details shows a price breakdown for the current (or named) model.
      editor.add({
        name: "model-details",
        description: "Show a price breakdown for the current model (or pass '<providerID> <modelID>')",
        execute: async ({ sessionID, prompt, delivery }) => {
          const text = prompt.text?.trim()
          const [providerID, modelID] = text ? text.split(/\s+/) : []
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text:
              "Use the models_details tool" +
              (providerID && modelID ? ` with providerID "${providerID}" and modelID "${modelID}"` : "") +
              " to show a price breakdown for the model. Present the metrics as a short table and note any savings from switching.",
            delivery,
          })
        },
      })
    })
  },
})
