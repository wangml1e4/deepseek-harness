/*
 * Gantt lifecycle and interaction structure adapted from Dashi Taskboard's
 * web/src/components/GanttView.tsx (Apache-2.0). This version is modified for
 * Harness Issue values, Cordis-owned persistence, and the shared details pane.
 */

import { useEffect, useRef, useState } from 'react'
import { Gantt, type GanttStatic, type Task as GanttTask } from 'dhtmlx-gantt'
import dhtmlxGanttCss from 'dhtmlx-gantt/codebase/dhtmlxgantt.css?inline'
import type { Issue, IssueRelation } from '@deepseek-ai/dsh-taskboard/types'
import type { TaskboardInjected } from './contract.ts'
import { buildGanttData, ganttDatePatch, type TaskboardGanttTask } from './gantt-model.ts'
import type { TaskboardTranslate } from './model.ts'
import type { TaskboardGanttZoom } from './store.ts'
import css from './Taskboard.module.css'

const DHTMLX_STYLESHEET_ID = '@deepseek-ai/dsh-client-ui-taskboard/dhtmlxgantt.css'

if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(DHTMLX_STYLESHEET_ID)}]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@deepseek-ai/dsh-client-ui-taskboard'
  tag.dataset.pluginCss = DHTMLX_STYLESHEET_ID
  tag.textContent = dhtmlxGanttCss
  document.head.appendChild(tag)
}

interface GanttViewProps {
  readonly issues: readonly Issue[]
  readonly relations: readonly IssueRelation[]
  readonly zoom: TaskboardGanttZoom
  readonly openIssue: TaskboardInjected['openIssue']
  readonly updateIssue: TaskboardInjected['updateIssue']
  readonly t: TaskboardTranslate
}

/** Escape task text inserted through DHTMLX string templates. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&#039;'
  })
}

/** Configure the three manual timeline scales exposed by the Taskboard toolbar. */
function configureZoom(instance: GanttStatic): void {
  const month = (date: Date): string => new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short',
  }).format(date)
  const day = (date: Date): string => new Intl.DateTimeFormat(undefined, {
    weekday: 'narrow', day: 'numeric',
  }).format(date)
  instance.ext.zoom.init({
    levels: [
      {
        name: 'day',
        scale_height: 56,
        min_column_width: 54,
        scales: [{ unit: 'month', step: 1, format: month }, { unit: 'day', step: 1, format: day }],
      },
      {
        name: 'week',
        scale_height: 56,
        min_column_width: 36,
        scales: [{ unit: 'month', step: 1, format: month }, { unit: 'day', step: 1, format: day }],
      },
      {
        name: 'month',
        scale_height: 56,
        min_column_width: 76,
        scales: [
          { unit: 'year', step: 1, format: '%Y' },
          { unit: 'month', step: 1, format: '%M' },
        ],
      },
    ],
  })
}

/** DHTMLX-backed manual timeline for filtered Issues and their dependency links. */
export function GanttView({ issues, relations, zoom, openIssue, updateIssue, t }: GanttViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const instanceRef = useRef<GanttStatic | null>(null)
  const issuesRef = useRef(issues)
  const openIssueRef = useRef(openIssue)
  const updateIssueRef = useRef(updateIssue)
  const tRef = useRef(t)
  const [initError, setInitError] = useState<string | null>(null)
  issuesRef.current = issues
  openIssueRef.current = openIssue
  updateIssueRef.current = updateIssue
  tRef.current = t

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const instance = Gantt.getGanttInstance()
    instanceRef.current = instance
    instance.config.date_format = '%Y-%m-%d'
    instance.config.row_height = 48
    instance.config.bar_height = 30
    instance.config.scale_height = 56
    instance.config.grid_width = 320
    instance.config.min_column_width = 36
    instance.config.drag_progress = false
    instance.config.drag_links = false
    instance.config.details_on_dblclick = false
    instance.config.round_dnd_dates = true
    instance.config.select_task = false
    instance.config.show_unscheduled = true
    instance.config.columns = [{
      name: 'text',
      label: tRef.current('gantt.issue'),
      tree: false,
      width: '*',
      min_width: 220,
      template: (item) => {
        const task = item as TaskboardGanttTask
        return `<span class="dsh-gantt-grid-id">${escapeHtml(task.taskboardIdentifier)}</span>`
          + `<strong class="dsh-gantt-grid-title">${escapeHtml(task.text)}</strong>`
      },
    }]
    instance.templates.task_class = (_start, _end, item) => {
      const task = item as TaskboardGanttTask
      return `dsh-gantt-status-${task.taskboardStatus}`
    }
    const rowClass = (_start: Date, _end: Date, item: GanttTask): string => {
      const task = item as TaskboardGanttTask
      return `dsh-gantt-status-${task.taskboardStatus}`
    }
    instance.templates.grid_row_class = rowClass
    instance.templates.task_row_class = rowClass
    instance.templates.task_text = (_start, _end, item) => {
      const task = item as TaskboardGanttTask
      return escapeHtml(task.text)
    }
    configureZoom(instance)
    instance.attachEvent('onAfterTaskUpdate', (id, item) => {
      const issue = issuesRef.current.find(candidate => candidate.id === String(id))
      if (issue === undefined || item.unscheduled || !(item.start_date instanceof Date) || !(item.end_date instanceof Date)) return
      const patch = ganttDatePatch(issue, item.start_date, item.end_date)
      if (patch !== null) void updateIssueRef.current(issue, patch)
    })
    instance.attachEvent('onTaskDblClick', (id) => {
      const issue = issuesRef.current.find(candidate => candidate.id === id)
      if (issue !== undefined) openIssueRef.current(issue.id)
      return false
    })
    try {
      instance.init(container)
    } catch (error: unknown) {
      instanceRef.current = null
      const message = error instanceof Error ? error.message : String(error)
      console.error('[ui-taskboard] Gantt initialization failed:', error)
      setInitError(message)
      return
    }
    return () => {
      instanceRef.current = null
      instance.destructor()
      container.replaceChildren()
    }
  }, [])

  useEffect(() => {
    const instance = instanceRef.current
    if (instance === null) return
    const issueColumn = instance.config.columns.find(column => column.name === 'text')
    if (issueColumn !== undefined) issueColumn.label = t('gantt.issue')
    instance.render()
  }, [t])

  useEffect(() => {
    const instance = instanceRef.current
    if (instance === null) return
    instance.clearAll()
    instance.parse(buildGanttData(issues, relations))
  }, [issues, relations])

  useEffect(() => {
    const instance = instanceRef.current
    if (instance === null) return
    instance.ext.zoom.setLevel(zoom)
  }, [zoom])

  return (
    <div className={css.ganttShell} aria-label={t('gantt.aria')}>
      {initError !== null && <div className={css.stateView} role="alert">{t('gantt.error')}: {initError}</div>}
      <div className={css.ganttCanvas} ref={containerRef} />
    </div>
  )
}
