import { DateTime } from "effect"
import {
  buildLeaderboard,
  formatTokens,
  formatUsd,
  providerLabel,
  type AiHrReport,
  type ReportGroup
} from "./Report"
import { totalTokens } from "./Domain"
import { calendarDaysInPeriod } from "./Period"

export type ReportFormat = "terminal" | "markdown" | "json" | "html"
export type ReportRenderOptions = {
  readonly packageName?: string
  readonly packageVersion?: string
  readonly includeHeader?: boolean
}

export const renderReport = (
  report: AiHrReport,
  format: ReportFormat,
  options: ReportRenderOptions = {}
): string => {
  switch (format) {
    case "markdown":
      return renderMarkdownReport(report)
    case "json":
      return JSON.stringify(toSerializableReport(report), undefined, 2)
    case "html":
      return renderHtmlReport(report)
    case "terminal":
      return renderTerminalReport(report, options)
  }
}

export const renderTerminalReport = (
  report: AiHrReport,
  options: ReportRenderOptions = {}
): string => {
  const style = createTerminalStyle(supportsTerminalColor())
  const totalEvents = report.events.length
  const totalSessions = new Set(report.events.map((priced) => priced.event.sessionId)).size
  const totalCalendarDays = calendarDaysInPeriod(report.period)
  const annualized = report.totalCostUsd / totalCalendarDays * 365
  const averageCalendarDaySpend = report.totalCostUsd / totalCalendarDays
  const daysWithWork = Math.max(0, totalCalendarDays - report.daysWithoutWork)
  const averageWorkDaySpend = daysWithWork === 0 ? 0 : report.totalCostUsd / daysWithWork
  const status = reportCardStatus(report)
  const totalReportTokens = totalTokens(report.totals)
  const contextTokens = report.totals.inputTokens +
    report.totals.cachedInputTokens +
    report.totals.cacheWriteTokens +
    report.totals.cacheReadTokens
  const generatedTokens = report.totals.outputTokens + report.totals.reasoningTokens
  const showRosterContext = report.groups.length > 1

  const roster = renderTable(
    [
      "Agent",
      "Sessions",
      "Events",
      "Tokens",
      "Est. Cost",
      "Share",
      ...(showRosterContext ? ["Context/Gen"] : []),
      "Grade"
    ],
    report.groups.length === 0
      ? [["No local usage", "0", "0", "0", style.money("$0.00"), "0%", ...(showRosterContext ? ["0x"] : []), "-"]]
      : report.groups.map((group) => {
        const groupContextTokens = contextTokensForTotals(group.tokens)
        const groupGeneratedTokens = generatedTokensForTotals(group.tokens)

        return [
          style.agentName(group.provider === undefined ? group.key : providerLabel(group.provider)),
          String(group.sessions),
          String(group.events),
          formatTokens(totalGroupTokens(group)),
          style.money(formatUsd(group.costUsd)),
          formatPercent(report.totalCostUsd === 0 ? 0 : group.costUsd / report.totalCostUsd),
          ...(showRosterContext
            ? [style.contextRatio(formatTokenRatio(groupContextTokens, groupGeneratedTokens), groupContextTokens, groupGeneratedTokens)]
            : []),
          style.grade(group.grade.grade)
        ]
      }),
    style
  )
  const overviewRows: Array<ReadonlyArray<string>> = [
    ["Period", report.period.label],
    ["Generated", formatTerminalTimestamp(report.generatedAt)],
    ["Status", `${style.status(status.term)} - ${status.message}`],
    ["Grade", `${style.grade(report.overallGrade.grade)} (${Math.round(report.overallGrade.score)}/100)`]
  ]
  if (status.term === "LOCK IN" && report.overallGrade.grade === "D") {
    overviewRows.push(["Grade note", "D reflects context waste, not output quality."])
  }
  const overview = renderTable(
    ["Report Card", "Value"],
    overviewRows,
    style
  )
  const budgetRows: Array<ReadonlyArray<string>> = [
    ["Total API-equivalent cost", style.money(formatUsd(report.totalCostUsd))],
    [totalCalendarDays === 365 ? "Avg monthly cost" : "Monthly run-rate", style.money(formatUsd(annualized / 12))]
  ]
  if (totalCalendarDays !== 365) {
    budgetRows.push(["Yearly run-rate", style.money(formatUsd(annualized))])
  }
  budgetRows.push(
    ["Average / calendar day", style.money(formatUsd(averageCalendarDaySpend))]
  )
  if (report.daysWithoutWork > 0) {
    budgetRows.push(["Average / work day", style.money(formatUsd(averageWorkDaySpend))])
  }
  budgetRows.push(["Highest spending day", formatDayStat(report.highestSpendDay, style)])
  const budget = renderTable(
    ["Budget Signal", "Value"],
    budgetRows,
    style
  )
  const activity = renderTable(
    ["Activity Signal", "Value"],
    [
      ["Sessions reviewed", String(totalSessions)],
      ["Usage events reviewed", String(totalEvents)],
      ["Days with work", `${daysWithWork}/${totalCalendarDays}`],
      ["Days off in window", formatDaysOffValue(report.daysWithoutWork, totalCalendarDays, style)],
      ["Quietest active day", formatDayStat(report.slowestDay, style)]
    ],
    style
  )
  const tokenMix = renderTable(
    ["Token Mix", "Value"],
    [
      ["Total tokens", formatTokens(totalReportTokens)],
      ["Input tokens", formatTokens(report.totals.inputTokens)],
      ["Cached input tokens", formatTokens(report.totals.cachedInputTokens)],
      ["Output tokens", formatTokens(report.totals.outputTokens)],
      ["Reasoning tokens", formatTokens(report.totals.reasoningTokens)],
      ["Context / generated", style.contextRatio(formatTokenRatio(contextTokens, generatedTokens), contextTokens, generatedTokens)]
    ],
    style
  )
  const briefing = renderBulletList(reportBriefing(report, {
    contextTokens,
    generatedTokens,
    style,
    totalCalendarDays
  }))
  const header = options.includeHeader === false ? [] : [renderTerminalIntro(options, style), ""]

  return [
    ...header,
    indentBlock("AI HR REPORT CARD"),
    "",
    overview,
    "",
    "Budget",
    "",
    budget,
    "",
    "Activity",
    "",
    activity,
    "",
    "Context Tax",
    "",
    tokenMix,
    "",
    "Employee Roster",
    "",
    roster,
    "",
    "Briefing",
    "",
    briefing
  ].join("\n")
}

