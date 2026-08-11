import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Result, Schema } from "effect"
import {
  NonNegativeInt,
  SourceReadError,
  UsageDecodeError,
  UsageEventSchema,
  dateTimeOrFallback,
  type UsageEvent
} from "../../core/src/Domain"
import { LocalPaths } from "../../core/src/LocalPaths"
import { inPeriod, type ReportPeriod } from "../../core/src/Period"

export class ClaudeLocalSessions extends Context.Service<ClaudeLocalSessions, {
  readonly scan: (period: ReportPeriod) => Effect.Effect<ReadonlyArray<UsageEvent>, SourceReadError | UsageDecodeError>
  readonly explain: (sessionId: string) => Effect.Effect<ReadonlyArray<UsageEvent>, SourceReadError | UsageDecodeError>
}>()("ai-hr/ClaudeLocalSessions") {}

const ClaudeUsageSchema = Schema.Struct({
  input_tokens: NonNegativeInt,
  output_tokens: NonNegativeInt,
  cache_creation_input_tokens: Schema.optionalKey(NonNegativeInt),
  cache_read_input_tokens: Schema.optionalKey(NonNegativeInt)
})

const ClaudeAssistantRecordSchema = Schema.Struct({
  type: Schema.Literal("assistant"),
  timestamp: Schema.optionalKey(Schema.String),
  sessionId: Schema.optionalKey(Schema.String),
  session_id: Schema.optionalKey(Schema.String),
  requestId: Schema.optionalKey(Schema.String),
  request_id: Schema.optionalKey(Schema.String),
  uuid: Schema.optionalKey(Schema.String),
  cwd: Schema.optionalKey(Schema.String),
  message: Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    model: Schema.String,
    usage: ClaudeUsageSchema
  })
})
type ClaudeAssistantRecord = Schema.Schema.Type<typeof ClaudeAssistantRecordSchema>

const JsonLineSchema = Schema.fromJsonString(Schema.Unknown)

export const scanClaudeSessions = Effect.fn("ClaudeLocal.scan")(function*(period: ReportPeriod) {
  const paths = yield* LocalPaths
  const files = yield* discoverClaudeFiles(paths.claudeProjectsDir)
  const events: Array<UsageEvent> = []

  for (const file of files) {
    const fileEvents = yield* readClaudeUsageFile(file)
    for (const event of fileEvents) {
      if (inPeriod(event.occurredAt, period)) events.push(event)
    }
  }

  return events
})

export const explainClaudeSession = Effect.fn("ClaudeLocal.explain")(function*(sessionId: string) {
  const paths = yield* LocalPaths
  const files = yield* discoverClaudeFiles(paths.claudeProjectsDir)
  const events: Array<UsageEvent> = []

  for (const file of files) {
    if (file.includes(sessionId)) {
      for (const event of yield* readClaudeUsageFile(file)) events.push(event)
    }
  }

  return events.filter((event) => event.sessionId === sessionId || event.source.path?.includes(sessionId) === true)
})

export const readClaudeUsageFile = Effect.fn("ClaudeLocal.readFile")(function*(filePath: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fallbackDate = yield* fileDate(filePath)
  const content = yield* fs.readFileString(filePath).pipe(
    Effect.mapError((cause) => new SourceReadError({ source: filePath, message: "Could not read Claude session file.", cause }))
  )

  return yield* normalizeClaudeJsonLines({
    filePath,
    sessionIdFallback: path.basename(filePath).replace(/\.jsonl$/, ""),
    fallbackDate,
    lines: content.split(/\r?\n/)
  })
})

export const normalizeClaudeJsonLines = Effect.fn("ClaudeLocal.normalize")(function*(input: {
  readonly filePath: string
  readonly sessionIdFallback: string
  readonly fallbackDate: DateTime.Utc
  readonly lines: ReadonlyArray<string>
}) {
  const seenRequests = new Set<string>()
  const events: Array<UsageEvent> = []

  for (let index = 0; index < input.lines.length; index++) {
    const line = input.lines[index]?.trim()
    if (line === undefined || line.length === 0) continue

    const record = yield* parseJsonLine(line, input.filePath, index + 1)
    const assistant = Schema.decodeUnknownOption(ClaudeAssistantRecordSchema)(record)
    if (Option.isSome(assistant)) {
      const dedupeKey = claudeDedupeKey(assistant.value)
      if (seenRequests.has(dedupeKey)) continue
      seenRequests.add(dedupeKey)
      events.push(yield* makeClaudeUsageEvent({
        filePath: input.filePath,
        lineNumber: index + 1,
        sessionIdFallback: input.sessionIdFallback,
        fallbackDate: input.fallbackDate,
        record: assistant.value
      }))
    }
  }

  return events
})

