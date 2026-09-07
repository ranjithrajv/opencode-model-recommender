// Shared number/date formatting for sidebar widgets.

/** Locale integer with a safe fallback for non-finite values. */
export function fmt(n: unknown): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : "0"
}

/** Dollar cost, fixed to `precision` decimals (default 4); strings pass through untouched. */
export function fmtCost(v: unknown, precision = 4): string {
  if (typeof v === "number" && Number.isFinite(v)) return `$${v.toFixed(precision)}`
  if (typeof v === "string" && v.trim() !== "") return v
  return `$${(0).toFixed(precision)}`
}

/** ISO timestamp -> compact countdown ("2h 5m", "3d 4h"); "" when absent. */
export function until(iso: string | undefined): string {
  if (!iso) return ""
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ""
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60000))
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  if (h < 48) return `${h}h ${mins % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
