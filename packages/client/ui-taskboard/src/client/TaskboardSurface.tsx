/** Dashboard, Kanban board, and grouped-list center surface for one Workspace Taskboard. */

import { useEffect, useMemo, useState } from 'react'
import type { DragEvent, FormEvent, ReactNode } from 'react'
import {
  IconCheckOutline14,
  IconCloseOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Issue, IssuePriority, IssueStatus } from '@deepseek-ai/dsh-taskboard/types'
import type { TaskboardStatusFilter } from './store.ts'
import type { TaskboardSurfaceProps as SurfaceProps } from './contract.ts'
import { GanttView } from './GanttView.tsx'
import { filterIssues, ISSUE_PRIORITIES, ISSUE_STATUSES, priorityLabel, statusLabel } from './model.ts'
import css from './Taskboard.module.css'

export type { TaskboardSurfaceProps } from './contract.ts'

/** Compact status marker used across all center views. */
function StatusMark({ status, t }: { status: IssueStatus; t: SurfaceProps['t'] }) {
  return (
    <span className={css.statusMark} data-status={status}>
      <span className={css.statusDot} aria-hidden="true" />
      {statusLabel(t, status)}
    </span>
  )
}

/** Compact priority marker used across all center views. */
function PriorityMark({ priority, t }: { priority: IssuePriority; t: SurfaceProps['t'] }) {
  return <span className={css.priorityMark} data-priority={priority}>{priorityLabel(t, priority)}</span>
}

