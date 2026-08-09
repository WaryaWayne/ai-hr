import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, Result, Schema, Stream } from "effect"
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

export class CodexLocalSessions extends Context.Service<CodexLocalSessions, {
  readonly scan: (period: ReportPeriod) => Effect.Effect<ReadonlyArray<UsageEvent>, SourceReadError | UsageDecodeError>
  readonly explain: (sessionId: string) => Effect.Effect<ReadonlyArray<UsageEvent>, SourceReadError | UsageDecodeError>
}>()("ai-hr/CodexLocalSessions") {}

const RawCodexUsageSchema = Schema.Struct({
  input_tokens: NonNegativeInt,
  cached_input_tokens: Schema.optionalKey(NonNegativeInt),
  output_tokens: NonNegativeInt,
  reasoning_output_tokens: Schema.optionalKey(NonNegativeInt)
})
type RawCodexUsage = Schema.Schema.Type<typeof RawCodexUsageSchema>

const CodexTokenCountRecordSchema = Schema.Struct({
  type: Schema.Literal("token_count"),
  timestamp: Schema.optionalKey(Schema.String),
  info: Schema.Struct({
    total_token_usage: RawCodexUsageSchema,
    last_token_usage: RawCodexUsageSchema
  })
})

const CodexTurnCompletedRecordSchema = Schema.Struct({
  type: Schema.Literal("turn.completed"),
  timestamp: Schema.optionalKey(Schema.String),
  usage: RawCodexUsageSchema
})

const CodexEventMessageTokenCountRecordSchema = Schema.Struct({
  type: Schema.Literal("event_msg"),
  timestamp: Schema.optionalKey(Schema.String),
  payload: Schema.Struct({
    type: Schema.Literal("token_count"),
    info: Schema.NullOr(Schema.Struct({
      total_token_usage: RawCodexUsageSchema,
      last_token_usage: RawCodexUsageSchema
    }))
  })
})

const CodexSessionMetaRecordSchema = Schema.Struct({
  type: Schema.Literal("session_meta"),
  timestamp: Schema.optionalKey(Schema.String),
  payload: Schema.Struct({
    id: Schema.String,
    cwd: Schema.optionalKey(Schema.String),
    model: Schema.optionalKey(Schema.String)
  })
})

const CodexTurnContextRecordSchema = Schema.Struct({
  type: Schema.Literal("turn_context"),
  timestamp: Schema.optionalKey(Schema.String),
  payload: Schema.Struct({
    cwd: Schema.optionalKey(Schema.String),
    model: Schema.optionalKey(Schema.String),
    session_id: Schema.optionalKey(Schema.String)
  })
})

type CodexState = {
  sessionId: string
  model: string
  repository: string | undefined
  seenTotals: Set<string>
}

const JsonLineSchema = Schema.fromJsonString(Schema.Unknown)

export const scanCodexSessions = Effect.fn("CodexLocal.scan")(function*(period: ReportPeriod) {
  const paths = yield* LocalPaths
  const files = yield* discoverCodexFiles(paths.codexSessionsDir)
  const events: Array<UsageEvent> = []

  for (const file of files) {
    const fileEvents = yield* readCodexUsageFile(file)
    for (const event of fileEvents) {
      if (inPeriod(event.occurredAt, period)) events.push(event)
    }
  }

  return events
})

export const explainCodexSession = Effect.fn("CodexLocal.explain")(function*(sessionId: string) {
  const paths = yield* LocalPaths
  const files = yield* discoverCodexFiles(paths.codexSessionsDir)
  const events: Array<UsageEvent> = []

  for (const file of files) {
    if (file.includes(sessionId)) {
      for (const event of yield* readCodexUsageFile(file)) events.push(event)
    }
  }

  return events.filter((event) => event.sessionId === sessionId || event.source.path?.includes(sessionId) === true)
})

