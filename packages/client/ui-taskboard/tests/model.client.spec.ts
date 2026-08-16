import { describe, expect, it } from 'vitest'
import type { Issue } from '@deepseek-ai/dsh-taskboard/types'
import { filterIssues, priorityLabel, scheduleBucket, statusLabel } from '../src/client/model.ts'

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1' as never,
    identifier: 'DSH-1' as never,
    workspaceId: 'ws' as never,
    title: 'Build Taskboard',
    description: 'Workspace issue experience',
    status: 'todo',
    priority: 'high',
    labels: ['Frontend'],
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

describe('Taskboard presentation model', () => {
  it('delegates status and priority labels to the Taskboard dictionary', () => {
    const t = (key: string): string => `translated:${key}`
    expect(statusLabel(t as never, 'in_progress')).toBe('translated:status.in_progress')
    expect(priorityLabel(t as never, 'urgent')).toBe('translated:priority.urgent')
  })

  it('combines exact status, priority, and case-insensitive label filters', () => {
    const issues = [
      issue(),
      issue({ id: 'issue-2' as never, status: 'done', priority: 'low', labels: ['Backend'] }),
    ]
    expect(filterIssues(issues, {
      query: '', status: 'todo', priority: 'high', label: ' frontend ',
    })).toEqual([issues[0]])
    expect(filterIssues(issues, {
      query: '', status: 'done', priority: 'high', label: '',
    })).toEqual([])
    expect(filterIssues(issues, {
      query: '', status: 'all', priority: 'low', label: 'frontend',
    })).toEqual([])
  })

  it('searches identifier, title, and description after trimming and case folding', () => {
    const target = issue()
    const filters = { status: 'all' as const, priority: 'all' as const, label: '' }
    expect(filterIssues([target], { ...filters, query: ' dsh-1 ' })).toEqual([target])
    expect(filterIssues([target], { ...filters, query: 'taskBOARD' })).toEqual([target])
    expect(filterIssues([target], { ...filters, query: 'ISSUE EXPERIENCE' })).toEqual([target])
    expect(filterIssues([target], { ...filters, query: 'missing' })).toEqual([])
  })

  it('classifies overdue and fourteen-day upcoming work without terminal Issues', () => {
    expect(scheduleBucket(issue({ dueDate: '2026-08-15' }), '2026-08-16')).toBe('overdue')
    expect(scheduleBucket(issue({ dueDate: '2026-08-30' }), '2026-08-16')).toBe('upcoming')
    expect(scheduleBucket(issue({ dueDate: '2026-08-31' }), '2026-08-16')).toBeNull()
    expect(scheduleBucket(issue({ dueDate: '2026-08-20', status: 'done' }), '2026-08-16')).toBeNull()
  })
})
