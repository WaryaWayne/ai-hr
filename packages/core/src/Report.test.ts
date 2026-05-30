import { DateTime, Effect } from "effect"
import { describe, expect, it } from "@effect/vitest"
import { buildAiHrReport, type AiHrReport } from "./Report"
import { renderMarkdownReport, renderTerminalReport } from "./Renderers"
import type { CostEstimate, UsageEvent } from "./Domain"

describe("Report", () => {
  it.effect("builds provider roster and markdown output", () =>
    Effect.gen(function*() {
      const event: UsageEvent = {
        id: "e1",
        provider: "codex",
        source: { provider: "codex", kind: "fixture", sessionId: "s1" },
        sessionId: "s1",
        occurredAt: DateTime.makeUnsafe("2026-05-29T00:00:00.000Z"),
        model: "gpt-5-codex",
        inputTokens: 100,
        cachedInputTokens: 10,
        outputTokens: 20,
        reasoningTokens: 5,
        cacheWriteTokens: 0,
        cacheReadTokens: 0
      }
      const estimate: CostEstimate = {
        eventId: "e1",
        provider: "codex",
        model: "gpt-5-codex",
        costUsd: 0.01,
        inputCostUsd: 0.001,
        outputCostUsd: 0.009,
        reasoningCostUsd: 0,
        cacheCostUsd: 0,
        pricingRuleLabel: "fixture",
        sourceUrl: "https://example.com",
        warnings: []
      }
      const report = yield* buildAiHrReport([{ event, estimate }], {
        since: DateTime.makeUnsafe("2026-05-01T00:00:00.000Z"),
        until: DateTime.makeUnsafe("2026-05-30T00:00:00.000Z"),
        label: "fixture"
      })
      const markdown = renderMarkdownReport(report)

      expect(report.groups[0]?.key).toBe("codex")
      expect(markdown).toContain("AI HR Report")
      expect(markdown).toContain("Codex")
    }))

  it.effect("renders an ASCII report card with budget and activity context", () =>
    Effect.gen(function*() {
      const events: ReadonlyArray<PricedUsageEventFixture> = [
        {
          event: {
            id: "e1",
            provider: "codex",
            source: { provider: "codex", kind: "fixture", sessionId: "s1" },
            sessionId: "s1",
            occurredAt: DateTime.makeUnsafe("2026-05-28T00:00:00.000Z"),
            model: "gpt-5-codex",
            inputTokens: 50_000,
            cachedInputTokens: 0,
            outputTokens: 1_000,
            reasoningTokens: 0,
            cacheWriteTokens: 0,
            cacheReadTokens: 0
          },
          estimate: {
            eventId: "e1",
            provider: "codex",
            model: "gpt-5-codex",
            costUsd: 200,
            inputCostUsd: 150,
            outputCostUsd: 50,
            reasoningCostUsd: 0,
            cacheCostUsd: 0,
            pricingRuleLabel: "fixture",
            sourceUrl: "https://example.com",
            warnings: ["fixture pricing note"]
          }
        },
        {
          event: {
            id: "e2",
            provider: "codex",
            source: { provider: "codex", kind: "fixture", sessionId: "s2" },
            sessionId: "s2",
            occurredAt: DateTime.makeUnsafe("2026-05-29T00:00:00.000Z"),
            model: "gpt-5-codex",
            inputTokens: 5_000,
            cachedInputTokens: 0,
            outputTokens: 100,
            reasoningTokens: 0,
            cacheWriteTokens: 0,
            cacheReadTokens: 0
          },
          estimate: {
            eventId: "e2",
            provider: "codex",
            model: "gpt-5-codex",
            costUsd: 50,
            inputCostUsd: 40,
            outputCostUsd: 10,
            reasoningCostUsd: 0,
            cacheCostUsd: 0,
            pricingRuleLabel: "fixture",
            sourceUrl: "https://example.com",
            warnings: []
          }
        }
      ]
      const report = yield* buildAiHrReport(events, {
        since: DateTime.makeUnsafe("2026-05-23T00:00:00.000Z"),
        until: DateTime.makeUnsafe("2026-05-30T00:00:00.000Z"),
        label: "last 7 days"
      })
      const terminal = withStdoutColors(false, () => renderTerminalReport(report, {
        packageName: "ai-hr",
        packageVersion: "9.9.9"
      }))

      expect(report.highestSpendDay?.day).toBe("2026-05-28")
      expect(report.daysWithoutWork).toBe(5)
      expect(terminal.split("\n").slice(0, 3)).toEqual([
        "  ai-hr 9.9.9",
        "",
        "     +-------------+"
      ])
      expect(terminal).toContain("ai-hr 9.9.9")
      expect(terminal).toContain("AI HR BOT")
      expect(terminal).toContain("AI HR REPORT CARD")
      expect(terminal).toContain("  AI HR REPORT CARD\n\n| Report Card |")
      expect(terminal).toContain("Highest spending day")
      expect(terminal).toContain("Days off")
      expect(terminal).toContain("LOCK IN")
      expect(terminal).toContain("Grade note")
      expect(terminal).toContain("D reflects context waste, not output quality.")
      expect(terminal).not.toContain("| Verdict")
      expect(terminal).toContain("\nBudget\n\n| Budget Signal")
      expect(terminal).toContain("\nContext Tax\n\n| Token Mix")
      expect(terminal).toContain("\nEmployee Roster\n\n| Agent")
      expect(terminal).toContain("\nBriefing\n\n- Roster: Codex is the only agent here")
      expect(terminal).not.toContain("Calendar dates touched")
      expect(terminal).not.toContain("Hardest token day")
      expect(terminal).not.toContain("Review size")
      expect(terminal).not.toContain("The quiet days helped the run-rate")
      expect(terminal).not.toContain("\u001B[")
      expect(terminal).not.toContain("Pricing Notes")
      expect(terminal).not.toContain("fixture pricing note")
    }))

  it.effect("adds per-agent context ratios and color when stdout supports it", () =>
    Effect.gen(function*() {
      const events: ReadonlyArray<PricedUsageEventFixture> = [
        makePricedUsage({
          id: "codex-expensive",
          provider: "codex",
          sessionId: "codex-1",
          occurredAt: "2026-05-29T00:00:00.000Z",
          inputTokens: 250_000,
          outputTokens: 1_000,
          costUsd: 10
        }),
        makePricedUsage({
          id: "claude-efficient",
          provider: "claude",
          sessionId: "claude-1",
          occurredAt: "2026-05-30T00:00:00.000Z",
          inputTokens: 100,
          cachedInputTokens: 900,
          outputTokens: 100,
          costUsd: 1
        })
      ]
      const report = yield* buildAiHrReport(events, {
        since: DateTime.makeUnsafe("2026-05-29T00:00:00.000Z"),
        until: DateTime.makeUnsafe("2026-05-31T00:00:00.000Z"),
        label: "last 2 days"
      })
      const terminal = withStdoutColors(true, () => renderTerminalReport(report, {
        packageName: "ai-hr",
        packageVersion: "0.0.0"
      }))

      expect(terminal).toContain("Context/Gen")
      expect(terminal).toContain("\u001B[1;36mai-hr\u001B[0m 0.0.0")
      expect(terminal).toContain("\u001B[2mAgent\u001B[0m")
      expect(terminal).toContain("\u001B[1;36mCodex\u001B[0m")
      expect(terminal).toContain("\u001B[1;36mClaude Code\u001B[0m")
      expect(terminal).toContain("\u001B[1;33mLOCK IN\u001B[0m")
      expect(terminal).toContain("\u001B[37m$10.00\u001B[0m")
      expect(terminal).toContain("\u001B[31m250x\u001B[0m")
      expect(terminal).toContain("\u001B[32m10x\u001B[0m")
      expect(terminal).toContain("\u001B[1;31mF\u001B[0m")
      expect(terminal).toContain("\u001B[32mA\u001B[0m")
      expect(terminal).toContain("Top employee: \u001B[1;36mClaude Code\u001B[0m grade \u001B[32mA\u001B[0m")
      expect(terminal).toContain("vs \u001B[1;36mCodex\u001B[0m grade \u001B[1;31mF\u001B[0m")
      expect(terminal).toContain("grade gap matters more than spend share")
      expect(terminal).toContain("0/2 (\u001B[32m0%\u001B[0m)")
      expect(terminal).not.toContain("Average / work day")
    }))

  it.effect("omits yearly run-rate for a 365-day report window", () =>
    Effect.gen(function*() {
      const report = yield* buildAiHrReport([
        makePricedUsage({
          id: "e365-recent-1",
          provider: "codex",
          sessionId: "s365-1",
          occurredAt: "2026-05-20T00:00:00.000Z",
          inputTokens: 100,
          outputTokens: 25,
          costUsd: 2
        }),
        makePricedUsage({
          id: "e365-recent-2",
          provider: "codex",
          sessionId: "s365-2",
          occurredAt: "2026-05-21T00:00:00.000Z",
          inputTokens: 100,
          outputTokens: 25,
          costUsd: 2
        }),
        makePricedUsage({
          id: "e365-recent-3",
          provider: "codex",
          sessionId: "s365-3",
          occurredAt: "2026-05-29T00:00:00.000Z",
          inputTokens: 100,
          outputTokens: 25,
          costUsd: 2
        }),
        makePricedUsage({
          id: "e365-older",
          provider: "codex",
          sessionId: "s365-older",
          occurredAt: "2025-06-15T00:00:00.000Z",
          inputTokens: 100,
          outputTokens: 25,
          costUsd: 2
        })
      ], {
        since: DateTime.makeUnsafe("2025-05-30T00:00:00.000Z"),
        until: DateTime.makeUnsafe("2026-05-30T00:00:00.000Z"),
        label: "last 365 days"
      })
      const terminal = withStdoutColors(false, () => renderTerminalReport({
        ...report,
        generatedAt: DateTime.makeUnsafe("2026-05-30T10:29:22.169Z"),
        activeDays: 365,
        daysWithoutWork: 0
      } satisfies AiHrReport, { includeHeader: false }))

      expect(terminal).toContain("May 30, 2026 10:29 AM UTC")
      expect(terminal).toContain("Avg monthly cost")
      expect(terminal).not.toContain("Monthly run-rate")
      expect(terminal).not.toContain("Yearly run-rate")
      expect(terminal).not.toContain("Average / work day")
      expect(terminal).not.toContain("| Verdict")
      expect(terminal).toContain("Usage trend: 75% of activity landed in the last 30 days; usage is heavily back-loaded.")
    }))
})

