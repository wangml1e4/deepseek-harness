// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { Issue, TaskboardActor, WorkspaceTaskboard } from '@deepseek-ai/dsh-taskboard/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import { TaskboardSurface, type TaskboardSurfaceProps } from '../src/client/TaskboardSurface.tsx'
import { TaskboardDetails, type TaskboardDetailsProps } from '../src/client/TaskboardDetails.tsx'
import { TaskboardSidebarAction, type TaskboardSidebarActionProps } from '../src/client/TaskboardSidebarAction.tsx'
import type { TaskboardSnapshot } from '../src/client/controller.ts'
import { zh } from '../src/client/locales.ts'
import { createTaskboardViewStore } from '../src/client/store.ts'

vi.mock('dhtmlx-gantt', () => ({
  Gantt: {
    getGanttInstance: () => ({
      config: {}, templates: {},
      ext: { zoom: { init: vi.fn(), setLevel: vi.fn() } },
      attachEvent: vi.fn(), init: vi.fn(), clearAll: vi.fn(), parse: vi.fn(), render: vi.fn(), destructor: vi.fn(),
    }),
  },
}))

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const t = makeTranslate(zh, commonZh)
const actor = { type: 'user', id: 'local-user', name: 'User' } as TaskboardActor

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1' as never,
    identifier: 'DSH-1' as never,
    workspaceId: 'ws' as never,
    title: 'Build Taskboard UI',
    description: 'Workspace issue experience',
    status: 'todo',
    priority: 'high',
    labels: ['frontend'],
    assignee: 'unassigned',
    startDate: '2026-08-15',
    dueDate: '2026-08-20',
    sortOrder: 1000,
    version: 1,
    archivedAt: null,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    ...overrides,
  }
}

const workspace: WorkspaceTaskboard = {
  workspaceId: 'ws' as never,
  title: 'DeepSeek Harness',
  prefix: 'DSH',
  version: 1,
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
}

function snapshot(overrides: Partial<TaskboardSnapshot> = {}): TaskboardSnapshot {
  return {
    phase: 'ready',
    workspaceId: 'ws' as never,
    workspace,
    issues: [
      issue(),
      issue({ id: 'issue-2' as never, identifier: 'DSH-2' as never, title: 'Write tests', status: 'done', priority: 'medium' }),
    ],
    selectedIssue: null,
    detailPhase: 'idle',
    comments: [],
    activities: [],
    workspaceRelations: [],
    relations: [],
    error: null,
    detailError: null,
    actionError: null,
    ...overrides,
  }
}

function staticHook<T>(value: T) {
  return function useValue<S>(selector: (snapshot: T) => S): S { return selector(value) }
}

function storeHook<T extends { getSnapshot: () => unknown; subscribe: (listener: () => void) => () => void }>(source: T) {
  return function useStore<S>(selector: (value: ReturnType<T['getSnapshot']>) => S): S {
    const value = useSyncExternalStore(source.subscribe, source.getSnapshot) as ReturnType<T['getSnapshot']>
    return selector(value)
  }
}

function mountSurface(current = snapshot()) {
  const store = createTaskboardViewStore().create()
  const props = {
    matched: 'ws' as WorkspaceId,
    useSessions: staticHook({}),
    useWorkspaces: staticHook({}),
    useStore: storeHook(store),
    actions: store.actions,
    useTaskboard: staticHook(current),
    activate: vi.fn(async () => ({ ok: true as const })),
    refresh: vi.fn(async () => ({ ok: true as const })),
    createIssue: vi.fn(async () => ({ ok: true as const })),
    openIssue: vi.fn(),
    moveIssue: vi.fn(async () => ({ ok: true as const })),
    updateIssue: vi.fn(async () => ({ ok: true as const })),
    t,
  } as unknown as TaskboardSurfaceProps
  return { ...render(<TaskboardSurface {...props} />), props, store }
}

