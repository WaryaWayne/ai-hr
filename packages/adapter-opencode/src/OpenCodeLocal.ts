import { Database } from "bun:sqlite"
import { Context, Effect, FileSystem, Layer, Path, Result, Schema } from "effect"
import {
  SourceReadError,
  UsageDecodeError,
  type UsageEvent
} from "../../core/src/Domain"
import { LocalPaths } from "../../core/src/LocalPaths"
import { inPeriod, type ReportPeriod } from "../../core/src/Period"
import { OpenCodeSessionRowSchema, rowsToUsageEvents, type OpenCodeSessionRow } from "./OpenCodeNormalize"

export class OpenCodeLocalSessions extends Context.Service<OpenCodeLocalSessions, {
  readonly scan: (period: ReportPeriod) => Effect.Effect<ReadonlyArray<UsageEvent>, SourceReadError | UsageDecodeError>
  readonly explain: (sessionId: string) => Effect.Effect<ReadonlyArray<UsageEvent>, SourceReadError | UsageDecodeError>
}>()("ai-hr/OpenCodeLocalSessions") {}

export const scanOpenCodeSessions = Effect.fn("OpenCodeLocal.scan")(function*(period: ReportPeriod) {
  const paths = yield* LocalPaths
  const rows = yield* readOpenCodeRows(paths.openCodeDbPath)
  return (yield* rowsToUsageEvents(paths.openCodeDbPath, rows))
    .filter((event) => inPeriod(event.occurredAt, period))
})

export const explainOpenCodeSession = Effect.fn("OpenCodeLocal.explain")(function*(sessionId: string) {
  const paths = yield* LocalPaths
  const rows = yield* readOpenCodeRows(paths.openCodeDbPath)
  return (yield* rowsToUsageEvents(paths.openCodeDbPath, rows))
    .filter((event) => event.sessionId === sessionId)
})

export const readOpenCodeRows = Effect.fn("OpenCodeLocal.readRows")(function*(dbPath: string) {
  const fs = yield* FileSystem.FileSystem
  const exists = yield* fs.exists(dbPath).pipe(
    Effect.mapError((cause) => new SourceReadError({ source: dbPath, message: "Could not check OpenCode database path.", cause }))
  )
  if (!exists) return []

  const query = `
    SELECT
      id,
      directory,
      title,
      time_created,
      time_updated,
      agent,
      model,
      cost,
      coalesce(tokens_input, 0) as tokens_input,
      coalesce(tokens_output, 0) as tokens_output,
      coalesce(tokens_reasoning, 0) as tokens_reasoning,
      coalesce(tokens_cache_read, 0) as tokens_cache_read,
      coalesce(tokens_cache_write, 0) as tokens_cache_write
    FROM session
    WHERE coalesce(tokens_input, 0)
      + coalesce(tokens_output, 0)
      + coalesce(tokens_reasoning, 0)
      + coalesce(tokens_cache_read, 0)
      + coalesce(tokens_cache_write, 0) > 0
  `

  const rows = yield* Effect.scoped(
    Effect.gen(function*() {
      const db = yield* Effect.acquireRelease(
        Effect.try({
          try: () => new Database(dbPath, { readonly: true }),
          catch: (cause) => new SourceReadError({ source: dbPath, message: "Could not open OpenCode database.", cause })
        }),
        (db) => Effect.sync(() => db.close())
      )
      return yield* Effect.try({
        try: () => db.query(query).all() as ReadonlyArray<unknown>,
        catch: (cause) => new SourceReadError({ source: dbPath, message: "Could not query OpenCode sessions.", cause })
      })
    })
  )

  const decoded: Array<OpenCodeSessionRow> = []
  for (const row of rows) {
    const result = Schema.decodeUnknownResult(OpenCodeSessionRowSchema)(row)
    if (Result.isFailure(result)) {
      return yield* new UsageDecodeError({
        source: dbPath,
        message: "OpenCode session row did not decode.",
        cause: result.failure
      })
    }
    decoded.push(result.success)
  }
  return decoded
})

const provideOpenCodeDependencies = <A, E>(
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

export const OpenCodeLocalSessionsLive = Layer.effect(
  OpenCodeLocalSessions,
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const paths = yield* LocalPaths
    const path = yield* Path.Path
    const dependencies = { fs, paths, path }

    return OpenCodeLocalSessions.of({
      scan: (period) => provideOpenCodeDependencies(scanOpenCodeSessions(period), dependencies),
      explain: (sessionId) => provideOpenCodeDependencies(explainOpenCodeSession(sessionId), dependencies)
    })
  })
)
