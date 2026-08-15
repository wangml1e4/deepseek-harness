/** Pure calendar aggregation over the root session-list mirror. */

import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'

/** Calendar bucket size selected by the settings-page switcher. */
export type ActivityGranularity = 'day' | 'week' | 'month'

/** One accessible heatmap bucket in the selected calendar window. */
export interface ActivityPeriod {
  key: string
  label: string
  tokens: bigint
  inRange: boolean
  level: 0 | 1 | 2 | 3 | 4
}

/** One visible calendar label positioned over a heatmap column. */
export interface ActivityAxisLabel {
  column: number
  label: string
}

/** Fully derived summary metrics and heatmap geometry for one page render. */
export interface TokenActivityView {
  periods: readonly ActivityPeriod[]
  labels: readonly ActivityAxisLabel[]
  columns: number
  rows: number
  totalTokens: bigint
  peakTokens: bigint
  longestCompletedTurnMs: number
  currentStreak: number
  longestStreak: number
}

/**
 * Find every unique visible list identity whose token activity must be exacted.
 * @param state - root-scoped session-list mirror.
 * @returns visible identities requiring an exact projection baseline.
 */
export function activitySessionIds(state: SessionListState): SessionListState['ids'] {
  const ids: SessionListState['ids'][number][] = []
  const visited = new Set<string>()
  for (const id of state.ids) {
    if (visited.has(id)) continue
    visited.add(id)
    ids.push(id)
  }
  return ids
}

const DAY_MS = 86_400_000

/**
 * Render an instant as a deterministic calendar key in an explicit zone.
 * @param time - epoch milliseconds to format.
 * @param timeZone - explicit IANA time-zone identifier.
 * @returns a `YYYY-MM-DD` calendar key in that zone.
 */
export function dateKeyAt(time: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(time))
  const fields = new Map(parts.map(part => [part.type, part.value]))
  return `${fields.get('year')}-${fields.get('month')}-${fields.get('day')}`
}

function ordinal(key: string): number {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  return Math.trunc(Date.UTC(year, month - 1, day) / DAY_MS)
}

function keyFromOrdinal(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10)
}

function addDays(key: string, days: number): string {
  return keyFromOrdinal(ordinal(key) + days)
}

function addMonths(key: string, months: number): string {
  const [year, month] = key.split('-').map(Number) as [number, number]
  const date = new Date(Date.UTC(year, month - 1 + months, 1))
  return date.toISOString().slice(0, 7)
}

function mondayOf(key: string): string {
  const day = new Date(ordinal(key) * DAY_MS).getUTCDay()
  return addDays(key, -(day === 0 ? 6 : day - 1))
}

function monthLabel(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
    .format(new Date(`${key.slice(0, 7)}-01T00:00:00.000Z`))
}

