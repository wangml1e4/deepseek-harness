import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PATROL_INTERVAL,
  PATROL_INTERVALS,
  addPatrolTokenUsage,
  nextPatrolCadence,
  nextPatrolDueAfterSave,
  patrolIntervalMilliseconds,
} from '../src/index.ts'

describe('Patrol fixed intervals', () => {
  it('exposes only the requested choices with one hour as the default', () => {
    expect(PATROL_INTERVALS).toEqual(['5m', '30m', '1h', '2h', '6h', '12h', '24h'])
    expect(DEFAULT_PATROL_INTERVAL).toBe('1h')
  })

  it('calculates save-relative due times and fixed cadence after missed triggers', () => {
    expect(nextPatrolDueAfterSave(new Date('2026-08-16T01:00:00.000Z'), '5m'))
      .toBe('2026-08-16T01:05:00.000Z')
    expect(nextPatrolCadence(
      '2026-08-16T01:30:00.000Z',
      '30m',
      new Date('2026-08-16T03:12:00.000Z'),
    )).toBe('2026-08-16T03:30:00.000Z')
    expect(patrolIntervalMilliseconds('24h')).toBe(86_400_000)
  })

  it('adds reported usage without inventing optional buckets', () => {
    const first = {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 4,
      reasoningTokens: 1,
    }
    const second = {
      inputTokens: 3,
      outputTokens: 1,
      cacheWriteTokens: 5,
      reasoningTokens: 2,
    }
    expect(addPatrolTokenUsage(null, null)).toBeNull()
    expect(addPatrolTokenUsage(null, first)).toBe(first)
    expect(addPatrolTokenUsage(second, null)).toBe(second)
    expect(addPatrolTokenUsage(first, second)).toEqual({
      inputTokens: 13,
      outputTokens: 3,
      cacheReadTokens: 4,
      cacheWriteTokens: 5,
      reasoningTokens: 3,
    })
    expect(addPatrolTokenUsage(
      { inputTokens: 1, outputTokens: 2 },
      { inputTokens: 3, outputTokens: 4 },
    )).toEqual({ inputTokens: 4, outputTokens: 6 })
  })
})
