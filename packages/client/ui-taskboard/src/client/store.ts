/** Persisted Taskboard viewing state shared by its center and details entries. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { IssuePriority, IssueStatus } from '@deepseek-ai/dsh-taskboard/types'

/** Views shipped by the Taskboard center surface. */
export type TaskboardMode = 'dashboard' | 'board' | 'list' | 'gantt'
/** Persisted Gantt timeline scale. */
export type TaskboardGanttZoom = 'day' | 'week' | 'month'
/** Status filter including the unfiltered choice. */
export type TaskboardStatusFilter = IssueStatus | 'active' | 'all'
/** Priority filter including the unfiltered choice. */
export type TaskboardPriorityFilter = IssuePriority | 'all'
/** Due-date filter used by Dashboard summary links and the toolbar. */
export type TaskboardScheduleFilter = 'all' | 'overdue' | 'upcoming'

/** Persisted Taskboard viewing and filter state. */
export interface TaskboardViewState {
  mode: TaskboardMode
  query: string
  status: TaskboardStatusFilter
  priority: TaskboardPriorityFilter
  schedule: TaskboardScheduleFilter
  label: string
  ganttZoom: TaskboardGanttZoom
}

type TaskboardViewActions = {
  setMode: (draft: TaskboardViewState, mode: TaskboardMode) => void
  setQuery: (draft: TaskboardViewState, query: string) => void
  setStatus: (draft: TaskboardViewState, status: TaskboardStatusFilter) => void
  setPriority: (draft: TaskboardViewState, priority: TaskboardPriorityFilter) => void
  setSchedule: (draft: TaskboardViewState, schedule: TaskboardScheduleFilter) => void
  setLabel: (draft: TaskboardViewState, label: string) => void
  setGanttZoom: (draft: TaskboardViewState, zoom: TaskboardGanttZoom) => void
  resetFilters: (draft: TaskboardViewState) => void
}

/**
 * Create the root-scoped Taskboard view-store handle.
 * @returns store handle consumed by the center and details registrations.
 */
export function createTaskboardViewStore(): EngineStoreHandle<TaskboardViewState, TaskboardViewActions> {
  return defineStore({
    init: (): TaskboardViewState => ({
      mode: 'dashboard',
      query: '',
      status: 'all',
      priority: 'all',
      schedule: 'all',
      label: '',
      ganttZoom: 'week',
    }),
    persist: 'dsh.taskboard.view.v2',
    actions: {
      setMode: (draft, mode) => { draft.mode = mode },
      setQuery: (draft, query) => { draft.query = query },
      setStatus: (draft, status) => { draft.status = status },
      setPriority: (draft, priority) => { draft.priority = priority },
      setSchedule: (draft, schedule) => { draft.schedule = schedule },
      setLabel: (draft, label) => { draft.label = label },
      setGanttZoom: (draft, zoom) => { draft.ganttZoom = zoom },
      resetFilters: (draft) => {
        draft.query = ''
        draft.status = 'all'
        draft.priority = 'all'
        draft.schedule = 'all'
        draft.label = ''
      },
    },
  })
}
