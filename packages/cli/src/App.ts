import { Console, Effect, FileSystem, Layer, Path, Schema } from "effect"
import { CodexLocalSessions, CodexLocalSessionsLive } from "../../adapter-codex/src/CodexLocal"
import { ClaudeLocalSessions, ClaudeLocalSessionsLive } from "../../adapter-claude/src/ClaudeLocal"
import { OpenCodeLocalSessions, OpenCodeLocalSessionsLive } from "../../adapter-opencode/src/OpenCodeLocal"
import { PricingCatalog, PricingCatalogLive } from "../../core/src/PricingCatalog"
import { buildAiHrReport } from "../../core/src/Report"
import { renderLeaderboard, renderReport, type ReportFormat } from "../../core/src/Renderers"
import { LocalPaths, LocalPathsLive } from "../../core/src/LocalPaths"
import { parseReportPeriod, type ReportPeriod } from "../../core/src/Period"
import { usageEventTotalTokens, type UsageEvent } from "../../core/src/Domain"
import { sdkSurfaceChecks } from "./SdkSurface"

export type SourceName = "codex" | "claude" | "opencode"
export type PackageMetadata = {
  readonly name: string
  readonly version: string
}

const PackageMetadataSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String
})

const LocalSessionLayers = Layer.mergeAll(
  CodexLocalSessionsLive,
  ClaudeLocalSessionsLive,
  OpenCodeLocalSessionsLive
).pipe(Layer.provideMerge(LocalPathsLive))

export const AppLayer = Layer.mergeAll(
  PricingCatalogLive,
  LocalSessionLayers
)

export const runReport = Effect.fn("Cli.runReport")(function*(input: {
  readonly since: string
  readonly until?: string
  readonly sources: string
  readonly format: ReportFormat
  readonly includeHeader?: boolean
}) {
  const metadata = yield* readPackageMetadata()
  const period = yield* parseReportPeriod(input.since, input.until)
  const events = yield* collectUsageEvents(parseSources(input.sources), period)
  const pricing = yield* PricingCatalog
  const priced = events.map((event) => ({ event, estimate: pricing.estimate(event) }))
  const report = yield* buildAiHrReport(priced, period)
  return renderReport(report, input.format, {
    packageName: metadata.name,
    packageVersion: metadata.version,
    ...(input.includeHeader === undefined ? {} : { includeHeader: input.includeHeader })
  })
})

export const runScan = Effect.fn("Cli.runScan")(function*(input: {
  readonly since: string
  readonly until?: string
  readonly sources: string
}) {
  const period = yield* parseReportPeriod(input.since, input.until)
  const selected = parseSources(input.sources)
  const allEvents: Array<UsageEvent> = []

  for (const source of selected) {
    yield* Console.log(`Checking ${source}...`)
    const events = yield* collectUsageEvents([source], period)
    yield* Console.log(`Got ${events.length} usage events for ${source}.`)
    allEvents.push(...events)
  }

  return `Scan complete. ${allEvents.length} local usage events found.`
})

export const runPayroll = Effect.fn("Cli.runPayroll")(function*(input: {
  readonly since: string
  readonly until?: string
  readonly sources: string
}) {
  const period = yield* parseReportPeriod(input.since, input.until)
  const events = yield* collectUsageEvents(parseSources(input.sources), period)
  const pricing = yield* PricingCatalog
  const report = yield* buildAiHrReport(
    events.map((event) => ({ event, estimate: pricing.estimate(event) })),
    period
  )
  return [
    "AI HR Payroll",
    `Period: ${report.period.label}`,
    `Total API-equivalent payroll: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(report.totalCostUsd)}`,
    "",
    renderLeaderboard(report, "provider")
  ].join("\n")
})

export const runLeaderboard = Effect.fn("Cli.runLeaderboard")(function*(input: {
  readonly since: string
  readonly until?: string
  readonly sources: string
  readonly groupBy: "provider" | "model" | "repo" | "day"
}) {
  const period = yield* parseReportPeriod(input.since, input.until)
  const events = yield* collectUsageEvents(parseSources(input.sources), period)
  const pricing = yield* PricingCatalog
  const report = yield* buildAiHrReport(
    events.map((event) => ({ event, estimate: pricing.estimate(event) })),
    period
  )
  return renderLeaderboard(report, input.groupBy)
})

