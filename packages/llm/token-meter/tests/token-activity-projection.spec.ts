import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenActivityProjection } from '@deepseek-ai/dsh-token-meter/client'
import {
  activityDateKey, tokenActivityProjectionDefinition,
} from '@deepseek-ai/dsh-token-meter/src/activity-projection.ts'

/** Build one synthetic durable event with a controlled timestamp. */
function at(seq: number, time: number, type: string, data: unknown): SessionEvent {
  return { type, seq, time, data } as unknown as SessionEvent
}

/** Fold controlled events through the projection definition. */
function fold(events: readonly SessionEvent[]): TokenActivityProjection {
  const state = events.reduce(
    (current, event) => tokenActivityProjectionDefinition.apply(current, event),
    tokenActivityProjectionDefinition.init(),
  )
  return tokenActivityProjectionDefinition.view(state)
}

function directUser(clientTimeZone?: string): unknown {
  return {
    id: 'message-1',
    role: 'user',
    content: [],
    source: { kind: 'user', rpcId: 'rpc-1', ...clientTimeZone === undefined ? {} : { clientTimeZone } },
  }
}

function usage(inputTokens: number, outputTokens: number, extras: Record<string, number> = {}): unknown {
  return { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens, outputTokens, ...extras } } }
}

describe('tokenActivity projection', () => {
  it('serves the empty value and owns an independent cache version', () => {
    expect(tokenActivityProjectionDefinition.stateVersion).toBe(1)
    expect(fold([])).toEqual({ days: [], longestCompletedTurnMs: 0 })
  })

  it('uses the recorded prompt zone at a UTC/local day boundary', () => {
    const instant = Date.parse('2026-02-28T16:30:00.000Z')
    expect(activityDateKey(instant, 'UTC')).toBe('2026-02-28')
    expect(activityDateKey(instant, 'Asia/Shanghai')).toBe('2026-03-01')
    expect(fold([
      at(0, instant - 1_000, 'user/message', directUser('Asia/Shanghai')),
      at(1, instant, 'assistant/chunk', usage(10, 4, {
        cacheReadTokens: 7, cacheWriteTokens: 2, reasoningTokens: 3,
      })),
    ])).toEqual({
      days: [{
        date: '2026-03-01',
        uncachedInputTokens: 10,
        outputTokens: 4,
        cacheReadTokens: 7,
        cacheWriteTokens: 2,
      }],
      longestCompletedTurnMs: 0,
    })
  })

  it('handles leap day and falls back to UTC for a direct user without a zone', () => {
    const leapInstant = Date.parse('2024-03-01T07:30:00.000Z')
    expect(activityDateKey(leapInstant, 'America/Los_Angeles')).toBe('2024-02-29')
    expect(fold([
      at(0, leapInstant - 2_000, 'user/message', directUser('America/Los_Angeles')),
      at(1, leapInstant, 'assistant/chunk', usage(1, 1)),
      at(2, Date.parse('2025-01-01T00:01:00.000Z') - 1_000, 'user/message', directUser()),
      at(3, Date.parse('2025-01-01T00:01:00.000Z'), 'assistant/chunk', {
        turn: 2, step: 1, chunk: { type: 'usage', usage: { inputTokens: 2, outputTokens: 0 } },
      }),
    ])).toEqual({
      days: [
        { date: '2024-02-29', uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        { date: '2025-01-01', uncachedInputTokens: 2, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ],
      longestCompletedTurnMs: 0,
    })
  })

  it('moves a same-step final replacement across midnight instead of double counting', () => {
    const chunkTime = Date.parse('2026-12-31T23:59:59.000Z')
    const finalTime = Date.parse('2027-01-01T00:00:01.000Z')
    expect(fold([
      at(0, chunkTime - 1_000, 'user/message', directUser('UTC')),
      at(1, chunkTime, 'assistant/chunk', usage(10, 2)),
      at(2, finalTime, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { id: 'message-2', role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } },
        usage: { inputTokens: 14, outputTokens: 5, cacheReadTokens: 8, cacheWriteTokens: 1 },
      }),
    ])).toEqual({
      days: [{
        date: '2027-01-01',
        uncachedInputTokens: 14,
        outputTokens: 5,
        cacheReadTokens: 8,
        cacheWriteTokens: 1,
      }],
      longestCompletedTurnMs: 0,
    })
  })

  it('retains the latest provider usage chunk when a request has no final message', () => {
    const time = Date.parse('2026-06-15T12:00:00.000Z')
    const sample = { inputTokens: 9, outputTokens: 1 }
    expect(fold([
      at(0, time, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: sample } }),
      at(1, time + 1, 'step/end', { turn: 1, step: 1 }),
    ]).days).toEqual([
      { date: '2026-06-15', uncachedInputTokens: 9, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
  })

  it('replaces an identical same-step final sample without double counting', () => {
    const time = Date.parse('2026-06-15T12:00:00.000Z')
    const sample = { inputTokens: 9, outputTokens: 1 }
    expect(fold([
      at(0, time, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage', usage: sample } }),
      at(1, time + 1, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { id: 'message-2', role: 'assistant', content: [], source: { kind: 'model', provider: 'mock', model: 'mock' } },
        usage: sample,
      }),
    ]).days).toEqual([
      { date: '2026-06-15', uncachedInputTokens: 9, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    ])
  })

  it('takes the maximum completed duration and ignores aborted, incomplete, or mismatched turns', () => {
    expect(fold([
      at(0, 1_000, 'turn/start', { turn: 1 }),
      at(1, 6_000, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      at(2, 8_000, 'turn/start', { turn: 2 }),
      at(3, 20_000, 'turn/end', { turn: 99, reason: { kind: 'completed' } }),
      at(4, 30_000, 'turn/end', { turn: 2, reason: { kind: 'aborted', reason: { kind: 'legacy' } } }),
      at(5, 40_000, 'turn/start', { turn: 3 }),
    ]).longestCompletedTurnMs).toBe(5_000)
  })

  it('round-trips its private state through lossless JSON before later events apply', () => {
    const before = [
      at(0, 1_000, 'user/message', directUser('UTC')),
      at(1, Date.parse('2026-08-13T10:00:00.000Z'), 'assistant/chunk', usage(4, 1)),
      at(2, 20_000, 'turn/start', { turn: 1 }),
    ]
    let state = before.reduce(
      (current, event) => tokenActivityProjectionDefinition.apply(current, event),
      tokenActivityProjectionDefinition.init(),
    )
    state = JSON.parse(JSON.stringify(state)) as typeof state
    state = tokenActivityProjectionDefinition.apply(
      state,
      at(3, 27_500, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    )
    expect(tokenActivityProjectionDefinition.view(state)).toEqual({
      days: [{ date: '2026-08-13', uncachedInputTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }],
      longestCompletedTurnMs: 7_500,
    })
  })
})
