/** Durable calendar activity and completed-turn duration projection. */

import { z } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {
  TokenActivityDay, TokenActivityProjection, TokenUsageProjection,
} from './projection.ts'
import {
  replaceUsageBuckets, usageBucketsEqual, usageBucketsFrom, zeroUsageBuckets,
} from './usage-accounting.ts'

const UTC = 'UTC'

interface ActivityUsageSample {
  turn: number
  step: number
  date: string
  buckets: TokenUsageProjection
}

interface TokenActivityState {
  days: Record<string, TokenUsageProjection>
  last: ActivityUsageSample | null
  timeZone: string
  openTurn: { turn: number; startedAt: number } | null
  longestCompletedTurnMs: number
}

const bucketSchema = z.object({
  uncachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}).strict()

const activitySchema: z.ZodType<TokenActivityProjection> = z.object({
  days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ...bucketSchema.shape }).strict()),
  longestCompletedTurnMs: z.number().int().nonnegative(),
}).strict()

/**
 * Format one instant as a locale-independent calendar key in an explicit zone.
 * @param time - Unix epoch milliseconds.
 * @param timeZone - Host-validated IANA zone or `UTC`.
 * @returns `YYYY-MM-DD` in that zone.
 */
export function activityDateKey(time: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(time))
  const fields = new Map(parts.map(part => [part.type, part.value]))
  return `${fields.get('year')}-${fields.get('month')}-${fields.get('day')}`
}

/** Accept only zones the current deterministic Intl implementation can apply. */
function supportedTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

/** Resolve direct-user time-zone provenance; missing or malformed values mean UTC. */
function directUserTimeZone(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return undefined
  const source = event.data.source as { clientTimeZone?: unknown }
  return supportedTimeZone(source.clientTimeZone) ? source.clientTimeZone : UTC
}

/** Whether an accumulated day carries any provider-reported usage. */
function dayIsEmpty(day: TokenUsageProjection): boolean {
  return day.uncachedInputTokens === 0
    && day.outputTokens === 0
    && day.cacheReadTokens === 0
    && day.cacheWriteTokens === 0
}

/** Replace one sample inside one date and remove neutral rows. */
function replaceDay(
  days: Record<string, TokenUsageProjection>,
  date: string,
  previous: TokenUsageProjection | undefined,
  next: TokenUsageProjection,
): void {
  const value = replaceUsageBuckets(days[date] ?? zeroUsageBuckets(), previous, next)
  if (dayIsEmpty(value)) Reflect.deleteProperty(days, date)
  else days[date] = value
}

/** Apply a usage sample with same-step replacement, including a cross-midnight move. */
function applyUsage(state: TokenActivityState, event: SessionEvent): TokenActivityState {
  let turn: number
  let step: number
  let buckets: TokenUsageProjection
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    ;({ turn, step } = event.data)
    buckets = usageBucketsFrom(event.data.chunk.usage)
  } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    ;({ turn, step } = event.data)
    buckets = usageBucketsFrom(event.data.usage)
  } else {
    return state
  }

  const date = activityDateKey(event.time, state.timeZone)
  const previous = state.last !== null
    && state.last.turn === turn
    && state.last.step === step
    ? state.last
    : undefined
  if (previous !== undefined && previous.date === date && usageBucketsEqual(previous.buckets, buckets)) {
    return state
  }

  const days = { ...state.days }
  if (previous !== undefined && previous.date !== date) {
    replaceDay(days, previous.date, previous.buckets, zeroUsageBuckets())
    replaceDay(days, date, undefined, buckets)
  } else {
    replaceDay(days, date, previous?.buckets, buckets)
  }
  return { ...state, days, last: { turn, step, date, buckets } }
}

/**
 * Calendar activity read model derived exclusively from durable events.
 *
 * Direct user messages set the zone for the work they admit; an omitted zone
 * uses UTC. Usage is dated when the provider report is logged. A final
 * assistant sample replaces the same `(turn, step)` chunk sample and can move
 * it across a local midnight. Completed-turn duration is `turn/start` to a
 * matching `turn/end` whose reason is `completed`. `session/end-seed` drops
 * copied usage and duration while retaining the inherited time zone.
 */
export const tokenActivityProjectionDefinition:
ProjectionDefinition<'tokenActivity', TokenActivityState> = {
  key: 'tokenActivity',
  schema: activitySchema,
  init: () => ({
    days: {},
    last: null,
    timeZone: UTC,
    openTurn: null,
    longestCompletedTurnMs: 0,
  }),
  apply: (state, event) => {
    if (event.type === 'session/end-seed') {
      return {
        days: {},
        last: null,
        timeZone: state.timeZone,
        openTurn: null,
        longestCompletedTurnMs: 0,
      }
    }
    const timeZone = directUserTimeZone(event)
    if (timeZone !== undefined) {
      return timeZone === state.timeZone ? state : { ...state, timeZone }
    }
    if (event.type === 'turn/start') {
      return { ...state, openTurn: { turn: event.data.turn, startedAt: event.time } }
    }
    if (event.type === 'turn/end') {
      if (state.openTurn?.turn !== event.data.turn) return state
      const duration = Math.max(0, event.time - state.openTurn.startedAt)
      return {
        ...state,
        openTurn: null,
        longestCompletedTurnMs: event.data.reason.kind === 'completed'
          ? Math.max(state.longestCompletedTurnMs, duration)
          : state.longestCompletedTurnMs,
      }
    }
    return applyUsage(state, event)
  },
  view: state => ({
    days: Object.entries(state.days)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, buckets]): TokenActivityDay => ({ date, ...buckets })),
    longestCompletedTurnMs: state.longestCompletedTurnMs,
  }),
  stateVersion: 2,
}
