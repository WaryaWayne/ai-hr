import { DateTime } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { estimateWithRules } from "./PricingCatalog"
import type { PricingRule, UsageEvent } from "./Domain"

describe("PricingCatalog", () => {
  it("prices regular, cached, output, reasoning, and cache read/write tokens", () => {
    const rule: PricingRule = {
      provider: "claude",
      modelPattern: "*sonnet*",
      label: "fixture",
      inputPerMillion: 2,
      cachedInputPerMillion: 1,
      outputPerMillion: 10,
      reasoningOutputPerMillion: 12,
      cacheWritePerMillion: 3,
      cacheReadPerMillion: 0.5,
      sourceUrl: "https://example.com",
      confidence: "exact",
      assumptions: []
    }
    const event: UsageEvent = {
      id: "e1",
      provider: "claude",
      source: { provider: "claude", kind: "fixture", sessionId: "s1" },
      sessionId: "s1",
      occurredAt: DateTime.makeUnsafe("2026-05-30T00:00:00.000Z"),
      model: "claude-sonnet-test",
      inputTokens: 1_000_000,
      cachedInputTokens: 100_000,
      outputTokens: 100_000,
      reasoningTokens: 10_000,
      cacheWriteTokens: 20_000,
      cacheReadTokens: 40_000
    }

    const estimate = estimateWithRules([rule], event)
    expect(estimate.costUsd).toBeCloseTo(3.1)
  })
})
