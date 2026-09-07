/**
 * Shared metric definitions used by both the `models_recommend` tool
 * (index.ts) and the sidebar widget (tui.tsx).
 *
 * Metrics:
 *  - cacheRatio : cache_read price / input price (higher = cheaper cached tokens)
 *  - tokenCost  : blended per-token cost (70% input / 30% output weight)
 *  - sessionCost: estimated cost of a representative coding session
 */

/** Representative coding session, in tokens. */
export const SESSION = {
  /** fresh (non-cached) input tokens per session */
  freshInput: 400_000,
  /** share of input tokens served from cache reads */
  cacheReadShare: 0.8,
  /** share of input tokens written to cache (first turn of each context block) */
  cacheWriteShare: 0.2,
  /** output tokens per session */
  output: 50_000,
} as const

export type SessionAssumptions = {
  freshInput?: number
  cacheReadShare?: number
  cacheWriteShare?: number
  output?: number
}

export type CostTier = {
  input?: number
  output?: number
  cache?: { read?: number; write?: number }
}

export type Metrics = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheRatio: number | null // cacheRead / input
  tokenCost: number | null // blended $/1M tokens
  sessionCost: number | null // null for free models
  free: boolean
}

/**
 * Compute pricing metrics from a catalog cost entry.
 * Cost is an array of tiers (first = base tier), but tolerate a single flat
 * object in case of older shapes.
 */
export function metrics(
  cost: CostTier[] | undefined,
  fallback?: { input?: number; output?: number },
  session: SessionAssumptions = {},
): Metrics {
  const first = (Array.isArray(cost) ? cost[0] : cost) as CostTier | undefined
  const tier: CostTier = first ?? {}
  const input = tier.input ?? fallback?.input ?? 0
  const output = tier.output ?? fallback?.output ?? 0
  const cacheRead = tier.cache?.read ?? 0
  const cacheWrite = tier.cache?.write ?? 0
  const free = input === 0 && output === 0

  const s = { ...SESSION, ...session }

  const cacheRatio = input > 0 ? cacheRead / input : null
  const tokenCost = input + output > 0 ? 0.7 * input + 0.3 * output : null

  // Providers that don't itemize cache writes charge input price.
  const writePrice = tier.cache?.write ?? input
  const sessionCost = free
    ? null
    : (s.freshInput * s.cacheReadShare * cacheRead +
        s.freshInput * s.cacheWriteShare * writePrice +
        s.output * output) /
      1_000_000

  return { input, output, cacheRead, cacheWrite, cacheRatio, tokenCost, sessionCost, free }
}

/** Shortest path savings between two session costs, in $. */
export function savings(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined) return null
  const d = from - to
  return d > 0 ? d : null
}

export function fmt(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined) return "n/a"
  return n.toFixed(digits)
}

export function fmtRatio(n: number | null | undefined): string {
  if (n === null || n === undefined) return "n/a"
  if (n === 0) return "0"
  return `${n.toFixed(2)}x`
}

/** One-line description of the session assumptions behind sessionCost. */
export function sessionBasis(overrides: SessionAssumptions = {}): string {
  const s = { ...SESSION, ...overrides }
  return `${Math.round(s.freshInput / 1000)}k input (${Math.round(s.cacheReadShare * 100)}% cached) + ${Math.round(s.output / 1000)}k output`
}