/** One issue button shared by Dashboard and Board. */
function IssueCard({ issue, openIssue, t, draggable = false, onDragStart, onDrop }: {
  issue: Issue
  openIssue: SurfaceProps['openIssue']
  t: SurfaceProps['t']
  draggable?: boolean
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void
  onDrop?: (event: DragEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      className={css.issueCard}
      aria-label={`${issue.identifier} ${issue.title}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDrop === undefined ? undefined : (event) => { event.preventDefault() }}
      onDrop={onDrop}
      onClick={() => { openIssue(issue.id) }}
    >
      <span className={css.issueCardTitle}>{issue.title}</span>
      <span className={css.issueCardMeta}>
        <span className={css.identifier}>{issue.identifier}</span>
        <PriorityMark priority={issue.priority} t={t} />
      </span>
      {issue.labels.length > 0 && (
        <span className={css.labelRow}>
          {issue.labels.slice(0, 3).map(label => <span className={css.label} key={label}>{label}</span>)}
        </span>
      )}
    </button>
  )
}

/** Summary metrics and recent work for the active filter. */
function DashboardView({ issues, openIssue, t }: {
  issues: readonly Issue[]
  openIssue: SurfaceProps['openIssue']
  t: SurfaceProps['t']
}) {
  const completed = issues.filter(issue => issue.status === 'done').length
  const active = issues.filter(issue => issue.status === 'in_progress' || issue.status === 'in_review').length
  const today = new Date().toISOString().slice(0, 10)
  const overdue = issues.filter(issue => issue.dueDate !== null && issue.dueDate < today && issue.status !== 'done' && issue.status !== 'canceled').length
  const percentage = issues.length === 0 ? 0 : Math.round((completed / issues.length) * 100)
  const recent = [...issues].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)
  return (
    <div className={css.dashboard}>
      <div className={css.metricGrid}>
        <section className={css.metricCard}>
          <span>{t('dashboard.completion')}</span>
          <strong>{percentage}%</strong>
          <span className={css.progressTrack}><span style={{ width: `${percentage}%` }} /></span>
        </section>
        <section className={css.metricCard}><span>{t('dashboard.total')}</span><strong>{issues.length}</strong></section>
        <section className={css.metricCard}><span>{t('dashboard.active')}</span><strong>{active}</strong></section>
        <section className={css.metricCard}><span>{t('dashboard.overdue')}</span><strong>{overdue}</strong></section>
      </div>
      <div className={css.dashboardColumns}>
        <section className={css.summaryPanel}>
          <h2>{t('dashboard.byStatus')}</h2>
          {ISSUE_STATUSES.map((status) => {
            const count = issues.filter(issue => issue.status === status).length
            return <div className={css.summaryRow} key={status}><StatusMark status={status} t={t} /><strong>{count}</strong></div>
          })}
        </section>
        <section className={css.summaryPanel}>
          <h2>{t('dashboard.byPriority')}</h2>
          {ISSUE_PRIORITIES.map((priority) => {
            const count = issues.filter(issue => issue.priority === priority).length
            return <div className={css.summaryRow} key={priority}><PriorityMark priority={priority} t={t} /><strong>{count}</strong></div>
          })}
        </section>
        <section className={css.recentPanel}>
          <h2>{t('dashboard.recent')}</h2>
          {recent.map(issue => <IssueCard issue={issue} openIssue={openIssue} t={t} key={issue.id} />)}
        </section>
      </div>
    </div>
  )
}

/** Seven-column board with HTML drag placement. */
function BoardView({ issues, openIssue, moveIssue, t }: {
  issues: readonly Issue[]
  openIssue: SurfaceProps['openIssue']
  moveIssue: SurfaceProps['moveIssue']
  t: SurfaceProps['t']
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const dragged = issues.find(issue => issue.id === draggedId)
  const move = (status: IssueStatus, before?: Issue): void => {
    if (dragged === undefined || (dragged.status === status && dragged.id === before?.id)) return
    const destination = issues.filter(issue => issue.status === status && issue.id !== dragged.id)
    let sortOrder: number
    if (before === undefined) sortOrder = (destination.at(-1)?.sortOrder ?? 0) + 1000
    else {
      const index = destination.findIndex(issue => issue.id === before.id)
      const previous = index <= 0 ? undefined : destination[index - 1]
      sortOrder = previous === undefined ? before.sortOrder - 1000 : (previous.sortOrder + before.sortOrder) / 2
    }
    setDraggedId(null)
    void moveIssue(dragged, { status, sortOrder })
  }
  return (
    <div className={css.board}>
      {ISSUE_STATUSES.map((status) => {
        const columnIssues = issues.filter(issue => issue.status === status)
        return (
          <section
            className={css.boardColumn}
            data-status={status}
            key={status}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
            onDrop={(event) => { event.preventDefault(); move(status) }}
          >
            <header className={css.columnHeader}>
              <h2><span className={css.statusDot} aria-hidden="true" />{statusLabel(t, status)}</h2>
              <span>{columnIssues.length}</span>
            </header>
            <div className={css.columnBody}>
              {columnIssues.map(issue => (
                <IssueCard
                  issue={issue}
                  openIssue={openIssue}
                  t={t}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', issue.id)
                    setDraggedId(issue.id)
                  }}
                  onDrop={(event) => { event.preventDefault(); event.stopPropagation(); move(status, issue) }}
                  key={issue.id}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Status-grouped tabular view for keyboard-efficient scanning. */
function ListView({ issues, openIssue, t }: {
  issues: readonly Issue[]
  openIssue: SurfaceProps['openIssue']
  t: SurfaceProps['t']
}) {
  return (
    <div className={css.listScroller}>
      <table className={css.issueTable} aria-label={t('list.aria')}>
        <thead><tr><th>{t('list.issue')}</th><th>{t('field.status')}</th><th>{t('list.priority')}</th><th>{t('list.assignee')}</th><th>{t('list.due')}</th></tr></thead>
        <tbody>
          {ISSUE_STATUSES.flatMap(status => issues.filter(issue => issue.status === status).map(issue => (
            <tr key={issue.id}>
              <td><button type="button" className={css.issueLink} onClick={() => { openIssue(issue.id) }}><span>{issue.identifier}</span>{issue.title}</button></td>
              <td><StatusMark status={issue.status} t={t} /></td>
              <td><PriorityMark priority={issue.priority} t={t} /></td>
              <td>{t(`assignee.${issue.assignee}`)}</td>
              <td>{issue.dueDate ?? t('date.none')}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  )
}

/** Local create form; the Host resolves omitted fields and owns persistence. */
function CreateIssueDialog({ close, createIssue, t }: {
  close: () => void
  createIssue: SurfaceProps['createIssue']
  t: SurfaceProps['t']
}) {
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState<IssueStatus>('backlog')
  const [priority, setPriority] = useState<IssuePriority>('none')
  const [pending, setPending] = useState(false)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const normalized = title.trim()
    if (normalized === '' || pending) return
    setPending(true)
    void createIssue({ title: normalized, status, priority }).then((result) => {
      setPending(false)
      if (result.ok) close()
    })
  }
  return (
    <div className={css.dialogMask} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <form className={css.dialog} role="dialog" aria-modal="true" aria-labelledby="taskboard-create-title" onSubmit={submit}>
        <header><h2 id="taskboard-create-title">{t('create.title')}</h2><button type="button" className={css.iconButton} aria-label={t('close')} onClick={close}><IconCloseOutline16 /></button></header>
        <label>{t('field.title')}<input autoFocus value={title} onChange={(event) => { setTitle(event.target.value) }} /></label>
        <div className={css.formColumns}>
          <label>{t('field.status')}<select value={status} onChange={(event) => { setStatus(event.target.value as IssueStatus) }}>{ISSUE_STATUSES.map(value => <option value={value} key={value}>{statusLabel(t, value)}</option>)}</select></label>
          <label>{t('field.priority')}<select value={priority} onChange={(event) => { setPriority(event.target.value as IssuePriority) }}>{ISSUE_PRIORITIES.map(value => <option value={value} key={value}>{priorityLabel(t, value)}</option>)}</select></label>
        </div>
        <footer><button type="button" className={css.secondaryButton} onClick={close}>{t('cancel')}</button><button type="submit" className={css.primaryButton} disabled={pending || title.trim() === ''}>{t('create.submit')}</button></footer>
      </form>
    </div>
  )
}

/** Main Taskboard center surface elected by the generic shell chain. */
export function TaskboardSurface({
  matched,
  useTaskboard,
  useStore,
  actions,
  activate,
  refresh,
  createIssue,
  openIssue,
  openPatrol,
  moveIssue,
  updateIssue,
  t,
}: SurfaceProps) {
  const snapshot = useTaskboard(value => value)
  const view = useStore(value => value)
  const [creating, setCreating] = useState(false)
  useEffect(() => { void activate(matched) }, [activate, matched])
  const filtered = useMemo(() => filterIssues(snapshot.issues, view), [snapshot.issues, view])
  const hasFilters = view.query !== '' || view.status !== 'all' || view.priority !== 'all' || view.label !== ''
  let body: ReactNode
  if (snapshot.phase === 'cold' || snapshot.phase === 'loading') {
    body = <div className={css.stateView}><span className={css.skeletonLine} />{t('loading')}</div>
  } else if (snapshot.phase === 'error') {
    body = <div className={css.stateView}><p>{snapshot.error}</p><button type="button" className={css.secondaryButton} onClick={() => { void refresh() }}>{t('retry')}</button></div>
  } else if (snapshot.issues.length === 0) {
    body = <div className={css.stateView}><IconCheckOutline14 size={22} /><h2>{t('empty.title')}</h2><p>{t('empty.body')}</p></div>
  } else if (filtered.length === 0) {
    body = <div className={css.stateView}><p>{t('empty.filtered')}</p></div>
  } else if (view.mode === 'dashboard') {
    body = <DashboardView issues={filtered} openIssue={openIssue} t={t} />
  } else if (view.mode === 'board') {
    body = <BoardView issues={filtered} openIssue={openIssue} moveIssue={moveIssue} t={t} />
  } else if (view.mode === 'list') {
    body = <ListView issues={filtered} openIssue={openIssue} t={t} />
  } else {
    body = (
      <GanttView
        issues={filtered}
        relations={snapshot.workspaceRelations}
        zoom={view.ganttZoom}
        openIssue={openIssue}
        updateIssue={updateIssue}
        t={t}
      />
    )
  }
  return (
    <main className={css.surface}>
      <header className={css.topbar}>
        <div className={css.heading}><h1>{snapshot.workspace?.title ?? t('title')}</h1><span>{snapshot.workspace?.prefix ?? ''}</span></div>
        <nav className={css.tabs} role="tablist" aria-label={t('title')}>
          {(['dashboard', 'board', 'list', 'gantt'] as const).map(mode => <button type="button" role="tab" aria-selected={view.mode === mode} onClick={() => { actions.setMode(mode) }} key={mode}>{t(`view.${mode}`)}</button>)}
        </nav>
        <div className={css.topActions}>
          <button type="button" className={css.secondaryButton} aria-label={t('patrol.open')} onClick={openPatrol}>
            <span className={css.patrolStateDot} data-enabled={snapshot.patrol?.policy.enabled ?? false} />
            <IconSettingsOutline16 />{t('patrol.title')}
          </button>
          <button type="button" className={css.iconButton} aria-label={t('retry')} onClick={() => { void refresh() }}><IconRefreshOutline16 /></button>
          <button type="button" className={css.primaryButton} aria-label={t('create')} onClick={() => { setCreating(true) }}><IconPlusOutline16 />{t('create')}</button>
        </div>
      </header>
      <div className={css.toolbar}>
        <label className={css.search}><IconSearchOutline16 /><input aria-label={t('search.placeholder')} placeholder={t('search.placeholder')} value={view.query} onChange={(event) => { actions.setQuery(event.target.value) }} /></label>
        <select aria-label={t('filter.status')} value={view.status} onChange={(event) => { actions.setStatus(event.target.value as TaskboardStatusFilter) }}><option value="all">{t('filter.status')}</option>{ISSUE_STATUSES.map(status => <option value={status} key={status}>{statusLabel(t, status)}</option>)}</select>
        <select aria-label={t('filter.priority')} value={view.priority} onChange={(event) => { actions.setPriority(event.target.value as typeof view.priority) }}><option value="all">{t('filter.priority')}</option>{ISSUE_PRIORITIES.map(priority => <option value={priority} key={priority}>{priorityLabel(t, priority)}</option>)}</select>
        <input className={css.labelFilter} aria-label={t('filter.label')} placeholder={t('filter.label')} value={view.label} onChange={(event) => { actions.setLabel(event.target.value) }} />
        {view.mode === 'gantt' && (
          <select aria-label={t('gantt.zoom')} value={view.ganttZoom} onChange={(event) => { actions.setGanttZoom(event.target.value as typeof view.ganttZoom) }}>
            {(['day', 'week', 'month'] as const).map(zoom => <option value={zoom} key={zoom}>{t(`gantt.zoom.${zoom}`)}</option>)}
          </select>
        )}
        {hasFilters && <button type="button" className={css.ghostButton} onClick={() => { actions.resetFilters() }}>{t('filter.reset')}</button>}
      </div>
      <div className={css.content}>{body}</div>
      {snapshot.actionError !== null && <div className={css.errorToast} role="alert">{snapshot.actionError}</div>}
      {creating && <CreateIssueDialog close={() => { setCreating(false) }} createIssue={createIssue} t={t} />}
    </main>
  )
}
