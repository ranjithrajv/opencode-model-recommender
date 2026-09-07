// Shared provider vocabulary for OpenCode sidebar widgets.
// Provider IDs are the OpenCode workspace provider ids ("opencode" = Zen,
// "opencode-go" = Go).

export const ZEN_PROVIDER = "opencode"
export const GO_PROVIDER = "opencode-go"
export const DEFAULT_PROVIDERS = [ZEN_PROVIDER, GO_PROVIDER]

/** Short human label for the provider column, e.g. "zen" / "go". */
export function providerLabel(pid: string): string {
  if (pid === ZEN_PROVIDER) return "zen"
  if (pid === GO_PROVIDER) return "go"
  return pid
}

/** Unwrap a beta-API message entry: `{ info: {...} }` -> the inner object. */
export function unwrap(entry: any): any {
  return entry?.info ?? entry
}

/** Normalize `{ data: [...] }` API responses (or a bare array) to an array. */
export function asArray<T = any>(out: any): T[] {
  return Array.isArray(out) ? (out as T[]) : ((out as any)?.data ?? [])
}

/** Model id from either a model-list object or a message/message-part shape. */
export function modelId(m: any): string {
  return m?.model?.modelID ?? m?.modelID ?? m?.model?.id ?? m?.id ?? ""
}

/** Provider id from either a model-list object or a message/message-part shape. */
export function providerId(m: any): string {
  return m?.model?.providerID ?? m?.providerID ?? ""
}

/** Display name, falling back to the model id when the API omits `name`. */
export function modelName(m: any): string {
  return m?.name ?? modelId(m)
}
