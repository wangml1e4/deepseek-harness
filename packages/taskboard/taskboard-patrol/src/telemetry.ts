/** Patrol model-usage and Provider-failure collection from canonical Session events. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  addPatrolTokenUsage,
  type PatrolProviderError,
  type PatrolTokenUsage,
} from '@deepseek-ai/dsh-taskboard'

/** Optional completion fields written with one durable Patrol Attempt. */
export interface PatrolTelemetryFields {
  /** Accumulated Provider-reported model usage. */
  readonly tokenUsage?: PatrolTokenUsage
  /** Latest structured Provider failure. */
  readonly providerError?: PatrolProviderError
}

/** Accumulates non-overlapping Agent turn intervals across implementation and review Sessions. */
export class PatrolTelemetryRecorder {
  private tokenUsage: PatrolTokenUsage | null = null
  private providerError: PatrolProviderError | null = null

  /**
   * Record one non-overlapping Session event interval.
   * @param events - canonical events appended by one assigned Agent turn.
   */
  record(events: readonly SessionEvent[]): void {
    const usages: Array<{
      readonly turn: number
      readonly step: number
      readonly seq: number | null
      usage: PatrolTokenUsage
    }> = []
    for (const event of events) {
      if (event.type === 'assistant/chunk') {
        if (event.data.chunk.type === 'usage') {
          usages.push({
            turn: event.data.turn,
            step: event.data.step,
            seq: event.seq,
            usage: event.data.chunk.usage,
          })
        } else if (
          event.data.chunk.type === 'finish'
          && (event.data.chunk.reason.kind === 'error' || event.data.chunk.reason.kind === 'aborted')
        ) {
          this.providerError = { ...event.data.chunk.reason.failure }
        }
      } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
        const sourced = usages.findLast(value => value.seq !== null && event.sourceEventSeqs?.includes(value.seq))
        if (sourced !== undefined) {
          sourced.usage = event.data.usage
          continue
        }
        if (event.sourceEventSeqs === undefined) {
          const raw = usages.findLast(value => value.turn === event.data.turn && value.step === event.data.step)
          if (raw !== undefined) {
            raw.usage = event.data.usage
            continue
          }
        }
        usages.push({ turn: event.data.turn, step: event.data.step, seq: null, usage: event.data.usage })
      }
    }
    for (const value of usages) {
      this.tokenUsage = addPatrolTokenUsage(this.tokenUsage, value.usage)
    }
  }

  /**
   * Return detached optional fields for one terminal Taskboard mutation.
   * @returns completion telemetry, omitting unreported values.
   */
  fields(): PatrolTelemetryFields {
    return {
      ...this.tokenUsage === null ? {} : { tokenUsage: { ...this.tokenUsage } },
      ...this.providerError === null ? {} : { providerError: { ...this.providerError } },
    }
  }
}
