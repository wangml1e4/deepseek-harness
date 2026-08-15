import { describe, expect, it } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { TokenActivityProjection } from '@deepseek-ai/dsh-token-meter/client'
import {
  activitySessionIds, dateKeyAt, deriveTokenActivity, mergeVisibleActivity,
} from '../src/client/activity.ts'

function sessions(entries: readonly [string, TokenActivityProjection | undefined][]): SessionListState {
  const byId: Record<string, SessionSummary> = {}
  for (const [id, projection] of entries) {
    byId[id] = {
      id, displayTitle: id, running: false, blank: false, updatedAt: 0,
      ...projection === undefined ? {} : { projectionValues: { tokenActivity: projection } },
    } as SessionSummary
  }
  return {
    ids: entries.map(([id]) => id), byId, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  } as SessionListState
}

function activity(
  days: readonly [string, number][],
  longestCompletedTurnMs = 0,
): TokenActivityProjection {
  return {
    days: days.map(([date, tokens]) => ({
      date,
      uncachedInputTokens: tokens,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })),
    longestCompletedTurnMs,
  }
}

describe('Token usage calendar aggregation', () => {
  it('renders calendar dates in an explicit zone at a cross-year boundary', () => {
    const instant = Date.parse('2025-01-01T01:30:00.000Z')
    expect(dateKeyAt(instant, 'UTC')).toBe('2025-01-01')
    expect(dateKeyAt(instant, 'America/Los_Angeles')).toBe('2024-12-31')
  })

  it('keeps calendar month labels stable in a negative-offset host zone', () => {
    const previousTimeZone = process.env['TZ']
    process.env['TZ'] = 'America/Los_Angeles'
    try {
      const state = sessions([])
      expect(deriveTokenActivity(state, 'day', '2026-08-14', 'en-US').labels[0]?.label).toBe('Sep')
      expect(deriveTokenActivity(state, 'week', '2026-08-14', 'en-US').labels[0]?.label).toBe('Aug')
      expect(deriveTokenActivity(state, 'month', '2026-08-14', 'en-US').labels[0]?.label).toBe('Sep')
    } finally {
      if (previousTimeZone === undefined) delete process.env['TZ']
      else process.env['TZ'] = previousTimeZone
    }
  })

  it('deduplicates identities, identifies missing cold keys, and keeps four buckets disjoint', () => {
    const state = sessions([
      ['ordinary', {
        days: [{
          date: '2026-08-14', uncachedInputTokens: 10, outputTokens: 3,
          cacheReadTokens: 5, cacheWriteTokens: 2,
        }],
        longestCompletedTurnMs: 3_000,
      }],
      ['cold-with-old-cache', undefined],
      ['subagent', activity([['2026-08-14', 7]], 8_000)],
    ])
    state.ids.push(state.ids[0]!)
    expect(activitySessionIds(state)).toEqual(['ordinary', 'cold-with-old-cache', 'subagent'])
    const merged = mergeVisibleActivity(state)
    expect([...merged.days]).toEqual([['2026-08-14', 27n]])
    expect(merged.longestCompletedTurnMs).toBe(8_000)
  })

  it('has an honest neutral zero state in all three real views', () => {
    for (const granularity of ['day', 'week', 'month'] as const) {
      const view = deriveTokenActivity(sessions([]), granularity, '2026-08-14', 'en-US')
      expect(view.totalTokens).toBe(0n)
      expect(view.peakTokens).toBe(0n)
      expect(view.periods.every(period => period.tokens === 0n && period.level === 0)).toBe(true)
    }
  })

  it('uses Monday weeks across a month/year boundary and recomputes the selected peak', () => {
    const state = sessions([['one', activity([
      ['2025-12-28', 3], // Sunday: previous week
      ['2025-12-29', 10], // Monday: current week
      ['2026-01-01', 15],
      ['2026-01-05', 40],
    ])]])
    const daily = deriveTokenActivity(state, 'day', '2026-01-06', 'en-US')
    const weekly = deriveTokenActivity(state, 'week', '2026-01-06', 'en-US')
    const monthly = deriveTokenActivity(state, 'month', '2026-01-06', 'en-US')
    expect(daily.peakTokens).toBe(40n)
    expect(weekly.periods.find(period => period.key === '2025-12-29')?.tokens).toBe(25n)
    expect(weekly.periods.find(period => period.key === '2026-01-05')?.tokens).toBe(40n)
    expect(monthly.periods.find(period => period.key === '2025-12')?.tokens).toBe(13n)
    expect(monthly.periods.find(period => period.key === '2026-01')?.tokens).toBe(55n)
    expect(monthly.peakTokens).toBe(55n)
  })

  it('does not let padded daily-grid cells change the visible peak', () => {
    const state = sessions([['padding', activity([
      ['2025-07-30', 999], ['2025-08-01', 5],
    ])]])
    expect(deriveTokenActivity(state, 'day', '2026-07-10', 'en-US').peakTokens).toBe(5n)
  })

  it('includes leap day in daily, weekly, and monthly folding', () => {
    const state = sessions([['leap', activity([
      ['2024-02-28', 2], ['2024-02-29', 5], ['2024-03-01', 7],
    ])]])
    const daily = deriveTokenActivity(state, 'day', '2024-03-01', 'en-US')
    const weekly = deriveTokenActivity(state, 'week', '2024-03-01', 'en-US')
    const monthly = deriveTokenActivity(state, 'month', '2024-03-01', 'en-US')
    expect(daily.periods.find(period => period.key === '2024-02-29')?.tokens).toBe(5n)
    expect(weekly.periods.find(period => period.key === '2024-02-26')?.tokens).toBe(14n)
    expect(monthly.periods.find(period => period.key === '2024-02')?.tokens).toBe(7n)
    expect(monthly.periods.find(period => period.key === '2024-03')?.tokens).toBe(7n)
  })

  it('computes current streak through today or yesterday and longest across interruptions', () => {
    const state = sessions([['streak', activity([
      ['2026-08-01', 1], ['2026-08-02', 1], ['2026-08-04', 1],
      ['2026-08-11', 1], ['2026-08-12', 1], ['2026-08-13', 1],
    ])]])
    const throughYesterday = deriveTokenActivity(state, 'day', '2026-08-14', 'en-US')
    expect(throughYesterday.currentStreak).toBe(3)
    expect(throughYesterday.longestStreak).toBe(3)

    const interrupted = deriveTokenActivity(state, 'day', '2026-08-15', 'en-US')
    expect(interrupted.currentStreak).toBe(0)

    const today = sessions([['today', activity([['2026-08-14', 1]])]])
    expect(deriveTokenActivity(today, 'day', '2026-08-14', 'en-US').currentStreak).toBe(1)
  })

  it('preserves a precise total and the maximum completed-turn duration', () => {
    const state = sessions([
      ['a', activity([['2026-08-14', 9_000_000_000_000_000]], 12_345)],
      ['b', activity([['2026-08-13', 9_000_000_000_000_000]], 98_765)],
    ])
    const view = deriveTokenActivity(state, 'month', '2026-08-14', 'en-US')
    expect(view.totalTokens).toBe(18_000_000_000_000_000n)
    expect(view.longestCompletedTurnMs).toBe(98_765)
  })
})
