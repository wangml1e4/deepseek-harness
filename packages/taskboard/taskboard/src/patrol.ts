/** Fixed-interval Patrol scheduling calculations. */

import type { PatrolInterval } from './types.ts'

/** Default interval selected before the user enables Patrol. */
export const DEFAULT_PATROL_INTERVAL: PatrolInterval = '1h'

/** Ordered interval choices exposed by every Patrol Consumer. */
export const PATROL_INTERVALS = ['5m', '30m', '1h', '2h', '6h', '12h', '24h'] as const

const INTERVAL_MILLISECONDS: Readonly<Record<PatrolInterval, number>> = {
  '5m': 5 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
}

/**
 * Return one fixed interval in milliseconds.
 * @param interval - Supported Patrol interval.
 * @returns interval duration in milliseconds.
 */
export function patrolIntervalMilliseconds(interval: PatrolInterval): number {
  return INTERVAL_MILLISECONDS[interval]
}

/**
 * Calculate the first cadence point strictly after an instant.
 * @param previousDueAt - Prior scheduled cadence point.
 * @param interval - Saved fixed interval.
 * @param now - Current instant used to discard missed triggers.
 * @returns the first future cadence point as ISO-8601.
 */
export function nextPatrolCadence(
  previousDueAt: string,
  interval: PatrolInterval,
  now: Date,
): string {
  const intervalMs = patrolIntervalMilliseconds(interval)
  const previousMs = Date.parse(previousDueAt)
  const elapsedIntervals = Math.floor((now.getTime() - previousMs) / intervalMs) + 1
  return new Date(previousMs + Math.max(1, elapsedIntervals) * intervalMs).toISOString()
}

/**
 * Calculate the first trigger after a policy save.
 * @param savedAt - Policy save instant.
 * @param interval - Saved fixed interval.
 * @returns the next due instant as ISO-8601.
 */
export function nextPatrolDueAfterSave(savedAt: Date, interval: PatrolInterval): string {
  return new Date(savedAt.getTime() + patrolIntervalMilliseconds(interval)).toISOString()
}