describe('TaskboardSurface', () => {
  it('activates the matched Workspace and switches among real dashboard, board, and list views', async () => {
    const view = mountSurface()
    await waitFor(() => { expect(view.props.activate).toHaveBeenCalledWith('ws') })
    expect(screen.getByText('完成率')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '看板' }))
    expect(screen.getByRole('heading', { name: '待办' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '已完成' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /DSH-1/ }))
    expect(view.props.openIssue).toHaveBeenCalledWith('issue-1')

    fireEvent.click(screen.getByRole('tab', { name: '列表' }))
    expect(screen.getByRole('table', { name: 'Issue 列表' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '甘特图' }))
    expect(screen.getByLabelText('Issue 甘特图')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('甘特图时间刻度'), { target: { value: 'month' } })
    expect(view.store.getSnapshot().ganttZoom).toBe('month')
  })

  it('filters Issues and creates a new Issue without inventing placeholder data', async () => {
    const view = mountSurface()
    fireEvent.click(screen.getByRole('tab', { name: '看板' }))
    fireEvent.change(screen.getByPlaceholderText('搜索 Issue…'), { target: { value: 'tests' } })
    expect(screen.queryByText('Build Taskboard UI')).toBeNull()
    expect(screen.getByText('Write tests')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '新建 Issue' }))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Add Gantt' } })
    fireEvent.click(screen.getByRole('button', { name: '创建 Issue' }))
    await waitFor(() => {
      expect(view.props.createIssue).toHaveBeenCalledWith({
        title: 'Add Gantt', status: 'backlog', priority: 'none',
      })
    })
  })

  it('moves a dragged card to the dropped lifecycle column', async () => {
    const view = mountSurface()
    fireEvent.click(screen.getByRole('tab', { name: '看板' }))
    const transfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    fireEvent.dragStart(screen.getByRole('button', { name: /DSH-1/ }), { dataTransfer: transfer })
    const destination = screen.getByRole('heading', { name: '进行中' }).closest('section')
    if (destination === null) throw new Error('in-progress column missing')
    fireEvent.drop(destination, { dataTransfer: transfer })

    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'issue-1')
    expect(view.props.moveIssue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'issue-1' }),
      { status: 'in_progress', sortOrder: 1000 },
    )
  })
})

describe('TaskboardSidebarAction', () => {
  it('opens the implicit Taskboard without toggling the Workspace row', () => {
    const openTaskboard = vi.fn()
    const props = {
      workspaceId: 'ws',
      title: 'DeepSeek Harness',
      useSessions: staticHook({}),
      useWorkspaces: staticHook({}),
      openTaskboard,
      t,
    } as unknown as TaskboardSidebarActionProps
    render(<TaskboardSidebarAction {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '打开“DeepSeek Harness”的 Taskboard' }))
    expect(openTaskboard).toHaveBeenCalledWith('ws')
  })
})

function mountDetails(current: TaskboardSnapshot) {
  const props = {
    matched: 'ws' as WorkspaceId,
    useSessions: staticHook({}),
    useWorkspaces: staticHook({}),
    useTaskboard: staticHook(current),
    updateIssue: vi.fn(async () => ({ ok: true as const })),
    archiveIssue: vi.fn(async () => ({ ok: true as const })),
    addComment: vi.fn(async () => ({ ok: true as const })),
    addRelation: vi.fn(async () => ({ ok: true as const })),
    removeRelation: vi.fn(async () => ({ ok: true as const })),
    close: vi.fn(),
    t,
  } as unknown as TaskboardDetailsProps
  return { ...render(<TaskboardDetails {...props} />), props }
}

describe('TaskboardDetails', () => {
  it('edits versioned fields, adds comments, and exposes archive without permanent deletion', async () => {
    const selected = issue()
    const view = mountDetails(snapshot({
      selectedIssue: selected,
      detailPhase: 'ready',
      comments: [{
        id: 'comment-1' as never,
        issueId: selected.id,
        body: 'Review this carefully',
        actor,
        createdAt: '2026-08-16T00:00:00.000Z',
      }],
    }))

    fireEvent.change(screen.getByLabelText('标题'), { target: { value: 'Updated Taskboard UI' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => {
      expect(view.props.updateIssue).toHaveBeenCalledWith(selected, expect.objectContaining({ title: 'Updated Taskboard UI' }))
    })

    expect(screen.getByText('Review this carefully')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('添加评论…'), { target: { value: 'Ready for review' } })
    fireEvent.click(screen.getByRole('button', { name: '发表评论' }))
    await waitFor(() => { expect(view.props.addComment).toHaveBeenCalledWith('Ready for review') })

    expect(screen.queryByText('永久删除')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '归档 Issue' }))
    await waitFor(() => { expect(view.props.archiveIssue).toHaveBeenCalledWith(selected) })
  })
})