export const readCodexUsageFile = Effect.fn("CodexLocal.readFile")(function*(filePath: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const fallbackDate = yield* fileDate(filePath)
  const state = makeCodexState(path.basename(filePath).replace(/\.jsonl$/, ""))
  const events: Array<UsageEvent> = []

  const lines = fs.stream(filePath).pipe(
    Stream.mapError((cause) =>
      new SourceReadError({ source: filePath, message: "Could not read Codex session file.", cause })
    ),
    Stream.decodeText,
    Stream.splitLines,
    Stream.zipWithIndex
  )

  yield* lines.pipe(
    Stream.runForEach(([line, index]) =>
      normalizeCodexJsonLine({
        filePath,
        line,
        lineNumber: index + 1,
        fallbackDate,
        state
      }).pipe(
        Effect.map((event) => {
          if (event !== undefined) events.push(event)
        })
      )
    )
  )

  return events
})

export const normalizeCodexJsonLines = Effect.fn("CodexLocal.normalize")(function*(input: {
  readonly filePath: string
  readonly sessionIdFallback: string
  readonly fallbackDate: DateTime.Utc
  readonly lines: ReadonlyArray<string>
}) {
  const state = makeCodexState(input.sessionIdFallback)
  const events: Array<UsageEvent> = []

  for (let index = 0; index < input.lines.length; index++) {
    const line = input.lines[index]
    if (line === undefined) continue

    const event = yield* normalizeCodexJsonLine({
      filePath: input.filePath,
      line,
      lineNumber: index + 1,
      fallbackDate: input.fallbackDate,
      state
    })
    if (event !== undefined) events.push(event)
  }

  return events
})

const normalizeCodexJsonLine = Effect.fn("CodexLocal.normalizeLine")(function*(input: {
  readonly filePath: string
  readonly line: string
  readonly lineNumber: number
  readonly fallbackDate: DateTime.Utc
  readonly state: CodexState
}) {
  const line = input.line.trim()
  if (line.length === 0) return undefined

  const record = yield* parseJsonLine(line, input.filePath, input.lineNumber)
  applyMetadata(record, input.state)

  const eventMessage = Schema.decodeUnknownOption(CodexEventMessageTokenCountRecordSchema)(record)
  if (Option.isSome(eventMessage)) {
    if (eventMessage.value.payload.info === null) return undefined

    const totalSignature = usageSignature(eventMessage.value.payload.info.total_token_usage)
    if (input.state.seenTotals.has(totalSignature)) return undefined

    input.state.seenTotals.add(totalSignature)
    return yield* makeCodexUsageEvent({
      filePath: input.filePath,
      lineNumber: input.lineNumber,
      state: input.state,
      usage: eventMessage.value.payload.info.last_token_usage,
      occurredAt: safeDateTime(eventMessage.value.timestamp, input.fallbackDate),
      idSuffix: totalSignature
    })
  }

  const tokenCount = Schema.decodeUnknownOption(CodexTokenCountRecordSchema)(record)
  if (Option.isSome(tokenCount)) {
    const totalSignature = usageSignature(tokenCount.value.info.total_token_usage)
    if (input.state.seenTotals.has(totalSignature)) return undefined

    input.state.seenTotals.add(totalSignature)
    return yield* makeCodexUsageEvent({
      filePath: input.filePath,
      lineNumber: input.lineNumber,
      state: input.state,
      usage: tokenCount.value.info.last_token_usage,
      occurredAt: safeDateTime(tokenCount.value.timestamp, input.fallbackDate),
      idSuffix: totalSignature
    })
  }

  const turnCompleted = Schema.decodeUnknownOption(CodexTurnCompletedRecordSchema)(record)
  if (Option.isSome(turnCompleted)) {
    return yield* makeCodexUsageEvent({
      filePath: input.filePath,
      lineNumber: input.lineNumber,
      state: input.state,
      usage: turnCompleted.value.usage,
      occurredAt: safeDateTime(turnCompleted.value.timestamp, input.fallbackDate),
      idSuffix: usageSignature(turnCompleted.value.usage)
    })
  }

  return undefined
})

const makeCodexState = (sessionId: string): CodexState => ({
  sessionId,
  model: "gpt-5-codex",
  repository: undefined,
  seenTotals: new Set()
})

const discoverCodexFiles = Effect.fn("CodexLocal.discover")(function*(dir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const exists = yield* fs.exists(dir).pipe(
    Effect.mapError((cause) => new SourceReadError({ source: dir, message: "Could not check Codex sessions directory.", cause }))
  )
  if (!exists) return []

  const entries = yield* fs.readDirectory(dir, { recursive: true }).pipe(
    Effect.mapError((cause) => new SourceReadError({ source: dir, message: "Could not list Codex sessions.", cause }))
  )

  return entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => path.isAbsolute(entry) ? entry : path.join(dir, entry))
})

