// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Issue, IssueRelation } from '@deepseek-ai/dsh-taskboard/types'

const events = new Map<string, (...args: never[]) => unknown>()
const instance = {
  config: {} as Record<string, unknown>,
  templates: {} as Record<string, unknown>,
  ext: { zoom: { init: vi.fn(), setLevel: vi.fn() } },
  attachEvent: vi.fn((name: string, handler: (...args: never[]) => unknown) => {
    events.set(name, handler)
    return name
  }),
  init: vi.fn(),
  clearAll: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
  showDate: vi.fn(),
  destructor: vi.fn(),
}

vi.mock('dhtmlx-gantt', () => ({
  Gantt: { getGanttInstance: () => instance },
}))

import { GanttView } from '../src/client/GanttView.tsx'
import { localDate } from '../src/client/gantt-model.ts'

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1' as never,
    identifier: 'DSH-1' as never,
    workspaceId: 'workspace-1' as never,
    title: 'Schedule work',
    description: '',
    status: 'todo',
    priority: 'high',
    labels: [],
    assignee: 'unassigned',
    startDate: '2026-08-15',
    dueDate: '2026-08-17',
    sortOrder: 1000,
    version: 1,
    archivedAt: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  events.clear()
  vi.clearAllMocks()
})

describe('Taskboard Gantt view', () => {
  it('owns the structural chart stylesheet through the plugin loader inventory', () => {
    const tag = document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-client-ui-taskboard/dhtmlxgantt.css"]')

    expect(tag?.getAttribute('data-plugin')).toBe('@deepseek-ai/dsh-client-ui-taskboard')
  })

  it('owns one chart lifecycle and parses scheduled, unscheduled, and dependency data', () => {
    const scheduled = issue()
    const unscheduled = issue({ id: 'issue-2' as never, identifier: 'DSH-2' as never, startDate: null, dueDate: null })
    const relation: IssueRelation = {
      id: 'relation-1' as never,
      type: 'blocks',
      issueId: scheduled.id,
      relatedIssueId: unscheduled.id,
      createdAt: '2026-08-15T00:00:00.000Z',
    }
    const rendered = render(
      <GanttView
        issues={[scheduled, unscheduled]}
        relations={[relation]}
        zoom="week"
        openIssue={vi.fn()}
        updateIssue={vi.fn()}
        t={key => key}
      />,
    )

    expect(instance.init).toHaveBeenCalledOnce()
    expect(instance.parse).toHaveBeenCalledWith(expect.objectContaining({
      tasks: [
        expect.objectContaining({ id: 'issue-1' }),
        expect.objectContaining({ id: 'issue-2', unscheduled: true }),
      ],
      links: [],
    }))
    expect(instance.ext.zoom.setLevel).toHaveBeenCalledWith('week')
    expect(screen.getByLabelText('gantt.aria')).toBeInstanceOf(HTMLElement)

    rendered.unmount()
    expect(instance.destructor).toHaveBeenCalledOnce()
  })

  it('updates only the dragged Issue dates and opens its ordinary details panel', async () => {
    const target = issue()
    const updateIssue = vi.fn(() => Promise.resolve({ ok: true as const }))
    const openIssue = vi.fn()
    render(
      <GanttView
        issues={[target]}
        relations={[]}
        zoom="day"
        openIssue={openIssue}
        updateIssue={updateIssue}
        t={key => key}
      />,
    )

    events.get('onAfterTaskUpdate')?.('issue-1' as never, {
      start_date: localDate('2026-08-16'),
      end_date: localDate('2026-08-20'),
      unscheduled: false,
    } as never)
    expect(updateIssue).toHaveBeenCalledWith(target, { startDate: '2026-08-16', dueDate: '2026-08-19' })

    events.get('onTaskDblClick')?.('issue-1' as never)
    expect(openIssue).toHaveBeenCalledWith(target.id)
  })

  it('contains chart initialization failures inside a visible Taskboard state', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    instance.init.mockImplementationOnce(() => { throw new Error('chart failed') })
    render(
      <GanttView
        issues={[issue()]}
        relations={[]}
        zoom="week"
        openIssue={vi.fn()}
        updateIssue={vi.fn()}
        t={key => key}
      />,
    )

    expect((await screen.findByRole('alert')).textContent).toBe('gantt.error: chart failed')
    expect(log).toHaveBeenCalledWith('[ui-taskboard] Gantt initialization failed:', expect.any(Error))
    log.mockRestore()
  })
})