function fullMonthLabel(key: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${key.slice(0, 7)}-01T00:00:00.000Z`))
}

function periodLabel(start: string, end: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  if (start === end) return formatter.format(new Date(`${start}T00:00:00.000Z`))
  return `${formatter.format(new Date(`${start}T00:00:00.000Z`))} – ${formatter.format(new Date(`${end}T00:00:00.000Z`))}`
}

function tokensOf(day: TokenUsageProjection): bigint {
  return BigInt(day.uncachedInputTokens)
    + BigInt(day.outputTokens)
    + BigInt(day.cacheReadTokens)
    + BigInt(day.cacheWriteTokens)
}

/**
 * Merge every unique visible session's durable activity projection.
 * @param state - root-scoped session-list mirror with projection baselines.
 * @returns exact daily totals and the maximum completed-turn duration.
 */
export function mergeVisibleActivity(state: SessionListState): {
  days: ReadonlyMap<string, bigint>
  longestCompletedTurnMs: number
} {
  const days = new Map<string, bigint>()
  let longestCompletedTurnMs = 0
  const visited = new Set<string>()
  for (const id of state.ids) {
    if (visited.has(id)) continue
    visited.add(id)
    const activity = state.byId[id]?.projectionValues?.tokenActivity
    if (activity === undefined) continue
    longestCompletedTurnMs = Math.max(longestCompletedTurnMs, activity.longestCompletedTurnMs)
    for (const day of activity.days) {
      days.set(day.date, (days.get(day.date) ?? 0n) + tokensOf(day))
    }
  }
  return { days, longestCompletedTurnMs }
}

function streaks(days: ReadonlyMap<string, bigint>, today: string): { current: number; longest: number } {
  const active = [...days.entries()]
    .filter(([, tokens]) => tokens > 0n)
    .map(([date]) => date)
    .sort()
  let longest = 0
  let run = 0
  let previous: number | undefined
  for (const date of active) {
    const current = ordinal(date)
    run = previous !== undefined && current === previous + 1 ? run + 1 : 1
    longest = Math.max(longest, run)
    previous = current
  }

  const activeSet = new Set(active)
  let cursor = activeSet.has(today) ? today : addDays(today, -1)
  if (!activeSet.has(cursor)) return { current: 0, longest }
  let current = 0
  while (activeSet.has(cursor)) {
    current += 1
    cursor = addDays(cursor, -1)
  }
  return { current, longest }
}

function sumRange(days: ReadonlyMap<string, bigint>, start: string, end: string): bigint {
  let total = 0n
  for (let cursor = ordinal(start); cursor <= ordinal(end); cursor += 1) {
    total += days.get(keyFromOrdinal(cursor)) ?? 0n
  }
  return total
}

interface RawPeriod {
  key: string
  label: string
  tokens: bigint
  inRange: boolean
}

function dailyPeriods(days: ReadonlyMap<string, bigint>, today: string, locale: string): {
  periods: RawPeriod[]
  labels: ActivityAxisLabel[]
  columns: number
  rows: number
} {
  const firstMonth = `${addMonths(today, -11)}-01`
  const start = mondayOf(firstMonth)
  const end = addDays(mondayOf(today), 6)
  const periods: RawPeriod[] = []
  const labels: ActivityAxisLabel[] = []
  let previousMonth = ''
  for (let cursor = ordinal(start), index = 0; cursor <= ordinal(end); cursor += 1, index += 1) {
    const key = keyFromOrdinal(cursor)
    const month = key.slice(0, 7)
    if (month !== previousMonth && key >= firstMonth && key <= today) {
      labels.push({ column: Math.floor(index / 7) + 1, label: monthLabel(key, locale) })
      previousMonth = month
    }
    periods.push({
      key,
      label: periodLabel(key, key, locale),
      tokens: days.get(key) ?? 0n,
      inRange: key >= firstMonth && key <= today,
    })
  }
  return { periods, labels, columns: Math.ceil(periods.length / 7), rows: 7 }
}

function weeklyPeriods(days: ReadonlyMap<string, bigint>, today: string, locale: string): {
  periods: RawPeriod[]
  labels: ActivityAxisLabel[]
  columns: number
  rows: number
} {
  const current = mondayOf(today)
  const periods: RawPeriod[] = []
  const labels: ActivityAxisLabel[] = []
  let previousMonth = ''
  for (let offset = -51, column = 1; offset <= 0; offset += 1, column += 1) {
    const start = addDays(current, offset * 7)
    const end = addDays(start, 6)
    const month = start.slice(0, 7)
    if (month !== previousMonth) {
      labels.push({ column, label: monthLabel(start, locale) })
      previousMonth = month
    }
    periods.push({ key: start, label: periodLabel(start, end, locale), tokens: sumRange(days, start, end), inRange: true })
  }
  return { periods, labels, columns: 52, rows: 1 }
}

function monthlyPeriods(days: ReadonlyMap<string, bigint>, today: string, locale: string): {
  periods: RawPeriod[]
  labels: ActivityAxisLabel[]
  columns: number
  rows: number
} {
  const current = today.slice(0, 7)
  const periods: RawPeriod[] = []
  const labels: ActivityAxisLabel[] = []
  for (let offset = -11, column = 1; offset <= 0; offset += 1, column += 1) {
    const month = addMonths(`${current}-01`, offset)
    const start = `${month}-01`
    const next = `${addMonths(start, 1)}-01`
    const end = addDays(next, -1)
    labels.push({ column, label: monthLabel(start, locale) })
    periods.push({ key: month, label: fullMonthLabel(start, locale), tokens: sumRange(days, start, end), inRange: true })
  }
  return { periods, labels, columns: 12, rows: 1 }
}

/**
 * Build summaries and the selected calendar window from the visible list.
 * @param state - root-scoped session-list mirror with exact projection values.
 * @param granularity - selected day, week, or month bucket size.
 * @param today - deterministic `YYYY-MM-DD` key in the browser zone.
 * @param locale - explicit locale for period labels.
 * @returns summary metrics and accessible heatmap periods.
 */
export function deriveTokenActivity(
  state: SessionListState,
  granularity: ActivityGranularity,
  today: string,
  locale: string,
): TokenActivityView {
  const merged = mergeVisibleActivity(state)
  const calendar = granularity === 'day'
    ? dailyPeriods(merged.days, today, locale)
    : granularity === 'week'
      ? weeklyPeriods(merged.days, today, locale)
      : monthlyPeriods(merged.days, today, locale)
  const peakTokens = calendar.periods.reduce(
    (peak, period) => period.inRange && period.tokens > peak ? period.tokens : peak,
    0n,
  )
  const periods = calendar.periods.map((period): ActivityPeriod => ({
    ...period,
    level: period.tokens === 0n || peakTokens === 0n
      ? 0
      : Number((period.tokens * 4n + peakTokens - 1n) / peakTokens) as 1 | 2 | 3 | 4,
  }))
  const totalTokens = [...merged.days.values()].reduce((total, value) => total + value, 0n)
  const streak = streaks(merged.days, today)
  return {
    ...calendar,
    periods,
    totalTokens,
    peakTokens,
    longestCompletedTurnMs: merged.longestCompletedTurnMs,
    currentStreak: streak.current,
    longestStreak: streak.longest,
  }
}
