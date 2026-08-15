/** Token activity settings page fed exclusively by the root session-list hook. */

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenUsageKey } from './locales.ts'
import {
  dateKeyAt, deriveTokenActivity, missingActivitySessionIds, type ActivityGranularity,
} from './activity.ts'
import styles from './TokenUsageSection.module.css'

/** Dependencies injected by this page's slot registration. */
export interface TokenUsageSectionInjected {
  t: (key: TokenUsageKey, params?: Record<string, string>) => string
  locale: () => string
  timeZone: () => string
  now: () => number
  hydrateActivity: (
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ) => Promise<{ failed: readonly SessionId[] }>
}

/** Complete slot-delivered props. */
export type TokenUsageSectionProps = PropsRuntime<'settings.section'> & Partial<TokenUsageSectionInjected>

const GRANULARITIES: readonly ActivityGranularity[] = ['day', 'week', 'month']

function compactNumber(value: number | bigint, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function fullNumber(value: number | bigint, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)
}

function duration(
  value: number,
  locale: string,
  t: TokenUsageSectionInjected['t'],
): string {
  const elapsedSeconds = Math.max(0, Math.trunc(value / 1_000))
  const hours = Math.trunc(elapsedSeconds / 3_600)
  const minutes = Math.trunc(elapsedSeconds / 60) % 60
  const seconds = elapsedSeconds % 60
  const number = (part: number): string => new Intl.NumberFormat(locale).format(part)
  const parts: string[] = []
  if (hours > 0) parts.push(`${number(hours)}${t('hourUnit')}`)
  if (minutes > 0) parts.push(`${number(minutes)}${t('minuteUnit')}`)
  if (seconds > 0 || parts.length === 0) parts.push(`${number(seconds)}${t('secondUnit')}`)
  return parts.join(locale.startsWith('zh') ? '' : ' ')
}

function interpolation(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((copy, [key, value]) => copy.replaceAll(`{${key}}`, value), template)
}

