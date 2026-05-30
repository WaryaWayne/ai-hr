import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag, Prompt } from "effect/unstable/cli"
import {
  readPackageMetadata,
  runDoctor,
  runExplain,
  runLeaderboard,
  runPayroll,
  runReport,
  runScan
} from "./App"
import { renderTerminalIntro } from "../../core/src/Renderers"

const since = Flag.string("since").pipe(
  Flag.withDefault("30d"),
  Flag.withDescription("Duration like 30d or an ISO start date.")
)

const until = Flag.string("until").pipe(
  Flag.optional,
  Flag.withDescription("Optional ISO end date.")
)

const sources = Flag.string("sources").pipe(
  Flag.withDefault("codex,claude,opencode"),
  Flag.withDescription("Comma-separated sources: codex, claude, opencode, or all.")
)

const format = Flag.choice("format", ["terminal", "markdown", "json", "html"] as const).pipe(
  Flag.withDefault("terminal"),
  Flag.withDescription("Report output format.")
)

const report = Command.make("report", { since, until, sources, format }, (config) =>
  Effect.gen(function*() {
    const output = yield* runReport({
      since: config.since,
      ...optionalUntil(config.until),
      sources: config.sources,
      format: config.format
    })
    yield* Console.log(output)
  })).pipe(Command.withDescription("Generate the local AI HR report."))

const scan = Command.make("scan", { since, until, sources }, (config) =>
  Effect.gen(function*() {
    const output = yield* runScan({
      since: config.since,
      ...optionalUntil(config.until),
      sources: config.sources
    })
    yield* Console.log(output)
  })).pipe(Command.withDescription("Scan local agent histories and print source counts."))

const payroll = Command.make("payroll", { since, until, sources }, (config) =>
  Effect.gen(function*() {
    const output = yield* runPayroll({
      since: config.since,
      ...optionalUntil(config.until),
      sources: config.sources
    })
    yield* Console.log(output)
  })).pipe(Command.withDescription("Show the API-equivalent payroll view."))

const leaderboard = Command.make("leaderboard", {
  since,
  until,
  sources,
  groupBy: Flag.choice("group-by", ["provider", "model", "repo", "day"] as const).pipe(
    Flag.withDefault("provider")
  )
}, (config) =>
  Effect.gen(function*() {
    const output = yield* runLeaderboard({
      since: config.since,
      ...optionalUntil(config.until),
      sources: config.sources,
      groupBy: config.groupBy
    })
    yield* Console.log(output)
  })).pipe(Command.withDescription("Rank agent usage by provider, model, repo, or day."))

const explain = Command.make("explain", {
  session: Argument.string("session"),
  sources,
  format
}, (config) =>
  Effect.gen(function*() {
    const output = yield* runExplain({
      session: config.session,
      sources: config.sources,
      format: config.format
    })
    yield* Console.log(output)
  })).pipe(Command.withDescription("Explain one local session by ID."))

const doctor = Command.make("doctor", {}, () =>
  Effect.gen(function*() {
    const output = yield* runDoctor()
    yield* Console.log(output)
  })).pipe(Command.withDescription("Check local stores and installed SDK surfaces."))

const investigationWindows = [
  { title: "1 day", value: "1d" },
  { title: "7 days", value: "7d" },
  { title: "30 days", value: "30d", selected: true },
  { title: "90 days", value: "90d" },
  { title: "180 days", value: "180d" },
  { title: "365 days", value: "365d" }
] as const

const root = Command.make("ai-hr", {}, () =>
  Effect.gen(function*() {
    if (process.stdin.isTTY !== true) {
      yield* Console.log("Run `ai-hr report --since 30d --sources codex,claude,opencode` to generate a local AI HR report.")
      return
    }

    const metadata = yield* readPackageMetadata()
    yield* Console.log(renderTerminalIntro({
      packageName: metadata.name,
      packageVersion: metadata.version
    }))

    const selected = yield* Prompt.multiSelect({
      message: "Which AI employees are up for review?",
      choices: [
        { title: "Codex", value: "codex", selected: true },
        { title: "Claude Code", value: "claude", selected: true },
        { title: "OpenCode", value: "opencode", selected: true }
      ],
      min: 1
    })
    const selectedWindow = yield* Prompt.select({
      message: "How far back should AI HR investigate?",
      choices: investigationWindows,
      maxPerPage: investigationWindows.length
    })
    const selectedSources = selected.join(",")
    const scanOutput = yield* runScan({ since: selectedWindow, sources: selectedSources })
    yield* Console.log(scanOutput)
    yield* Console.log("")
    const reportOutput = yield* runReport({
      since: selectedWindow,
      sources: selectedSources,
      format: "terminal",
      includeHeader: false
    })
    yield* Console.log(reportOutput)
  }))

export const command = root.pipe(
  Command.withDescription("Local AI employee performance reviews for coding agents."),
  Command.withSubcommands([report, scan, payroll, leaderboard, explain, doctor])
)

const optionalUntil = (value: Option.Option<string>): { readonly until?: string } =>
  Option.isSome(value) ? { until: value.value } : {}
