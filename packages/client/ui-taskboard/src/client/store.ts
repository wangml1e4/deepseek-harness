/** Persisted Taskboard viewing state shared by its center and details entries. */

import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { IssuePriority, IssueStatus } from '@deepseek-ai/dsh-taskboard/types'

/** Views shipped by the Taskboard center surface before the Gantt extension. */
export type TaskboardMode = 'dashboard' | 'board' | 'list'
/** Status filter including the unfiltered choice. */
export type TaskboardStatusFilter = IssueStatus | 'all'
/** Priority filter including the unfiltered choice. */
export type TaskboardPriorityFilter = IssuePriority | 'all'

/** Persisted Taskboard viewing and filter state. */
export interface TaskboardViewState {
  mode: TaskboardMode
  query: string
  status: TaskboardStatusFilter
  priority: TaskboardPriorityFilter
  label: string
}

type TaskboardViewActions = {
  setMode: (draft: TaskboardViewState, mode: TaskboardMode) => void
  setQuery: (draft: TaskboardViewState, query: string) => void
  setStatus: (draft: TaskboardViewState, status: TaskboardStatusFilter) => void
  setPriority: (draft: TaskboardViewState, priority: TaskboardPriorityFilter) => void
  setLabel: (draft: TaskboardViewState, label: string) => void
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
      label: '',
    }),
    persist: 'dsh.taskboard.view.v1',
    actions: {
      setMode: (draft, mode) => { draft.mode = mode },
      setQuery: (draft, query) => { draft.query = query },
      setStatus: (draft, status) => { draft.status = status },
      setPriority: (draft, priority) => { draft.priority = priority },
      setLabel: (draft, label) => { draft.label = label },
      resetFilters: (draft) => {
        draft.query = ''
        draft.status = 'all'
        draft.priority = 'all'
        draft.label = ''
      },
    },
  })
}