export const renderTerminalIntro = (
  options: ReportRenderOptions = {},
  style: TerminalStyle = createTerminalStyle(supportsTerminalColor())
): string =>
  [
    indentBlock(formatPackageLabel(options, style)),
    "",
    indentBlock(ROBOT_AVATAR)
  ].join("\n")

export const renderMarkdownReport = (report: AiHrReport): string => {
  const rows = report.groups.map((group) =>
    `| ${group.provider === undefined ? group.key : providerLabel(group.provider)} | ${group.sessions} | ${formatTokens(totalGroupTokens(group))} | ${formatUsd(group.costUsd)} | ${group.grade.grade} |`
  )

  return [
    "# AI HR Report",
    "",
    `- Period: ${report.period.label}`,
    `- Generated: ${DateTime.formatIso(report.generatedAt)}`,
    `- Total API-equivalent cost: ${formatUsd(report.totalCostUsd)}`,
    `- Highest spending day: ${formatDayStat(report.highestSpendDay)}`,
    `- Days without agent work: ${report.daysWithoutWork}`,
    `- Agent discipline score: ${report.overallGrade.grade}`,
    "",
    "## Employee Roster",
    "",
    "| Agent | Sessions | Tokens | Est. Cost | Grade |",
    "| --- | ---: | ---: | ---: | --- |",
    ...rows,
    "",
    "## Verdict",
    "",
    report.overallGrade.verdict,
    "",
    "## Warnings",
    "",
    ...report.warnings.map((warning) => `- ${warning}`)
  ].join("\n")
}

