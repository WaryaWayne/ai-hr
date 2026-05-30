import { Config, Context, Effect, Layer, Path } from "effect"

export class LocalPaths extends Context.Service<LocalPaths, {
  readonly home: string
  readonly codexSessionsDir: string
  readonly claudeProjectsDir: string
  readonly openCodeDbPath: string
}>()("ai-hr/LocalPaths") {}

export const LocalPathsLive = Layer.effect(
  LocalPaths,
  Effect.gen(function*() {
    const path = yield* Path.Path
    const home = yield* Config.string("HOME").pipe(Config.withDefault("."))

    return LocalPaths.of({
      home,
      codexSessionsDir: path.join(home, ".codex", "sessions"),
      claudeProjectsDir: path.join(home, ".claude", "projects"),
      openCodeDbPath: path.join(home, ".local", "share", "opencode", "opencode.db")
    })
  })
)