const discoverClaudeFiles = Effect.fn("ClaudeLocal.discover")(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const exists = yield* fs.exists(dir).pipe(
    Effect.mapError((cause) => new SourceReadError({ source: dir, message: "Could not check Claude projects directory.", cause }))
  )
  if (!exists) return []

  const entries = yield* fs.readDirectory(dir, { recursive: true }).pipe(
    Effect.mapError((cause) => new SourceReadError({ source: dir, message: "Could not list Claude sessions.", cause }))
  )

  return entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => path.isAbsolute(entry) ? entry : path.join(dir, entry))
})

const makeClaudeUsageEvent = Effect.fn("ClaudeLocal.makeUsageEvent")(function*(input: {
  readonly filePath: string
  readonly lineNumber: number
  readonly sessionIdFallback: string
  readonly fallbackDate: DateTime.Utc
  readonly record: ClaudeAssistantRecord
}) {
  const usage = input.record.message.usage
  const sessionId = input.record.sessionId ?? input.record.session_id ?? input.sessionIdFallback
  const candidate = {
    id: `claude:${sessionId}:${input.lineNumber}:${claudeDedupeKey(input.record)}`,
    provider: "claude" as const,
    source: {
      provider: "claude" as const,
      kind: "claude-jsonl",
      path: input.filePath,
      sessionId,
      repository: input.record.cwd
    },
    sessionId,
    occurredAt: safeDateTime(input.record.timestamp, input.fallbackDate),
    model: input.record.message.model,
    repository: input.record.cwd,
    inputTokens: usage.input_tokens,
    cachedInputTokens: 0,
    outputTokens: usage.output_tokens,
    reasoningTokens: 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0
  }
  const decoded = Schema.decodeUnknownResult(UsageEventSchema)(candidate)
  if (Result.isFailure(decoded)) {
    return yield* new UsageDecodeError({
      source: input.filePath,
      message: "Claude token usage did not decode into UsageEvent.",
      cause: decoded.failure
    })
  }
  return decoded.success
})

const claudeDedupeKey = (record: ClaudeAssistantRecord): string =>
  record.requestId ?? record.request_id ?? record.message.id ?? record.uuid ?? "unknown-request"

const parseJsonLine = (line: string, source: string, lineNumber: number) =>
  Schema.decodeUnknownEffect(JsonLineSchema)(line).pipe(
    Effect.mapError((cause) =>
      new UsageDecodeError({
        source,
        message: `Invalid JSON at line ${lineNumber}.`,
        cause
      })
    )
  )

function provideClaudeDependencies<A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | LocalPaths | Path.Path>,
  dependencies: {
    readonly fs: FileSystem.FileSystem
    readonly paths: Context.Service.Shape<typeof LocalPaths>
    readonly path: Path.Path
  }
): Effect.Effect<A, E> {
  return effect.pipe(
    Effect.provideService(FileSystem.FileSystem, dependencies.fs),
    Effect.provideService(LocalPaths, dependencies.paths),
    Effect.provideService(Path.Path, dependencies.path)
  )
}

const safeDateTime = (input: unknown, fallback: DateTime.Utc): DateTime.Utc => {
  try {
    return dateTimeOrFallback(input, fallback)
  } catch {
    return fallback
  }
}

const fileDate = Effect.fn("ClaudeLocal.fileDate")(function*(filePath: string) {
  const fs = yield* FileSystem.FileSystem
  const stat = yield* fs.stat(filePath).pipe(
    Effect.mapError((cause) => new SourceReadError({ source: filePath, message: "Could not stat Claude session file.", cause }))
  )
  return Option.isSome(stat.mtime) ? DateTime.makeUnsafe(stat.mtime.value) : yield* DateTime.now
})

export const ClaudeLocalSessionsLive = Layer.effect(
  ClaudeLocalSessions,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const paths = yield* LocalPaths
    const path = yield* Path.Path
    const dependencies = { fs, paths, path }

    return ClaudeLocalSessions.of({
      scan: (period) => provideClaudeDependencies(scanClaudeSessions(period), dependencies),
      explain: (sessionId) => provideClaudeDependencies(explainClaudeSession(sessionId), dependencies)
    })
  })
)