export const renderLeaderboard = (
  report: AiHrReport,
  groupBy: "provider" | "model" | "repo" | "day"
): string => {
  const groups = buildLeaderboard(report, groupBy)
  return renderTable(
    [groupBy, "Sessions", "Tokens", "Est. Cost", "Grade"],
    groups.map((group) => [
      group.key,
      String(group.sessions),
      formatTokens(totalGroupTokens(group)),
      formatUsd(group.costUsd),
      group.grade.grade
    ])
  )
}

export const toSerializableReport = (report: AiHrReport) => ({
  generatedAt: DateTime.formatIso(report.generatedAt),
  period: {
    label: report.period.label,
    since: DateTime.formatIso(report.period.since),
    until: DateTime.formatIso(report.period.until)
  },
  totals: report.totals,
  totalCostUsd: report.totalCostUsd,
  activeDays: report.activeDays,
  daysWithoutWork: report.daysWithoutWork,
  hardestDay: report.hardestDay,
  highestSpendDay: report.highestSpendDay,
  slowestDay: report.slowestDay,
  groups: report.groups,
  warnings: report.warnings,
  overallGrade: report.overallGrade
})

const renderHtmlReport = (report: AiHrReport): string => {
  const rows = report.groups.map((group) => `
      <tr>
        <td>${escapeHtml(group.provider === undefined ? group.key : providerLabel(group.provider))}</td>
        <td>${group.sessions}</td>
        <td>${formatTokens(totalGroupTokens(group))}</td>
        <td>${formatUsd(group.costUsd)}</td>
        <td>${group.grade.grade}</td>
      </tr>`).join("")

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI HR Report</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 40px; color: #151515; }
    main { max-width: 960px; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; margin: 24px 0; }
    th, td { border-bottom: 1px solid #ddd; padding: 10px 8px; text-align: left; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: 0; color: #555; }
    .metric { display: inline-block; margin: 0 24px 16px 0; }
    .metric strong { display: block; font-size: 24px; }
  </style>
</head>
<body>
  <main>
    <h1>AI HR Report</h1>
    <p>${escapeHtml(report.period.label)} - Generated ${escapeHtml(DateTime.formatIso(report.generatedAt))}</p>
    <div class="metric"><span>Total API-equivalent cost</span><strong>${formatUsd(report.totalCostUsd)}</strong></div>
    <div class="metric"><span>Agent discipline score</span><strong>${report.overallGrade.grade}</strong></div>
    <div class="metric"><span>Highest spending day</span><strong>${escapeHtml(formatDayStat(report.highestSpendDay))}</strong></div>
    <h2>Employee Roster</h2>
    <table>
      <thead><tr><th>Agent</th><th>Sessions</th><th>Tokens</th><th>Est. Cost</th><th>Grade</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>Verdict</h2>
    <p>${escapeHtml(report.overallGrade.verdict)}</p>
    <h2>Warnings</h2>
    <ul>${report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
  </main>
</body>
</html>`
}

const renderTable = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  style: TerminalStyle = plainTerminalStyle
): string => {
  const widths = headers.map((header, index) =>
    Math.max(visibleLength(header), ...rows.map((row) => visibleLength(row[index] ?? "")))
  )
  const line = (values: ReadonlyArray<string>) =>
    `| ${values.map((value, index) => padVisible(value, widths[index] ?? visibleLength(value))).join(" | ")} |`
  const separator = `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`
  return [line(headers.map((header) => style.tableHeader(header))), separator, ...rows.map(line)].join("\n")
}

const ROBOT_AVATAR = [
  "   +-------------+",
  "   |  AI HR BOT  |",
  "   |   [o] [o]   |",
  "   |      ^      |",
  "   |    \\___/    |",
  "   +-------------+",
  "       /|_ _|\\"
].join("\n")

const DEFAULT_PACKAGE_NAME = "ai-hr"
const REPORT_INDENT = "  "
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g
const MILLIS_PER_DAY = 86_400_000
const RECENT_ACTIVITY_DAYS = 30
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
]

const identity = (value: string): string => value

type TerminalStyle = {
  readonly agentName: (value: string) => string
  readonly contextRatio: (value: string, contextTokens: number, generatedTokens: number) => string
  readonly daysOffPercent: (value: string, fraction: number) => string
  readonly grade: (value: ReportGroup["grade"]["grade"]) => string
  readonly money: (value: string) => string
  readonly packageName: (value: string) => string
  readonly status: (value: ReportCardStatus["term"]) => string
  readonly tableHeader: (value: string) => string
}

const plainTerminalStyle: TerminalStyle = {
  agentName: identity,
  contextRatio: (value) => value,
  daysOffPercent: (value) => value,
  grade: (value) => value,
  money: identity,
  packageName: identity,
  status: (value) => value,
  tableHeader: identity
}

const createTerminalStyle = (useColor: boolean): TerminalStyle =>
  useColor
    ? {
      agentName: (value) => ansi("1;36", value),
      contextRatio: (value, contextTokens, generatedTokens) => {
        const ratio = tokenRatioValue(contextTokens, generatedTokens)
        if (ratio > 200) return ansi("31", value)
        if (ratio >= 100) return ansi("33", value)
        return ansi("32", value)
      },
      daysOffPercent: (value, fraction) => {
        if (fraction < 0.2) return ansi("32", value)
        if (fraction <= 0.6) return ansi("33", value)
        return ansi("90", value)
      },
      grade: (value) => {
        if (value.startsWith("A") || value.startsWith("B")) return ansi("32", value)
        if (value === "C") return ansi("33", value)
        if (value === "F") return ansi("1;31", value)
        return ansi("31", value)
      },
      money: (value) => ansi("37", value),
      packageName: (value) => ansi("1;36", value),
      status: (value) => ansi("1;33", value),
      tableHeader: (value) => ansi("2", value)
    }
    : plainTerminalStyle

type ReportCardStatus = {
  readonly term: "LGTM" | "LOCK IN" | "NGMI"
  readonly message: string
}

const supportsTerminalColor = (): boolean => {
  const stdout = process.stdout as typeof process.stdout & {
    readonly hasColors?: () => boolean
  }
  return typeof stdout.hasColors === "function" && stdout.hasColors()
}

const ansi = (code: string, value: string): string =>
  `\u001B[${code}m${value}\u001B[0m`

const stripAnsi = (value: string): string => value.replace(ANSI_PATTERN, "")

const visibleLength = (value: string): number => stripAnsi(value).length

const padVisible = (value: string, width: number): string =>
  `${value}${" ".repeat(Math.max(0, width - visibleLength(value)))}`

const formatPackageLabel = (options: ReportRenderOptions, style: TerminalStyle): string => {
  const name = options.packageName ?? DEFAULT_PACKAGE_NAME
  return options.packageVersion === undefined || options.packageVersion.length === 0
    ? style.packageName(name)
    : `${style.packageName(name)} ${options.packageVersion}`
}

const indentBlock = (value: string): string =>
  value.split("\n").map((line) => `${REPORT_INDENT}${line}`).join("\n")

const reportCardStatus = (report: AiHrReport): ReportCardStatus => {
  switch (report.overallGrade.grade) {
    case "A":
    case "A-":
    case "B+":
      return { term: "LGTM", message: "spend and context discipline look shippable" }
    case "F":
      return { term: "NGMI", message: "budget burn is failing the review window" }
    case "B":
    case "B-":
    case "C":
    case "D":
      return { term: "LOCK IN", message: "useful work, but the context tax needs attention" }
  }
}

const reportBriefing = (
  report: AiHrReport,
  context: {
    readonly contextTokens: number
    readonly generatedTokens: number
    readonly style: TerminalStyle
    readonly totalCalendarDays: number
  }
): ReadonlyArray<string> => {
  const activityTrend = activityTrendBriefing(report, context.totalCalendarDays, context.style)

  if (report.groups.length === 0) {
    return [
      "Roster: no AI employees clocked paid local usage in this window.",
      ...(activityTrend === undefined ? [] : [activityTrend]),
      "Attendance: no active days in this window."
    ]
  }

  return [
    rosterBriefing(report.groups, context.style),
    ...(activityTrend === undefined ? [] : [activityTrend]),
    contextTaxBriefing(context.contextTokens, context.generatedTokens),
    attendanceBriefing(report.daysWithoutWork, context.totalCalendarDays)
  ]
}

const activityTrendBriefing = (
  report: AiHrReport,
  totalCalendarDays: number,
  style: TerminalStyle
): string | undefined => {
  if (totalCalendarDays <= RECENT_ACTIVITY_DAYS || report.events.length === 0) {
    return undefined
  }

  const overallRecentEvents = countRecentEvents(report.events, report.period.until)
  const overallFraction = overallRecentEvents / report.events.length
  const topEventGroup = maxBy(report.groups, (group) => group.events)

  if (topEventGroup === undefined || report.groups.length === 1) {
    return `Usage trend: ${formatPercent(overallFraction)} of activity landed in the last 30 days; ${activityTrendNote(overallFraction)}.`
  }

  const topGroupEvents = report.events.filter((priced) =>
    topEventGroup.provider === undefined
      ? priced.event.provider === topEventGroup.key
      : priced.event.provider === topEventGroup.provider
  )
  const topGroupRecentEvents = countRecentEvents(topGroupEvents, report.period.until)
  const topGroupFraction = topGroupRecentEvents / topGroupEvents.length

  return `Usage trend: ${formatPercent(topGroupFraction)} of ${formatAgentName(topEventGroup, style)} activity landed in the last 30 days (${formatPercent(overallFraction)} overall); ${activityTrendNote(topGroupFraction)}.`
}

const countRecentEvents = (
  events: ReadonlyArray<AiHrReport["events"][number]>,
  until: DateTime.Utc
): number => {
  const cutoffMillis = DateTime.toEpochMillis(until) - RECENT_ACTIVITY_DAYS * MILLIS_PER_DAY
  return events.filter((priced) => DateTime.toEpochMillis(priced.event.occurredAt) >= cutoffMillis).length
}

const activityTrendNote = (fraction: number): string => {
  if (fraction >= 0.75) return "usage is heavily back-loaded"
  if (fraction >= 0.5) return "recent work dominates the window"
  return "activity is spread across the window"
}

const rosterBriefing = (
  groups: ReadonlyArray<ReportGroup>,
  style: TerminalStyle
): string => {
  if (groups.length === 1) {
    const group = groups[0]
    return `Roster: ${formatAgentName(group, style)} is the only agent here; read ${style.grade(group.grade.grade)} as a context-discipline grade, not a talent ranking.`
  }

  const hasGradeContrast = new Set(groups.map((group) => group.grade.grade)).size > 1
  const sorted = hasGradeContrast
    ? [...groups].sort((left, right) => right.grade.score - left.grade.score)
    : [...groups].sort((left, right) => right.costUsd - left.costUsd)
  const first = sorted[0]
  const second = hasGradeContrast ? sorted[sorted.length - 1] : sorted[1]

  if (first === undefined || second === undefined) {
    return "Roster: not enough agent data to compare employees."
  }

  const note = hasGradeContrast
    ? "grade gap matters more than spend share"
    : "same grade, so compare cost per session before shifting more work"

  return `Top employee: ${formatAgentContrast(first, style)} vs ${formatAgentContrast(second, style)}; ${note}.`
}

const formatAgentContrast = (group: ReportGroup, style: TerminalStyle): string =>
  `${formatAgentName(group, style)} grade ${style.grade(group.grade.grade)} (${formatSessionCount(group.sessions)}, ${style.money(formatUsd(group.costUsd))})`

const formatAgentName = (group: ReportGroup, style: TerminalStyle): string =>
  style.agentName(group.provider === undefined ? group.key : providerLabel(group.provider))

const formatSessionCount = (sessions: number): string =>
  `${sessions} ${sessions === 1 ? "session" : "sessions"}`

const contextTaxBriefing = (contextTokens: number, generatedTokens: number): string => {
  const ratio = tokenRatioValue(contextTokens, generatedTokens)
  if (contextTokens === 0 && generatedTokens === 0) {
    return "Context tax: no token mix to judge in this window."
  }
  if (!Number.isFinite(ratio)) {
    return "Context tax: context-only usage; generated work is missing from the window."
  }
  if (ratio > 200) {
    return "Context tax: severe; trim carried context before adding more sessions."
  }
  if (ratio >= 100) {
    return "Context tax: elevated; reduce repeated input before scaling the workflow."
  }
  return "Context tax: under control; spend changes are more likely from session volume or model mix."
}

const attendanceBriefing = (daysWithoutWork: number, totalCalendarDays: number): string => {
  const fraction = daysWithoutWork / totalCalendarDays
  if (daysWithoutWork === 0) {
    return "Attendance: no idle days; control burn through context discipline, not downtime."
  }
  if (fraction > 0.6) {
    return "Attendance: sparse usage; a few busy days can swing the run-rate."
  }
  return "Attendance: regular usage with some quiet days; read the run-rate as working cadence."
}

const renderBulletList = (lines: ReadonlyArray<string>): string =>
  lines.map((line) => `- ${line}`).join("\n")

const formatDayStat = (
  day: { readonly day: string; readonly tokens: number; readonly costUsd: number } | undefined,
  style: TerminalStyle = plainTerminalStyle
): string =>
  day === undefined ? "No local usage found" : `${day.day} - ${style.money(formatUsd(day.costUsd))}, ${formatTokens(day.tokens)} tokens`

const formatDaysOffValue = (
  daysWithoutWork: number,
  totalCalendarDays: number,
  style: TerminalStyle
): string => {
  const fraction = daysWithoutWork / totalCalendarDays
  const percent = formatPercent(fraction)
  return `${daysWithoutWork}/${totalCalendarDays} (${style.daysOffPercent(percent, fraction)})`
}

const formatTerminalTimestamp = (dateTime: DateTime.Utc): string => {
  const parts = DateTime.toPartsUtc(dateTime)
  const hour = parts.hour % 12 === 0 ? 12 : parts.hour % 12
  const minute = String(parts.minute).padStart(2, "0")
  const amPm = parts.hour < 12 ? "AM" : "PM"
  return `${MONTH_NAMES[parts.month - 1] ?? "Unknown"} ${parts.day}, ${parts.year} ${hour}:${minute} ${amPm} UTC`
}

const formatPercent = (fraction: number): string => {
  const value = Math.max(0, Number.isFinite(fraction) ? fraction : 0) * 100
  return `${value >= 10 || value === 0 ? value.toFixed(0) : value.toFixed(1)}%`
}

const formatTokenRatio = (contextTokens: number, generatedTokens: number): string => {
  if (generatedTokens === 0) return contextTokens === 0 ? "0x" : "context only"
  const ratio = tokenRatioValue(contextTokens, generatedTokens)
  return `${ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1)}x`
}

const tokenRatioValue = (contextTokens: number, generatedTokens: number): number =>
  generatedTokens === 0
    ? contextTokens === 0 ? 0 : Number.POSITIVE_INFINITY
    : contextTokens / generatedTokens

const contextTokensForTotals = (tokens: ReportGroup["tokens"]): number =>
  tokens.inputTokens +
  tokens.cachedInputTokens +
  tokens.cacheWriteTokens +
  tokens.cacheReadTokens

const generatedTokensForTotals = (tokens: ReportGroup["tokens"]): number =>
  tokens.outputTokens + tokens.reasoningTokens

const maxBy = <A>(
  values: ReadonlyArray<A>,
  score: (value: A) => number
): A | undefined =>
  values.reduce<A | undefined>(
    (best, value) => best === undefined || score(value) > score(best) ? value : best,
    undefined
  )

const totalGroupTokens = (group: ReportGroup): number =>
  group.tokens.inputTokens +
  group.tokens.cachedInputTokens +
  group.tokens.outputTokens +
  group.tokens.reasoningTokens +
  group.tokens.cacheWriteTokens +
  group.tokens.cacheReadTokens

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
