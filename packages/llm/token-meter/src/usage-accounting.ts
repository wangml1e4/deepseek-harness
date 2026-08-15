/** Shared arithmetic for provider-reported usage projection units. */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { TokenUsageProjection } from './projection.ts'

/**
 * Create a fresh empty value for the four disjoint provider-usage buckets.
 * @returns a fresh four-bucket zero value.
 */
export const zeroUsageBuckets = (): TokenUsageProjection => ({
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/**
 * Project provider usage onto the four disjoint accounting buckets.
 * @param usage - provider-reported usage for one request sample.
 * @returns the normalized buckets, excluding reasoning as a separate total.
 */
export const usageBucketsFrom = (usage: TokenUsage): TokenUsageProjection => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

/**
 * Compare two normalized usage samples.
 * @param left - first sample.
 * @param right - second sample.
 * @returns whether every disjoint bucket is equal.
 */
export const usageBucketsEqual = (
  left: TokenUsageProjection,
  right: TokenUsageProjection,
): boolean =>
  left.uncachedInputTokens === right.uncachedInputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

/**
 * Replace one earlier sample inside an accumulated four-bucket value.
 * @param totals - accumulated buckets containing `previous`, when supplied.
 * @param previous - sample to remove before adding `next`.
 * @param next - sample to add.
 * @returns a fresh accumulated value.
 */
export const replaceUsageBuckets = (
  totals: TokenUsageProjection,
  previous: TokenUsageProjection | undefined,
  next: TokenUsageProjection,
): TokenUsageProjection => ({
  uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
  outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
  cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
})
