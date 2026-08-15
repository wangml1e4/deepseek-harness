import { describe, expect, it } from 'vitest'
import type { Issue, IssueRelation } from '@deepseek-ai/dsh-taskboard/types'
import { buildGanttData, ganttDatePatch, localDate, localDateValue } from '../src/client/gantt-model.ts'

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1' as never,
    identifier: 'DSH-1' as never,
    workspaceId: 'workspace-1' as never,
    title: 'Build Taskboard',
    description: '',
    status: 'todo',
    priority: 'high',
    labels: [],
    assignee: 'unassigned',
    startDate: null,
    dueDate: null,
    sortOrder: 1000,
    version: 1,
    archivedAt: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  }
}

function relation(overrides: Partial<IssueRelation> = {}): IssueRelation {
  return {
    id: 'relation-1' as never,
    type: 'blocks',
    issueId: 'issue-1' as never,
    relatedIssueId: 'issue-2' as never,
    createdAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  }
}

describe('Taskboard Gantt model', () => {
  it('uses local calendar dates and an exclusive chart end for the inclusive due date', () => {
    const start = localDate('2026-08-15')
    expect(localDateValue(start)).toBe('2026-08-15')

    const data = buildGanttData([
      issue({ startDate: '2026-08-15', dueDate: '2026-08-17' }),
    ], [])
    expect(localDateValue(data.tasks[0]!.start_date as Date)).toBe('2026-08-15')
    expect(localDateValue(data.tasks[0]!.end_date as Date)).toBe('2026-08-18')
  })

  it('keeps partially and fully unscheduled Issues in the grid without timeline dates', () => {
    const data = buildGanttData([
      issue(),
      issue({ id: 'issue-2' as never, startDate: '2026-08-15' }),
    ], [])
    expect(data.tasks).toEqual([
      expect.objectContaining({ id: 'issue-1', unscheduled: true }),
      expect.objectContaining({ id: 'issue-2', unscheduled: true }),
    ])
    expect(data.tasks.every(task => task.start_date === undefined && task.end_date === undefined)).toBe(true)
  })

  it('draws only blocks links whose two endpoints have scheduled bars', () => {
    const issues = [
      issue({ startDate: '2026-08-15', dueDate: '2026-08-16' }),
      issue({ id: 'issue-2' as never, startDate: '2026-08-17', dueDate: '2026-08-18' }),
      issue({ id: 'issue-3' as never }),
    ]
    const data = buildGanttData(issues, [
      relation(),
      relation({ id: 'relation-2' as never, relatedIssueId: 'issue-3' as never }),
      relation({ id: 'relation-3' as never, type: 'blocked_by' }),
    ])
    expect(data.links).toEqual([{ id: 'relation-1', source: 'issue-1', target: 'issue-2', type: '0' }])
  })

  it('returns a date-only patch for the dragged Issue and skips unchanged bars', () => {
    const target = issue({ startDate: '2026-08-15', dueDate: '2026-08-17' })
    expect(ganttDatePatch(target, localDate('2026-08-16'), localDate('2026-08-20'))).toEqual({
      startDate: '2026-08-16',
      dueDate: '2026-08-19',
    })
    expect(ganttDatePatch(target, localDate('2026-08-15'), localDate('2026-08-18'))).toBeNull()
  })
})