export const runExplain = Effect.fn("Cli.runExplain")(function*(input: {
  readonly session: string
  readonly sources: string
  readonly format: ReportFormat
}) {
  const metadata = yield* readPackageMetadata()
  const selected = parseSources(input.sources)
  const events: Array<UsageEvent> = []
  const codex = yield* CodexLocalSessions
  const claude = yield* ClaudeLocalSessions
  const opencode = yield* OpenCodeLocalSessions

  for (const source of selected) {
    if (source === "codex") events.push(...(yield* codex.explain(input.session)))
    if (source === "claude") events.push(...(yield* claude.explain(input.session)))
    if (source === "opencode") events.push(...(yield* opencode.explain(input.session)))
  }

  const pricing = yield* PricingCatalog
  const period = yield* parseReportPeriod("3650d")
  const report = yield* buildAiHrReport(
    events.map((event) => ({ event, estimate: pricing.estimate(event) })),
    period
  )
  return renderReport(report, input.format, {
    packageName: metadata.name,
    packageVersion: metadata.version
  })
})

export const readPackageMetadata = Effect.fn("Cli.readPackageMetadata")(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const currentFile = yield* path.fromFileUrl(new URL(import.meta.url))
  const packageJsonPath = yield* findPackageJson(path.dirname(currentFile))
  const packageJson = yield* fs.readFileString(packageJsonPath)
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PackageMetadataSchema))(packageJson)
})

const findPackageJson = Effect.fn("Cli.findPackageJson")(function*(startDir: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  let current = startDir

  while (true) {
    const candidate = path.join(current, "package.json")
    const exists = yield* fs.exists(candidate)
    if (exists) return candidate

    const parent = path.dirname(current)
    if (parent === current) return candidate
    current = parent
  }
})

export const runDoctor = Effect.fn("Cli.runDoctor")(function*() {
  const fs = yield* FileSystem.FileSystem
  const paths = yield* LocalPaths
  const checks = [
    ["Codex sessions", paths.codexSessionsDir, yield* fs.exists(paths.codexSessionsDir)],
    ["Claude projects", paths.claudeProjectsDir, yield* fs.exists(paths.claudeProjectsDir)],
    ["OpenCode database", paths.openCodeDbPath, yield* fs.exists(paths.openCodeDbPath)],
    ["OpenAI Codex SDK package", "node_modules/@openai/codex-sdk/package.json", yield* fs.exists("node_modules/@openai/codex-sdk/package.json")],
    ["Claude Agent SDK package", "node_modules/@anthropic-ai/claude-agent-sdk/package.json", yield* fs.exists("node_modules/@anthropic-ai/claude-agent-sdk/package.json")],
    ["OpenCode SDK package", "node_modules/@opencode-ai/sdk/package.json", yield* fs.exists("node_modules/@opencode-ai/sdk/package.json")],
    ["OpenAI API SDK package", "node_modules/openai/package.json", yield* fs.exists("node_modules/openai/package.json")]
  ] as const

  return [
    "AI HR Doctor",
    ...checks.map(([label, location, ok]) => `${ok ? "ok" : "missing"}  ${label}: ${location}`),
    ...sdkSurfaceChecks.map(([label, ok]) => `${ok ? "ok" : "missing"}  ${label}: loadable`),
    "",
    "Core reports stay local. Missing SDK packages only block future live API surfaces, not local history scanning."
  ].join("\n")
})

const collectUsageEvents = Effect.fn("Cli.collectUsageEvents")(function*(
  sources: ReadonlyArray<SourceName>,
  period: ReportPeriod
) {
  const codex = yield* CodexLocalSessions
  const claude = yield* ClaudeLocalSessions
  const opencode = yield* OpenCodeLocalSessions
  const events: Array<UsageEvent> = []

  for (const source of sources) {
    if (source === "codex") events.push(...(yield* codex.scan(period)))
    if (source === "claude") events.push(...(yield* claude.scan(period)))
    if (source === "opencode") events.push(...(yield* opencode.scan(period)))
  }

  return events.filter((event) => usageEventTotalTokens(event) > 0)
})

const parseSources = (input: string): ReadonlyArray<SourceName> => {
  const parts = input.split(",").map((part) => part.trim().toLowerCase()).filter((part) => part.length > 0)
  const normalized = parts.includes("all") || parts.length === 0 ? ["codex", "claude", "opencode"] : parts
  const valid = new Set<SourceName>(["codex", "claude", "opencode"])
  return [...new Set(normalized.filter((part): part is SourceName => valid.has(part as SourceName)))]
}