const makeCodexUsageEvent = Effect.fn("CodexLocal.makeUsageEvent")(function*(input: {
  readonly filePath: string
  readonly lineNumber: number
  readonly state: CodexState
  readonly usage: RawCodexUsage
  readonly occurredAt: DateTime.Utc
  readonly idSuffix: string
}) {
  const candidate = {
    id: `codex:${input.state.sessionId}:${input.lineNumber}:${input.idSuffix}`,
    provider: "codex" as const,
    source: {
      provider: "codex" as const,
      kind: "codex-jsonl",
      path: input.filePath,
      sessionId: input.state.sessionId,
      repository: input.state.repository
    },
    sessionId: input.state.sessionId,
    occurredAt: input.occurredAt,
    model: input.state.model,
    repository: input.state.repository,
    inputTokens: input.usage.input_tokens,
    cachedInputTokens: input.usage.cached_input_tokens ?? 0,
    outputTokens: input.usage.output_tokens,
    reasoningTokens: input.usage.reasoning_output_tokens ?? 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0
  }
  const decoded = Schema.decodeUnknownResult(UsageEventSchema)(candidate)
  if (Result.isFailure(decoded)) {
    return yield* new UsageDecodeError({
      source: input.filePath,
      message: "Codex token usage did not decode into UsageEvent.",
      cause: decoded.failure
    })
  }
  return decoded.success
})

const applyMetadata = (record: unknown, state: CodexState): void => {
  const sessionMeta = Schema.decodeUnknownOption(CodexSessionMetaRecordSchema)(record)
  if (Option.isSome(sessionMeta)) {
    state.sessionId = sessionMeta.value.payload.id
    state.repository = sessionMeta.value.payload.cwd ?? state.repository
    state.model = sessionMeta.value.payload.model ?? state.model
    return
  }

  const turnContext = Schema.decodeUnknownOption(CodexTurnContextRecordSchema)(record)
  if (Option.isSome(turnContext)) {
    state.sessionId = turnContext.value.payload.session_id ?? state.sessionId
    state.repository = turnContext.value.payload.cwd ?? state.repository
    state.model = turnContext.value.payload.model ?? state.model
  }
}

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

const provideCodexDependencies = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | LocalPaths | Path.Path>,
  dependencies: {
    readonly fs: FileSystem.FileSystem
    readonly paths: Context.Service.Shape<typeof LocalPaths>
    readonly path: Path.Path
  }
): Effect.Effect<A, E> =>
  effect.pipe(
    Effect.provideService(FileSystem.FileSystem, dependencies.fs),
    Effect.provideService(LocalPaths, dependencies.paths),
    Effect.provideService(Path.Path, dependencies.path)
  )

const usageSignature = (usage: RawCodexUsage): string =>
  [
    usage.input_tokens,
    usage.cached_input_tokens ?? 0,
    usage.output_tokens,
    usage.reasoning_output_tokens ?? 0
  ].join(":")

const safeDateTime = (input: unknown, fallback: DateTime.Utc): DateTime.Utc => {
  try {
    return dateTimeOrFallback(input, fallback)
  } catch {
    return fallback
  }
}

const fileDate = Effect.fn("CodexLocal.fileDate")(function*(filePath: string) {
  const fs = yield* FileSystem.FileSystem
  const stat = yield* fs.stat(filePath).pipe(
    Effect.mapError((cause) => new SourceReadError({ source: filePath, message: "Could not stat Codex session file.", cause }))
  )
  return Option.isSome(stat.mtime) ? DateTime.makeUnsafe(stat.mtime.value) : yield* DateTime.now
})

export const CodexLocalSessionsLive = Layer.effect(
  CodexLocalSessions,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const paths = yield* LocalPaths
    const path = yield* Path.Path
    const dependencies = { fs, paths, path }

    return CodexLocalSessions.of({
      scan: (period) => provideCodexDependencies(scanCodexSessions(period), dependencies),
      explain: (sessionId) => provideCodexDependencies(explainCodexSession(sessionId), dependencies)
    })
  })
)
