import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PATROL_INTERVAL,
  PATROL_INTERVALS,
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
})
