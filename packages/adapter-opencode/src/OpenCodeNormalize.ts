import { DateTime, Effect, Result, Schema } from "effect"
import {
  NonNegativeInt,
  UsageDecodeError,
  UsageEventSchema,
  dateTimeOrFallback,
  type UsageEvent
} from "../../core/src/Domain"

const NullableString = Schema.NullOr(Schema.String)
const NullableNumber = Schema.NullOr(Schema.Number)

export const OpenCodeSessionRowSchema = Schema.Struct({
  id: Schema.String,
  directory: NullableString,
  title: NullableString,
  time_created: Schema.Union([Schema.Number, Schema.String, Schema.Null]),
  time_updated: Schema.Union([Schema.Number, Schema.String, Schema.Null]),
  agent: NullableString,
  model: NullableString,
  cost: NullableNumber,
  tokens_input: NonNegativeInt,
  tokens_output: NonNegativeInt,
  tokens_reasoning: NonNegativeInt,
  tokens_cache_read: NonNegativeInt,
  tokens_cache_write: NonNegativeInt
})
export type OpenCodeSessionRow = Schema.Schema.Type<typeof OpenCodeSessionRowSchema>

export const rowsToUsageEvents = Effect.fn("OpenCodeNormalize.rowsToUsageEvents")(function*(
  dbPath: string,
  rows: ReadonlyArray<OpenCodeSessionRow>
) {
  const fallbackDate = yield* DateTime.now
  const events: Array<UsageEvent> = []

  for (const row of rows) {
    const occurredAt = safeDateTime(row.time_updated ?? row.time_created, fallbackDate)
    const candidate = {
      id: `opencode:${row.id}`,
      provider: "opencode" as const,
      source: {
        provider: "opencode" as const,
        kind: "opencode-sqlite",
        path: dbPath,
        sessionId: row.id,
        title: row.title ?? undefined,
        repository: row.directory ?? undefined
      },
      sessionId: row.id,
      occurredAt,
      model: row.model ?? "unknown-opencode-model",
      agentName: row.agent ?? undefined,
      repository: row.directory ?? undefined,
      inputTokens: row.tokens_input,
      cachedInputTokens: 0,
      outputTokens: row.tokens_output,
      reasoningTokens: row.tokens_reasoning,
      cacheWriteTokens: row.tokens_cache_write,
      cacheReadTokens: row.tokens_cache_read
    }
    const decoded = Schema.decodeUnknownResult(UsageEventSchema)(candidate)
    if (Result.isFailure(decoded)) {
      return yield* new UsageDecodeError({
        source: dbPath,
        message: "OpenCode row did not normalize into UsageEvent.",
        cause: decoded.failure
      })
    }
    events.push(decoded.success)
  }

  return events
})

const safeDateTime = (input: unknown, fallback: DateTime.Utc): DateTime.Utc => {
  try {
    if (typeof input === "number") {
      return DateTime.makeUnsafe(input < 10_000_000_000 ? input * 1000 : input)
    }
    return dateTimeOrFallback(input, fallback)
  } catch {
    return fallback
  }
}