/** Render the page, or nothing during an incomplete test/composition injection. */
export function TokenUsageSection(props: TokenUsageSectionProps): ReactNode {
  const { useSessions, t, locale, timeZone, now, hydrateActivity } = props
  if (
    t === undefined || locale === undefined || timeZone === undefined || now === undefined
    || hydrateActivity === undefined
  ) return null
  const state = useSessions(snapshot => snapshot)
  const [granularity, setGranularity] = useState<ActivityGranularity>('day')
  const missingIds = useMemo(() => missingActivitySessionIds(state), [state])
  const [retryGeneration, setRetryGeneration] = useState(0)
  const [load, setLoad] = useState<{ state: 'loading' | 'ready' | 'error'; failed: number }>(() => ({
    state: state.phase === 'ready' && missingIds.length === 0 ? 'ready' : 'loading',
    failed: 0,
  }))
  useEffect(() => {
    if (state.phase !== 'ready') {
      setLoad({ state: 'loading', failed: 0 })
      return
    }
    if (missingIds.length === 0) {
      setLoad({ state: 'ready', failed: 0 })
      return
    }
    const controller = new AbortController()
    let active = true
    setLoad({ state: 'loading', failed: 0 })
    void hydrateActivity(missingIds, controller.signal).then((result) => {
      if (!active) return
      setLoad(result.failed.length === 0
        ? { state: 'ready', failed: 0 }
        : { state: 'error', failed: result.failed.length })
    }).catch(() => {
      if (active && !controller.signal.aborted) {
        setLoad({ state: 'error', failed: missingIds.length })
      }
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [hydrateActivity, missingIds, retryGeneration, state.phase])
  const localeId = locale()
  const zone = timeZone()
  const today = dateKeyAt(now(), zone)
  const view = useMemo(
    () => deriveTokenActivity(state, granularity, today, localeId),
    [state, granularity, today, localeId],
  )
  const displayLoadState = load.state === 'ready' && missingIds.length > 0 ? 'loading' : load.state
  const fullTokens = (value: bigint): string => interpolation(t('fullTokens'), { tokens: fullNumber(value, localeId) })
  const cards = [
    { label: t('totalTokens'), value: compactNumber(view.totalTokens, localeId), title: fullTokens(view.totalTokens) },
    { label: t('peakTokens'), value: compactNumber(view.peakTokens, localeId), title: fullTokens(view.peakTokens) },
    { label: t('longestTurn'), value: duration(view.longestCompletedTurnMs, localeId, t), title: duration(view.longestCompletedTurnMs, localeId, t) },
    { label: t('currentStreak'), value: `${fullNumber(view.currentStreak, localeId)} ${t('dayUnit')}`, title: `${fullNumber(view.currentStreak, localeId)} ${t('dayUnit')}` },
    { label: t('longestStreak'), value: `${fullNumber(view.longestStreak, localeId)} ${t('dayUnit')}`, title: `${fullNumber(view.longestStreak, localeId)} ${t('dayUnit')}` },
  ]
  const activityStyle = { '--activity-columns': view.columns } as CSSProperties

  return (
    <section
      className={styles.section}
      data-token-usage-section
      data-granularity={granularity}
      data-load-state={displayLoadState}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.intro}>{t('intro')}</p>
      </header>

      <ul className={styles.summary} aria-label={t('title')} data-token-usage-summary>
        {cards.map(card => (
          <li className={styles.card} key={card.label}>
            <strong className={styles.cardValue} title={card.title} aria-label={`${card.label}: ${card.title}`}>{card.value}</strong>
            <span className={styles.cardLabel}>{card.label}</span>
          </li>
        ))}
      </ul>

      {displayLoadState === 'loading' && (
        <p className={styles.loadStatus} role="status">{t('loading')}</p>
      )}
      {displayLoadState === 'error' && (
        <div className={styles.loadFailure} role="alert">
          <span>{interpolation(t('loadFailed'), { count: fullNumber(load.failed, localeId) })}</span>
          <button type="button" onClick={() => { setRetryGeneration(value => value + 1) }}>{t('retry')}</button>
        </div>
      )}

      <div className={styles.activityHeader}>
        <h3 className={styles.activityTitle}>{t('tokenActivity')}</h3>
        <div className={styles.switcher} role="group" aria-label={t('tokenActivity')}>
          {GRANULARITIES.map(value => (
            <button
              className={styles.switchButton}
              type="button"
              aria-pressed={granularity === value}
              key={value}
              onClick={() => { setGranularity(value) }}
            >
              {t(value === 'day' ? 'daily' : value === 'week' ? 'weekly' : 'monthly')}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.zoneNote}>{interpolation(t('timeZone'), { zone })}</p>
      {displayLoadState === 'ready' && view.totalTokens === 0n && (
        <p className={styles.empty} role="status">{t('empty')}</p>
      )}

      <div className={styles.chart}>
        <div className={styles.labels} style={activityStyle} aria-hidden="true">
          {view.labels.map(label => (
            <span key={`${label.column}-${label.label}`} style={{ gridColumn: label.column }}>{label.label}</span>
          ))}
        </div>
        <div className={`${styles.heatmap} ${styles[granularity]}`} style={activityStyle}>
          {view.periods.map(period => period.inRange ? (
            <button
              key={period.key}
              type="button"
              className={`${styles.cell} ${styles[`level${period.level}`]}`}
              title={interpolation(t('periodTokens'), { period: period.label, tokens: fullNumber(period.tokens, localeId) })}
              aria-label={interpolation(t('periodTokens'), { period: period.label, tokens: fullNumber(period.tokens, localeId) })}
            />
          ) : <span className={styles.filler} key={period.key} aria-hidden="true" />)}
        </div>
        <div className={styles.legend} aria-hidden="true">
          <span>{t('less')}</span>
          {[0, 1, 2, 3, 4].map(level => <span className={`${styles.legendCell} ${styles[`level${level}`]}`} key={level} />)}
          <span>{t('more')}</span>
        </div>
      </div>
    </section>
  )
}
