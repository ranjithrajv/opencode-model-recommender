// Shared sidebar row builders — pure text formatting, no I/O.
import { providerLabel } from "./providers.ts"

/** Truncate a long id so a sidebar row stays on one line. */
export function short(id: string, max = 24): string {
  return id.length > max ? id.slice(0, max - 1) + "…" : id
}

/** A padded label/value row with a (provider) tag, e.g. `sess$  gpt-5…  (zen) $0.12`. */
export function line(label: string, id: string, providerID: string, value?: string): string {
  if (!id) return ""
  const v = value ? ` ${value}` : ""
  const tag = `(${providerLabel(providerID)})`
  return `${label.padEnd(6)} ${short(id).padEnd(25)} ${tag}${v}`
}

/** Lean inline progress bar: [━━──] — half-height line glyphs keep the row slim. */
export function bar(percent: number, cells = 10): string {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return `[${"━".repeat(filled)}${"─".repeat(cells - filled)}]`
}
