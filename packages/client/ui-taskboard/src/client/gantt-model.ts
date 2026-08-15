/** Pure conversion between durable Taskboard dates/relations and DHTMLX Gantt data. */

import type { Issue, IssueRelation, IssueStatus, UpdateIssueInput } from '@deepseek-ai/dsh-taskboard/types'

/** One Gantt task row with Taskboard presentation metadata. */
export interface TaskboardGanttTask {
  readonly id: string
  readonly text: string
  readonly start_date?: Date
  readonly end_date?: Date
  readonly unscheduled?: true
  readonly taskboardIdentifier: string
  readonly taskboardStatus: IssueStatus
}

/** Finish-to-start dependency rendered by DHTMLX Gantt. */
export interface TaskboardGanttLink {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly type: '0'
}

/** Complete DHTMLX data payload for the current filtered Issues. */
export interface TaskboardGanttData {
  readonly tasks: TaskboardGanttTask[]
  readonly links: TaskboardGanttLink[]
}

/**
 * Parse a YYYY-MM-DD value at local midnight.
 * @param value - Durable Taskboard calendar date.
 * @returns local Date at the start of that calendar day.
 */
export function localDate(value: string): Date {
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  return new Date(year, month - 1, day)
}

/**
 * Format a Date as a local YYYY-MM-DD value.
 * @param value - Local calendar time to format.
 * @returns day-granularity Taskboard date.
 */
export function localDateValue(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Return a new local Date offset by whole calendar days.
 * @param value - Local calendar time to copy.
 * @param days - Signed number of calendar days to add.
 * @returns copied and offset Date.
 */
export function addLocalDays(value: Date, days: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Convert active Issues and canonical `blocks` relations into Gantt rows and links.
 * @param issues - Filtered Issues shown in the grid.
 * @param relations - Workspace dependency records in canonical direction.
 * @returns rows for every Issue and links whose two endpoints are scheduled.
 */
export function buildGanttData(
  issues: readonly Issue[],
  relations: readonly IssueRelation[],
): TaskboardGanttData {
  const scheduled = new Set<string>()
  const tasks = issues.map((issue): TaskboardGanttTask => {
    const common = {
      id: issue.id,
      text: issue.title,
      taskboardIdentifier: issue.identifier,
      taskboardStatus: issue.status,
    }
    if (issue.startDate === null || issue.dueDate === null) return { ...common, unscheduled: true }
    scheduled.add(issue.id)
    return {
      ...common,
      start_date: localDate(issue.startDate),
      end_date: addLocalDays(localDate(issue.dueDate), 1),
    }
  })
  const links = relations.flatMap((relation): TaskboardGanttLink[] => (
    relation.type === 'blocks'
    && scheduled.has(relation.issueId)
    && scheduled.has(relation.relatedIssueId)
      ? [{
        id: relation.id,
        source: relation.issueId,
        target: relation.relatedIssueId,
        type: '0',
      }]
      : []
  ))
  return { tasks, links }
}

/**
 * Convert a dragged bar's exclusive end back to an inclusive Taskboard due date.
 * @param issue - Durable Issue before the drag.
 * @param start - New local start instant.
 * @param exclusiveEnd - New DHTMLX-exclusive local end instant.
 * @returns changed Taskboard dates, or null when the durable dates are unchanged.
 */
export function ganttDatePatch(
  issue: Issue,
  start: Date,
  exclusiveEnd: Date,
): Pick<UpdateIssueInput, 'startDate' | 'dueDate'> | null {
  const startDate = localDateValue(start)
  const dueDate = localDateValue(addLocalDays(exclusiveEnd, -1))
  return issue.startDate === startDate && issue.dueDate === dueDate ? null : { startDate, dueDate }
}
