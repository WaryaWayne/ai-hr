import { DateTime, Effect } from "effect"
import { PeriodParseError } from "./Domain"

export type ReportPeriod = {
  readonly since: DateTime.Utc
  readonly until: DateTime.Utc
  readonly label: string
}

const parseDate = (input: string) =>
  Effect.try({
    try: () => DateTime.makeUnsafe(input),
    catch: (cause) =>
      new PeriodParseError({
        input,
        message: "Expected a duration like 30d or an ISO date.",
        cause
      })
  })

export const parseReportPeriod = Effect.fn("Period.parseReportPeriod")(function*(
  sinceInput: string,
  untilInput?: string
) {
  const until = untilInput === undefined ? yield* DateTime.now : yield* parseDate(untilInput)
  const durationMatch = /^([1-9][0-9]*)d$/.exec(sinceInput)

  if (durationMatch !== null) {
    const days = Number(durationMatch[1])
    return {
      since: DateTime.subtract(until, { days }),
      until,
      label: `last ${days} ${days === 1 ? "day" : "days"}`
    } satisfies ReportPeriod
  }

  const since = yield* parseDate(sinceInput)
  return {
    since,
    until,
    label: `${DateTime.formatIsoDate(since)} to ${DateTime.formatIsoDate(until)}`
  } satisfies ReportPeriod
})

export const inPeriod = (occurredAt: DateTime.Utc, period: ReportPeriod): boolean =>
  DateTime.between(occurredAt, {
    minimum: period.since,
    maximum: period.until
  })

export const calendarDaysInPeriod = (period: ReportPeriod): number => {
  const ms = DateTime.toEpochMillis(period.until) - DateTime.toEpochMillis(period.since)
  return Math.max(1, Math.ceil(ms / 86_400_000))
}
