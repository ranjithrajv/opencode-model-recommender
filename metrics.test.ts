import { describe, expect, test } from "vitest"
import { metrics, savings, fmt, fmtRatio, sessionBasis, SESSION } from "./metrics.js"

describe("metrics", () => {
  test("computes cacheRatio as cacheRead / input", () => {
    const r = metrics([{ input: 10, output: 5, cache: { read: 2 } }])
    expect(r.cacheRatio).toBeCloseTo(0.2)
  })

  test("cacheRatio is null when input is 0", () => {
    const r = metrics([{ input: 0, output: 0 }])
    expect(r.cacheRatio).toBeNull()
  })

  test("computes blended tokenCost as 0.7*input + 0.3*output", () => {
    const r = metrics([{ input: 10, output: 10 }])
    expect(r.tokenCost).toBeCloseTo(10)
  })

  test("tokenCost is null for free models", () => {
    const r = metrics([{ input: 0, output: 0 }])
    expect(r.tokenCost).toBeNull()
  })

  test("sessionCost is null for free models", () => {
    const r = metrics([{ input: 0, output: 0 }])
    expect(r.sessionCost).toBeNull()
    expect(r.free).toBe(true)
  })

  test("sessionCost uses cache read/write shares from SESSION defaults", () => {
    const r = metrics([{ input: 1, output: 1, cache: { read: 0.1 } }])
    // 400k * 0.8 * 0.1 + 400k * 0.2 * 1 + 50k * 1 = 32k + 80k + 50k = 162k
    expect(r.sessionCost).toBeCloseTo(0.162)
  })

  test("defaults cache read/write to 0 when the cache object omits them", () => {
    const r = metrics([{ input: 1, output: 1, cache: {} }])
    expect(r.cacheRead).toBe(0)
    expect(r.cacheWrite).toBe(0)
  })

  test("tolerates a single flat cost object (non-array)", () => {
    const r = metrics({ input: 5, output: 2 } as any)
    expect(r.input).toBe(5)
    expect(r.output).toBe(2)
  })

  test("falls back to fallback pricing when cost tiers are empty", () => {
    const r = metrics([], { input: 3, output: 1 })
    expect(r.input).toBe(3)
    expect(r.output).toBe(1)
  })

  test("custom session assumptions override defaults", () => {
    const base = metrics([{ input: 1, output: 1 }])
    const custom = metrics([{ input: 1, output: 1 }], undefined, { freshInput: 100_000, output: 10_000 })
    expect(custom.sessionCost).not.toBe(base.sessionCost)
  })
})

describe("savings", () => {
  test("returns the difference when switching saves money", () => {
    expect(savings(10, 4)).toBeCloseTo(6)
  })

  test("returns null when switching costs more", () => {
    expect(savings(4, 10)).toBeNull()
  })

  test("returns null when from or to is null/undefined", () => {
    expect(savings(null, 5)).toBeNull()
    expect(savings(5, null)).toBeNull()
    expect(savings(undefined, 5)).toBeNull()
    expect(savings(5, undefined)).toBeNull()
  })
})

describe("fmt", () => {
  test("formats to 3 decimal places by default", () => {
    expect(fmt(1.23456)).toBe("1.235")
  })

  test("respects custom digit count", () => {
    expect(fmt(1.23456, 1)).toBe("1.2")
  })

  test("returns n/a for null or undefined", () => {
    expect(fmt(null)).toBe("n/a")
    expect(fmt(undefined)).toBe("n/a")
  })
})

describe("fmtRatio", () => {
  test("appends x suffix", () => {
    expect(fmtRatio(0.5)).toBe("0.50x")
  })

  test("returns 0 for zero", () => {
    expect(fmtRatio(0)).toBe("0")
  })

  test("returns n/a for null or undefined", () => {
    expect(fmtRatio(null)).toBe("n/a")
    expect(fmtRatio(undefined)).toBe("n/a")
  })
})

describe("sessionBasis", () => {
  test("describes the default session", () => {
    expect(sessionBasis()).toBe("400k input (80% cached) + 50k output")
  })

  test("reflects overrides", () => {
    expect(sessionBasis({ freshInput: 200_000 })).toContain("200k")
  })
})
