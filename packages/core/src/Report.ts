import { DateTime, Effect } from "effect"
import {
  addUsageTokens,
  emptyTokenTotals,
  totalTokens,
  type AgentGrade,
  type CostEstimate,
  type Provider,
  type TokenTotals,
  type UsageEvent
} from "./Domain"
import { calendarDaysInPeriod, type ReportPeriod } from "./Period"

export type PricedUsageEvent = {
  readonly event: UsageEvent
  readonly estimate: CostEstimate
}

export type ReportGroup = {
  readonly key: string
  readonly provider?: Provider
  readonly sessions: number
  readonly events: number
  readonly tokens: TokenTotals
  readonly costUsd: number
  readonly grade: AgentGrade
}

export type ReportDayStat = {
  readonly day: string
  readonly tokens: number
  readonly costUsd: number
}

export type AiHrReport = {
  readonly generatedAt: DateTime.Utc
  readonly period: ReportPeriod
  readonly events: ReadonlyArray<PricedUsageEvent>
  readonly totals: TokenTotals
  readonly totalCostUsd: number
  readonly activeDays: number
  readonly daysWithoutWork: number
  readonly hardestDay: ReportDayStat | undefined
  readonly highestSpendDay: ReportDayStat | undefined
  readonly slowestDay: ReportDayStat | undefined
  readonly groups: ReadonlyArray<ReportGroup>
  readonly warnings: ReadonlyArray<string>
  readonly overallGrade: AgentGrade
}

export const buildAiHrReport = Effect.fn("Report.buildAiHrReport")(function*(
  events: ReadonlyArray<PricedUsageEvent>,
  period: ReportPeriod
) {
  const generatedAt = yield* DateTime.now
  const totals = events.reduce((sum, priced) => addUsageTokens(sum, priced.event), emptyTokenTotals)
  const totalCostUsd = events.reduce((sum, priced) => sum + priced.estimate.costUsd, 0)
  const byDay = groupBy(events, (priced) => DateTime.formatIsoDate(priced.event.occurredAt))
  const dayStats = [...byDay.entries()].map(([day, priced]) => ({
    day,
    tokens: priced.reduce((sum, item) => sum + eventTokens(item.event), 0),
    costUsd: priced.reduce((sum, item) => sum + item.estimate.costUsd, 0)
  }))
  const hardestDay = maxBy(dayStats, (day) => day.tokens)
  const highestSpendDay = maxBy(dayStats, (day) => day.costUsd)
  const slowestDay = minBy(dayStats, (day) => day.tokens)
  const activeDays = dayStats.length
  const daysWithoutWork = Math.max(0, calendarDaysInPeriod(period) - activeDays)
  const providerGroups = [...groupBy(events, (priced) => priced.event.provider).entries()]
    .map(([provider, priced]) => buildGroup(provider, provider as Provider, priced))
    .sort((left, right) => right.costUsd - left.costUsd)
  const warnings = unique([
    "This is an API-equivalent estimate from local metadata, not a provider invoice.",
    ...events.flatMap((priced) => priced.estimate.warnings)
  ])

  return {
    generatedAt,
    period,
    events,
    totals,
    totalCostUsd,
    activeDays,
    daysWithoutWork,
    hardestDay,
    highestSpendDay,
    slowestDay,
    groups: providerGroups,
    warnings,
    overallGrade: gradeUsage(totals, totalCostUsd)
  } satisfies AiHrReport
})

export const buildLeaderboard = (
  report: AiHrReport,
  groupByKey: "provider" | "model" | "repo" | "day"
): ReadonlyArray<ReportGroup> => {
  const keyFor = (priced: PricedUsageEvent) => {
    switch (groupByKey) {
      case "model":
        return priced.event.model
      case "repo":
        return priced.event.repository ?? "unknown-repo"
      case "day":
        return DateTime.formatIsoDate(priced.event.occurredAt)
      case "provider":
        return priced.event.provider
    }
  }

  return [...groupBy(report.events, keyFor).entries()]
    .map(([key, events]) => buildGroup(key, undefined, events))
    .sort((left, right) => right.costUsd - left.costUsd)
}

export const providerLabel = (provider: Provider): string => {
  switch (provider) {
    case "codex":
      return "Codex"
    case "claude":
      return "Claude Code"
    case "opencode":
      return "OpenCode"
    case "openai":
      return "OpenAI"
    case "anthropic":
      return "Anthropic"
  }
}

export const formatUsd = (amount: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount >= 100 ? 0 : 2
  }).format(amount)

export const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

const buildGroup = (
  key: string,
  provider: Provider | undefined,
  events: ReadonlyArray<PricedUsageEvent>
): ReportGroup => {
  const tokens = events.reduce((sum, priced) => addUsageTokens(sum, priced.event), emptyTokenTotals)
  const sessions = new Set(events.map((priced) => priced.event.sessionId)).size
  const costUsd = events.reduce((sum, priced) => sum + priced.estimate.costUsd, 0)

  return {
    key,
    ...(provider === undefined ? {} : { provider }),
    sessions,
    events: events.length,
    tokens,
    costUsd,
    grade: gradeUsage(tokens, costUsd)
  }
}

const eventTokens = (event: UsageEvent): number =>
  event.inputTokens +
  event.cachedInputTokens +
  event.outputTokens +
  event.reasoningTokens +
  event.cacheWriteTokens +
  event.cacheReadTokens

const gradeUsage = (tokens: TokenTotals, costUsd: number): AgentGrade => {
  const total = totalTokens(tokens)
  const generated = Math.max(1, tokens.outputTokens + tokens.reasoningTokens)
  const contextRatio = tokens.inputTokens / generated
  const cacheRatio = (tokens.cachedInputTokens + tokens.cacheReadTokens) / Math.max(1, total)
  const contextPenalty = Math.min(38, contextRatio > 24 ? (contextRatio - 24) * 1.2 : 0)
  const costPenalty = Math.min(18, costUsd / 250)
  const cacheBonus = Math.min(8, cacheRatio * 30)
  const score = Math.max(0, Math.min(100, 88 - contextPenalty - costPenalty + cacheBonus))
  const grade = score >= 92 ? "A" : score >= 88 ? "A-" : score >= 84 ? "B+" : score >= 78 ? "B" : score >= 72 ? "B-" : score >= 62 ? "C" : score >= 50 ? "D" : "F"
  const warnings = contextRatio > 40 ? ["Context bloat tax is high."] : []
  const verdict = score >= 84
    ? "Hirable. Keep feeding this agent real work."
    : score >= 72
      ? "On notice. Productive, but dragging too much context into meetings."
      : "Performance review required before more budget goes out."

  return { grade, score, verdict, warnings }
}

const groupBy = <A>(
  values: ReadonlyArray<A>,
  keyFor: (value: A) => string
): Map<string, Array<A>> => {
  const groups = new Map<string, Array<A>>()
  for (const value of values) {
    const key = keyFor(value)
    const current = groups.get(key)
    if (current === undefined) {
      groups.set(key, [value])
    } else {
      current.push(value)
    }
  }
  return groups
}

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values.filter((value) => value.length > 0))]

const maxBy = <A>(
  values: ReadonlyArray<A>,
  score: (value: A) => number
): A | undefined =>
  values.reduce<A | undefined>(
    (best, value) => best === undefined || score(value) > score(best) ? value : best,
    undefined
  )

const minBy = <A>(
  values: ReadonlyArray<A>,
  score: (value: A) => number
): A | undefined =>
  values.reduce<A | undefined>(
    (best, value) => best === undefined || score(value) < score(best) ? value : best,
    undefined
  )
