/** Workspace Patrol configuration and permanent Run history sidebar. */

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  IconCloseOutline16,
  IconPauseOutline16,
  IconPlayOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PatrolInterval, PatrolTokenUsage } from '@deepseek-ai/dsh-taskboard/types'
import type { TaskboardPatrolValue } from '@deepseek-ai/dsh-taskboard-remote/types'
import type { TaskboardDetailsProps as DetailsProps } from './contract.ts'
import css from './Taskboard.module.css'

type PatrolPanelProps = Pick<DetailsProps, 'useTaskboard' | 'updatePatrol' | 'runPatrol' | 'close' | 't'>

function usageText(usage: PatrolTokenUsage, t: DetailsProps['t']): string {
  const values = [
    t('patrol.usage.input', { count: usage.inputTokens }),
    t('patrol.usage.output', { count: usage.outputTokens }),
  ]
  if (usage.cacheReadTokens !== undefined) values.push(t('patrol.usage.cacheRead', { count: usage.cacheReadTokens }))
  if (usage.cacheWriteTokens !== undefined) values.push(t('patrol.usage.cacheWrite', { count: usage.cacheWriteTokens }))
  if (usage.reasoningTokens !== undefined) values.push(t('patrol.usage.reasoning', { count: usage.reasoningTokens }))
  return values.join(' · ')
}

const INTERVALS: readonly PatrolInterval[] = ['5m', '30m', '1h', '2h', '6h', '12h', '24h']

interface PatrolDraft {
  interval: PatrolInterval
  baseBranch: string
  agentPreset: string
  provider: string
  model: string
  reasoningEffort: string
  permissionPreset: string
}

/** Materialize controlled fields while retaining nullable Host-default choices. */
function draftOf(patrol: TaskboardPatrolValue): PatrolDraft {
  return {
    interval: patrol.policy.interval,
    baseBranch: patrol.policy.baseBranch ?? patrol.defaults.baseBranch,
    agentPreset: patrol.policy.agentPreset ?? '',
    provider: patrol.policy.provider ?? '',
    model: patrol.policy.model ?? '',
    reasoningEffort: patrol.policy.reasoningEffort ?? '',
    permissionPreset: patrol.policy.permissionPreset,
  }
}

