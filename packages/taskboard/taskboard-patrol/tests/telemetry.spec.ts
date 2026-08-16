import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { PatrolTelemetryRecorder } from '../src/telemetry.ts'

describe('PatrolTelemetryRecorder', () => {
  it('counts retries while deduplicating sourced and legacy assembled usage', () => {
    const recorder = new PatrolTelemetryRecorder()
    recorder.record([
      {
        type: 'assistant/chunk',
        seq: 1,
        data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } } },
      },
      {
        type: 'assistant/chunk',
        seq: 2,
        data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 99, outputTokens: 99 } } },
      },
      {
        type: 'assistant/message',
        seq: 3,
        sourceEventSeqs: [2],
        data: { turn: 1, step: 1, usage: { inputTokens: 8, outputTokens: 2, cacheReadTokens: 5 } },
      },
      {
        type: 'assistant/message',
        seq: 4,
        data: { turn: 1, step: 2, usage: { inputTokens: 4, outputTokens: 1, reasoningTokens: 1 } },
      },
      {
        type: 'assistant/chunk',
        seq: 5,
        data: { turn: 1, step: 3, chunk: { type: 'usage', usage: { inputTokens: 99, outputTokens: 99 } } },
      },
      {
        type: 'assistant/message',
        seq: 6,
        data: { turn: 1, step: 3, usage: { inputTokens: 1, outputTokens: 1 } },
      },
      {
        type: 'assistant/message',
        seq: 7,
        sourceEventSeqs: [],
        data: { turn: 1, step: 4, usage: { inputTokens: 1, outputTokens: 1 } },
      },
    ] as SessionEvent[])
    recorder.record([{
      type: 'assistant/chunk',
      seq: 8,
      data: {
        turn: 2,
        step: 1,
        chunk: { type: 'usage', usage: { inputTokens: 2, outputTokens: 1, cacheWriteTokens: 3 } },
      },
    }] as SessionEvent[])

    expect(recorder.fields()).toEqual({
      tokenUsage: {
        inputTokens: 19,
        outputTokens: 7,
        cacheReadTokens: 5,
        cacheWriteTokens: 3,
        reasoningTokens: 1,
      },
    })
  })

  it('retains the latest structured Provider error and omits absent telemetry', () => {
    expect(new PatrolTelemetryRecorder().fields()).toEqual({})
    const recorder = new PatrolTelemetryRecorder()
    recorder.record([
      {
        type: 'assistant/chunk',
        data: {
          turn: 1,
          step: 1,
          chunk: { type: 'text-delta', text: 'working' },
        },
      },
      {
        type: 'assistant/chunk',
        data: {
          turn: 1,
          step: 1,
          chunk: {
            type: 'finish',
            reason: {
              kind: 'aborted',
              failure: { message: 'Provider stream stopped', code: 'ABORTED' },
            },
          },
        },
      },
      {
        type: 'assistant/chunk',
        data: {
          turn: 1,
          step: 1,
          chunk: {
            type: 'finish',
            reason: {
              kind: 'error',
              failure: {
                message: 'Provider is rate limited',
                code: 'RATE_LIMIT',
                status: 429,
                providerRetryAfterMs: 1_500,
                requestId: 'request-telemetry' as never,
              },
            },
          },
        },
      },
      {
        type: 'turn/end',
        data: { turn: 1, reason: { kind: 'error', error: { message: 'different wrapper', code: 'UNKNOWN' } } },
      },
    ] as SessionEvent[])

    expect(recorder.fields()).toEqual({
      providerError: {
        message: 'Provider is rate limited',
        code: 'RATE_LIMIT',
        status: 429,
        providerRetryAfterMs: 1_500,
        requestId: 'request-telemetry',
      },
    })
  })
})
