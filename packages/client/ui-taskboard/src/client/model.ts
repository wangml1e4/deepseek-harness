/** Pure Taskboard presentation models shared by its center views and details panel. */

import type { Issue, IssuePriority, IssueStatus } from '@deepseek-ai/dsh-taskboard/types'
import type { TaskboardKey } from './locales.ts'
import type {
  TaskboardPriorityFilter,
  TaskboardScheduleFilter,
  TaskboardStatusFilter,
} from './store.ts'
import { addLocalDays, localDate, localDateValue } from './gantt-model.ts'

/** Canonical Taskboard lifecycle order. */
export const ISSUE_STATUSES: readonly IssueStatus[] = [
  'backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'canceled',
]
/** Canonical priority picker order. */
export const ISSUE_PRIORITIES: readonly IssuePriority[] = ['none', 'urgent', 'high', 'medium', 'low']
/** Calendar window shown as upcoming work on the Dashboard. */
export const UPCOMING_DAYS = 14

/** Translation function used by Taskboard presentation helpers. */
export type TaskboardTranslate = (key: TaskboardKey, params?: Record<string, string | number>) => string

/**
 * Return the localized lifecycle label.
 * @param t - Taskboard translation function.
 * @param status - lifecycle value to present.
 * @returns localized label.
 */
export function statusLabel(t: TaskboardTranslate, status: IssueStatus): string {
  return t(`status.${status}`)
}

/**
 * Return the localized priority label.
 * @param t - Taskboard translation function.
 * @param priority - priority value to present.
 * @returns localized label.
 */
export function priorityLabel(t: TaskboardTranslate, priority: IssuePriority): string {
  return t(`priority.${priority}`)
}

/**
 * Classify one active Issue into the Dashboard due-date summaries.
 * @param issue - Issue to classify.
 * @param today - local calendar date in YYYY-MM-DD form.
 * @returns overdue, upcoming within fourteen days, or `null`.
 */
export function scheduleBucket(issue: Issue, today: string): Exclude<TaskboardScheduleFilter, 'all'> | null {
  if (issue.dueDate === null || issue.status === 'done' || issue.status === 'canceled') return null
  if (issue.dueDate < today) return 'overdue'
  const upcomingEnd = localDateValue(addLocalDays(localDate(today), UPCOMING_DAYS))
  return issue.dueDate <= upcomingEnd ? 'upcoming' : null
}

/**
 * Apply the persisted center-surface filters.
 * @param issues - active Workspace Issues.
 * @param filters - persisted query and exact-match filters.
 * @returns Issues that satisfy every active filter.
 */
export function filterIssues(issues: readonly Issue[], filters: {
  query: string
  status: TaskboardStatusFilter
  priority: TaskboardPriorityFilter
  schedule?: TaskboardScheduleFilter
  label: string
}): readonly Issue[] {
  const query = filters.query.trim().toLocaleLowerCase()
  const label = filters.label.trim().toLocaleLowerCase()
  const today = filters.schedule === undefined || filters.schedule === 'all' ? null : localDateValue(new Date())
  return issues.filter((issue) => {
    if (filters.status === 'active') {
      if (issue.status !== 'in_progress' && issue.status !== 'in_review') return false
    } else if (filters.status !== 'all' && issue.status !== filters.status) return false
    if (filters.priority !== 'all' && issue.priority !== filters.priority) return false
    if (filters.schedule !== undefined && filters.schedule !== 'all' && today !== null) {
      if (scheduleBucket(issue, today) !== filters.schedule) return false
    }
    if (label !== '' && !issue.labels.some(value => value.toLocaleLowerCase() === label)) return false
    if (query === '') return true
    return `${issue.identifier}\n${issue.title}\n${issue.description}`.toLocaleLowerCase().includes(query)
  })
}
