import { Data, DateTime, Schema } from "effect"

export const ProviderSchema = Schema.Literals([
  "codex",
  "claude",
  "opencode",
  "openai",
  "anthropic"
])
export type Provider = Schema.Schema.Type<typeof ProviderSchema>

export const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))

export const SourceRefSchema = Schema.Struct({
  provider: ProviderSchema,
  kind: Schema.String,
  path: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  title: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.String)
})
export type SourceRef = Schema.Schema.Type<typeof SourceRefSchema>

export const UsageEventSchema = Schema.Struct({
  id: Schema.String,
  provider: ProviderSchema,
  source: SourceRefSchema,
  sessionId: Schema.String,
  occurredAt: Schema.DateTimeUtc,
  model: Schema.String,
  agentName: Schema.optionalKey(Schema.String),
  repository: Schema.optionalKey(Schema.String),
  inputTokens: NonNegativeInt,
  cachedInputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  reasoningTokens: NonNegativeInt,
  cacheWriteTokens: NonNegativeInt,
  cacheReadTokens: NonNegativeInt
})
export type UsageEvent = Schema.Schema.Type<typeof UsageEventSchema>

export const PricingRuleSchema = Schema.Struct({
  provider: ProviderSchema,
  modelPattern: Schema.String,
  label: Schema.String,
  inputPerMillion: NonNegativeNumber,
  cachedInputPerMillion: Schema.optionalKey(NonNegativeNumber),
  outputPerMillion: NonNegativeNumber,
  reasoningOutputPerMillion: Schema.optionalKey(NonNegativeNumber),
  cacheWritePerMillion: Schema.optionalKey(NonNegativeNumber),
  cacheReadPerMillion: Schema.optionalKey(NonNegativeNumber),
  sourceUrl: Schema.String,
  confidence: Schema.Literals(["exact", "alias", "approximation"]),
  assumptions: Schema.Array(Schema.String)
})
export type PricingRule = Schema.Schema.Type<typeof PricingRuleSchema>

export const CostEstimateSchema = Schema.Struct({
  eventId: Schema.String,
  provider: ProviderSchema,
  model: Schema.String,
  costUsd: NonNegativeNumber,
  inputCostUsd: NonNegativeNumber,
  outputCostUsd: NonNegativeNumber,
  reasoningCostUsd: NonNegativeNumber,
  cacheCostUsd: NonNegativeNumber,
  pricingRuleLabel: Schema.optionalKey(Schema.String),
  sourceUrl: Schema.optionalKey(Schema.String),
  warnings: Schema.Array(Schema.String)
})
export type CostEstimate = Schema.Schema.Type<typeof CostEstimateSchema>

export const AgentGradeSchema = Schema.Struct({
  grade: Schema.Literals(["A", "A-", "B+", "B", "B-", "C", "D", "F"]),
  score: NonNegativeNumber,
  verdict: Schema.String,
  warnings: Schema.Array(Schema.String)
})
export type AgentGrade = Schema.Schema.Type<typeof AgentGradeSchema>

export type TokenTotals = {
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly cacheWriteTokens: number
  readonly cacheReadTokens: number
}

export const emptyTokenTotals: TokenTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0
}

export const totalTokens = (totals: TokenTotals): number =>
  totals.inputTokens +
  totals.cachedInputTokens +
  totals.outputTokens +
  totals.reasoningTokens +
  totals.cacheWriteTokens +
  totals.cacheReadTokens

export const usageEventTotalTokens = (event: UsageEvent): number =>
  event.inputTokens +
  event.cachedInputTokens +
  event.outputTokens +
  event.reasoningTokens +
  event.cacheWriteTokens +
  event.cacheReadTokens

export const addUsageTokens = (left: TokenTotals, event: UsageEvent): TokenTotals => ({
  inputTokens: left.inputTokens + event.inputTokens,
  cachedInputTokens: left.cachedInputTokens + event.cachedInputTokens,
  outputTokens: left.outputTokens + event.outputTokens,
  reasoningTokens: left.reasoningTokens + event.reasoningTokens,
  cacheWriteTokens: left.cacheWriteTokens + event.cacheWriteTokens,
  cacheReadTokens: left.cacheReadTokens + event.cacheReadTokens
})

export const dateTimeOrFallback = (
  input: unknown,
  fallback: DateTime.Utc
) =>
  typeof input === "string" || typeof input === "number" || input instanceof Date
    ? DateTime.makeUnsafe(input)
    : fallback

export class PeriodParseError extends Data.TaggedError("PeriodParseError")<{
  readonly input: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class UsageDecodeError extends Data.TaggedError("UsageDecodeError")<{
  readonly source: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class SourceReadError extends Data.TaggedError("SourceReadError")<{
  readonly source: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class PricingRuleNotFound extends Data.TaggedError("PricingRuleNotFound")<{
  readonly provider: Provider
  readonly model: string
}> {}