/** Patrol settings and audit view rendered inside the existing details sidebar. */
export function PatrolPanel({ useTaskboard, updatePatrol, runPatrol, close, t }: PatrolPanelProps) {
  const snapshot = useTaskboard(value => value)
  const patrol = snapshot.patrol
  const [draft, setDraft] = useState<PatrolDraft | null>(() => patrol === null ? null : draftOf(patrol))
  const [pending, setPending] = useState(false)
  useEffect(() => { setDraft(patrol === null ? null : draftOf(patrol)) }, [patrol])
  const provider = patrol?.providers.find(value => value.id === draft?.provider)
  const model = provider?.models.find(value => value.id === draft?.model)
  const activeRun = patrol?.runs.find(value => value.run.state === 'active')
  const pendingDisable = patrol !== null && !patrol.policy.enabled && activeRun !== undefined
  const patch = (enabled = patrol?.policy.enabled ?? false) => draft === null ? null : {
    enabled,
    interval: draft.interval,
    baseBranch: draft.baseBranch,
    agentPreset: draft.agentPreset === '' ? null : draft.agentPreset,
    provider: draft.provider === '' ? null : draft.provider,
    model: draft.provider === '' ? null : draft.model,
    reasoningEffort: draft.reasoningEffort === '' ? null : draft.reasoningEffort,
    permissionPreset: draft.permissionPreset,
  }
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const input = patch()
    if (input === null || pending) return
    setPending(true)
    void updatePatrol(input).finally(() => { setPending(false) })
  }
  const toggle = (): void => {
    const input = patch(!(patrol?.policy.enabled ?? false))
    if (input === null || pending) return
    setPending(true)
    void updatePatrol(input).finally(() => { setPending(false) })
  }
  const nextDue = useMemo(() => patrol?.policy.nextDueAt === null || patrol?.policy.nextDueAt === undefined
    ? t('patrol.notScheduled')
    : new Date(patrol.policy.nextDueAt).toLocaleString(), [patrol?.policy.nextDueAt, t])
  if (patrol === null || draft === null) {
    return <aside className={css.detailsEmpty}>{t('patrol.unavailable')}</aside>
  }
  return (
    <aside className={css.details}>
      <header className={css.detailsHeader}>
        <div><span className={css.eyebrow}>{t('patrol.automation')}</span><strong>{t('patrol.title')}</strong></div>
        <button type="button" className={css.iconButton} aria-label={t('patrol.close')} onClick={close}><IconCloseOutline16 /></button>
      </header>
      <div className={css.detailsScroll}>
        <section className={css.patrolHero} data-enabled={patrol.policy.enabled}>
          <div>
            <strong>{patrol.policy.enabled ? t('patrol.enabled') : t('patrol.disabled')}</strong>
            <span>{pendingDisable ? t('patrol.pendingDisable') : t('patrol.nextDue', { time: nextDue })}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={patrol.policy.enabled}
            aria-label={t('patrol.toggle')}
            className={css.switch}
            disabled={pending}
            onClick={toggle}
          ><span /></button>
        </section>

        <form className={css.issueForm} onSubmit={submit}>
          <label>{t('patrol.interval')}<select value={draft.interval} onChange={(event) => { setDraft(value => value === null ? value : { ...value, interval: event.target.value as PatrolInterval }) }}>{INTERVALS.map(interval => <option value={interval} key={interval}>{interval}</option>)}</select></label>
          <label>{t('patrol.baseBranch')}<select value={draft.baseBranch} onChange={(event) => { setDraft(value => value === null ? value : { ...value, baseBranch: event.target.value }) }}>{patrol.branches.map(branch => <option value={branch} key={branch}>{branch}</option>)}</select></label>
          <label>{t('patrol.agentPreset')}<select value={draft.agentPreset} onChange={(event) => { setDraft(value => value === null ? value : { ...value, agentPreset: event.target.value }) }}><option value="">{t('patrol.hostDefault', { value: patrol.defaults.agentPreset })}</option>{patrol.agentPresets.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
          <label>{t('patrol.provider')}<select value={draft.provider} onChange={(event) => {
            const nextProvider = patrol.providers.find(value => value.id === event.target.value)
            setDraft(value => value === null ? value : {
              ...value,
              provider: event.target.value,
              model: nextProvider?.models[0]?.id ?? '',
              reasoningEffort: '',
            })
          }}><option value="">{t('patrol.hostDefault', { value: patrol.defaults.provider })}</option>{patrol.providers.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
          {draft.provider !== '' && <label>{t('patrol.model')}<select value={draft.model} onChange={(event) => { setDraft(value => value === null ? value : { ...value, model: event.target.value, reasoningEffort: '' }) }}>{provider?.models.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>}
          {draft.provider !== '' && model !== undefined && model.reasoning.length > 0 && <label>{t('patrol.reasoning')}<select value={draft.reasoningEffort} onChange={(event) => { setDraft(value => value === null ? value : { ...value, reasoningEffort: event.target.value }) }}><option value="">{t('patrol.modelDefault')}</option>{model.reasoning.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>}
          <label>{t('patrol.permission')}<select value={draft.permissionPreset} onChange={(event) => { setDraft(value => value === null ? value : { ...value, permissionPreset: event.target.value }) }}>{patrol.permissionPresets.map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>
          <p className={css.fieldHint}>{t('patrol.permissionHint')}</p>
          <div className={css.buttonRow}>
            <button type="submit" className={css.secondaryButton} disabled={pending}>{t('patrol.save')}</button>
            <button type="button" className={css.primaryButton} disabled={pending || activeRun !== undefined} onClick={() => { void runPatrol() }}><IconPlayOutline16 />{t('patrol.runNow')}</button>
          </div>
        </form>

        <section className={css.detailSection}>
          <h2>{t('patrol.history')}</h2>
          {patrol.runs.length === 0 ? <p className={css.muted}>{t('patrol.historyEmpty')}</p> : (
            <div className={css.patrolHistory}>{patrol.runs.map(({ run, attempts }) => (
              <details key={run.id} open={run.state === 'active'}>
                <summary>
                  <span className={css.runState} data-state={run.state}>{run.state === 'active' ? <IconPlayOutline16 /> : <IconPauseOutline16 />}{t(`patrol.result.${run.result ?? 'active'}`)}</span>
                  <time>{new Date(run.startedAt).toLocaleString()}</time>
                </summary>
                <p>{t(`patrol.trigger.${run.trigger}`)} · {attempts.length} {t('patrol.attempts')}</p>
                {run.lastRecoveredAt !== null && <p>{t('patrol.recovery', {
                  count: run.recoveryCount,
                  time: new Date(run.lastRecoveredAt).toLocaleString(),
                })}</p>}
                {run.tokenUsage !== null && <p>{usageText(run.tokenUsage, t)}</p>}
                {run.providerError !== null && <>
                  <p className={css.inlineError}>{t('patrol.providerError', {
                    code: run.providerError.code,
                    message: run.providerError.message,
                  })}</p>
                  {(run.providerError.status !== undefined
                    || run.providerError.providerRetryAfterMs !== undefined
                    || run.providerError.requestId !== undefined) && <p>{[
                    run.providerError.status === undefined
                      ? null
                      : t('patrol.providerStatus', { status: run.providerError.status }),
                    run.providerError.providerRetryAfterMs === undefined
                      ? null
                      : t('patrol.providerRetry', { milliseconds: run.providerError.providerRetryAfterMs }),
                    run.providerError.requestId === undefined
                      ? null
                      : t('patrol.providerRequest', { id: run.providerError.requestId }),
                  ].filter(value => value !== null).join(' · ')}</p>}
                </>}
                {run.error !== null && <p className={css.inlineError}>{run.error}</p>}
                {attempts.map(attempt => (
                  <div className={css.attemptRow} key={attempt.id}>
                    <code>{attempt.issueId}</code><span>{attempt.result ?? attempt.state}</span>
                  </div>
                ))}
              </details>
            ))}</div>
          )}
        </section>
        {snapshot.actionError !== null && <p className={css.inlineError} role="alert">{snapshot.actionError}</p>}
      </div>
    </aside>
  )
}