type PricedUsageEventFixture = {
  readonly event: UsageEvent
  readonly estimate: CostEstimate
}

const makePricedUsage = (options: {
  readonly id: string
  readonly provider: UsageEvent["provider"]
  readonly sessionId: string
  readonly occurredAt: string
  readonly inputTokens: number
  readonly cachedInputTokens?: number
  readonly outputTokens: number
  readonly reasoningTokens?: number
  readonly cacheWriteTokens?: number
  readonly cacheReadTokens?: number
  readonly costUsd: number
}): PricedUsageEventFixture => {
  const model = `${options.provider}-fixture`

  return {
    event: {
      id: options.id,
      provider: options.provider,
      source: { provider: options.provider, kind: "fixture", sessionId: options.sessionId },
      sessionId: options.sessionId,
      occurredAt: DateTime.makeUnsafe(options.occurredAt),
      model,
      inputTokens: options.inputTokens,
      cachedInputTokens: options.cachedInputTokens ?? 0,
      outputTokens: options.outputTokens,
      reasoningTokens: options.reasoningTokens ?? 0,
      cacheWriteTokens: options.cacheWriteTokens ?? 0,
      cacheReadTokens: options.cacheReadTokens ?? 0
    },
    estimate: {
      eventId: options.id,
      provider: options.provider,
      model,
      costUsd: options.costUsd,
      inputCostUsd: options.costUsd,
      outputCostUsd: 0,
      reasoningCostUsd: 0,
      cacheCostUsd: 0,
      pricingRuleLabel: "fixture",
      sourceUrl: "https://example.com",
      warnings: []
    }
  }
}

const withStdoutColors = <A>(hasColors: boolean, run: () => A): A => {
  const stdout = process.stdout as typeof process.stdout & {
    hasColors?: () => boolean
  }
  const original = stdout.hasColors
  stdout.hasColors = () => hasColors
  try {
    return run()
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(stdout, "hasColors")
    } else {
      stdout.hasColors = original
    }
  }
}
