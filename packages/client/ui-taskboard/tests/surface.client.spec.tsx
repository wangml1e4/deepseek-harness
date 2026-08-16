// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { Activity, Issue, TaskboardActor, TaskboardAttachment, WorkspaceTaskboard } from '@deepseek-ai/dsh-taskboard/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { TaskboardPatrolValue } from '@deepseek-ai/dsh-taskboard-remote/types'
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

afterEach(() => { cleanup(); vi.useRealTimers() })
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

function patrol(): TaskboardPatrolValue {
  return {
    policy: {
      workspaceId: 'ws' as never,
      enabled: false,
      interval: '1h',
      baseBranch: null,
      agentPreset: null,
      provider: null,
      model: null,
      reasoningEffort: null,
      permissionPreset: 'workspace-write',
      nextDueAt: null,
      version: 1,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    },
    defaults: {
      baseBranch: 'main', agentPreset: 'coding', provider: 'deepseek', model: 'deepseek-chat',
      reasoningEffort: null, permissionPreset: 'workspace-write',
    },
    branches: ['main', 'release'],
    agentPresets: [{ id: 'coding', name: 'Coding' }],
    providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{
      id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: [{ id: 'high', name: 'High' }],
    }] }],
    permissionPresets: [
      { id: 'workspace-write', name: 'Workspace Write' },
      { id: 'danger-full-access', name: 'Full Access' },
    ],
    runs: [{
      run: {
        id: 'run-recovered' as never,
        workspaceId: 'ws' as never,
        trigger: 'scheduled',
        scheduledFor: '2026-08-16T00:00:00.000Z',
        state: 'completed',
        result: 'review_handoff',
        error: null,
        tokenUsage: {
          inputTokens: 120,
          outputTokens: 24,
          cacheReadTokens: 80,
          reasoningTokens: 6,
        },
        providerError: {
          message: 'Provider rate limit was observed',
          code: 'RATE_LIMIT',
          status: 429,
          providerRetryAfterMs: 1_500,
          requestId: 'request-taskboard-ui' as never,
        },
        recoveryCount: 1,
        lastRecoveredAt: '2026-08-16T00:05:00.000Z',
        startedAt: '2026-08-16T00:00:00.000Z',
        endedAt: '2026-08-16T00:10:00.000Z',
      },
      attempts: [],
    }],
  }
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
    detailPanel: null,
    detailPhase: 'idle',
    comments: [],
    attachments: [],
    activities: [],
    workspaceActivities: [],
    workspaceRelations: [],
    relations: [],
    patrol: null,
    patrolIssue: null,
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
    openPatrol: vi.fn(),
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

    fireEvent.click(screen.getByRole('button', { name: '打开巡检设置' }))
    expect(view.props.openPatrol).toHaveBeenCalledOnce()
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

  it('links Dashboard summaries to filtered work and shows upcoming and recent Activity', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-16T12:00:00.000Z')
    const upcomingIssues = Array.from({ length: 6 }, (_, index) => issue({
      id: `issue-upcoming-${String(index)}` as never,
      identifier: `DSH-${String(index + 11)}` as never,
      title: `Upcoming review ${String(index + 1)}`,
      dueDate: `2026-08-${String(index + 20).padStart(2, '0')}`,
    }))
    const workspaceActivities: readonly Activity[] = [{
      id: 'activity-1' as never,
      issueId: upcomingIssues[0]!.id,
      actor,
      changes: [{ field: 'priority', before: 'medium', after: 'high' }],
      createdAt: '2026-08-16T11:00:00.000Z',
    }]
    const view = mountSurface(snapshot({
      issues: [
        issue({ id: 'issue-overdue' as never, identifier: 'DSH-10' as never, title: 'Overdue migration', dueDate: '2026-08-15' }),
        ...upcomingIssues,
        issue({ id: 'issue-later' as never, identifier: 'DSH-20' as never, title: 'Later release', dueDate: '2026-09-10' }),
        issue({ id: 'issue-done' as never, identifier: 'DSH-21' as never, title: 'Done setup', status: 'done', dueDate: '2026-08-18' }),
      ],
      workspaceActivities,
    }))

    expect(screen.getByRole('heading', { name: '即将到期' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '即将到期 6' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /DSH-11 Upcoming review 1/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /DSH-16 Upcoming review 6/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /DSH-20 Later release/ })).toBeNull()
    expect(screen.getByRole('heading', { name: '最近活动' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /DSH-11.*User.*优先级/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '已逾期 1' }))
    expect(view.store.getSnapshot()).toMatchObject({ mode: 'list', schedule: 'overdue' })
    expect(screen.getByRole('button', { name: /DSH-10/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /DSH-11/ })).toBeNull()
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
  it('loads the todo count and opens the implicit Taskboard without toggling the Workspace row', async () => {
    const openTaskboard = vi.fn()
    const loadTodoCount = vi.fn()
    const props = {
      workspaceId: 'ws',
      title: 'DeepSeek Harness',
      useSessions: staticHook({}),
      useWorkspaces: staticHook({}),
      useTaskboardTodoCounts: staticHook({ ws: 3 }),
      loadTodoCount,
      openTaskboard,
      t,
    } as unknown as TaskboardSidebarActionProps
    render(<TaskboardSidebarAction {...props} />)
    await waitFor(() => { expect(loadTodoCount).toHaveBeenCalledWith('ws') })
    fireEvent.click(screen.getByRole('button', { name: '打开“DeepSeek Harness”的 Taskboard，3 个 todo Issue' }))
    expect(screen.getByText('3')).toBeTruthy()
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
    addAttachment: vi.fn(async () => ({ ok: true as const })),
    readAttachment: vi.fn(async (attachment: TaskboardAttachment) => ({ ok: true as const, value: { attachment, data: 'iVBORw==' } })),
    deleteAttachment: vi.fn(async () => ({ ok: true as const })),
    addRelation: vi.fn(async () => ({ ok: true as const })),
    removeRelation: vi.fn(async () => ({ ok: true as const })),
    updatePatrol: vi.fn(async () => ({ ok: true as const })),
    runPatrol: vi.fn(async () => ({ ok: true as const })),
    removePatrolWorktree: vi.fn(async () => ({ ok: true as const })),
    openSession: vi.fn(),
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

  it('uploads unrestricted files, previews images, downloads through Host reads, and confirms deletion', async () => {
    const selected = issue()
    const image = {
      id: 'attachment-image' as never,
      issueId: selected.id,
      name: 'diagram.png',
      mediaType: 'image/png',
      size: 6,
      actor,
      createdAt: '2026-08-16T00:00:00.000Z',
    }
    const fileAttachment = { ...image, id: 'attachment-document' as never, name: 'notes.pdf', mediaType: 'application/pdf' }
    const view = mountDetails(snapshot({
      selectedIssue: selected,
      detailPanel: 'issue',
      detailPhase: 'ready',
      attachments: [image, fileAttachment],
    }))

    expect(screen.getByText('diagram.png')).toBeTruthy()
    expect(screen.getByText('notes.pdf')).toBeTruthy()
    const file = new File([Uint8Array.of(1, 2)], 'evidence.bin', { type: '' })
    fireEvent.change(screen.getByLabelText('添加附件'), { target: { files: [file] } })
    await waitFor(() => { expect(view.props.addAttachment).toHaveBeenCalledWith(file) })

    fireEvent.click(screen.getByRole('button', { name: '预览 diagram.png' }))
    await waitFor(() => { expect(screen.getByRole('img', { name: 'diagram.png' })).toBeTruthy() })
    expect(view.props.readAttachment).toHaveBeenCalledWith(image)

    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: '下载 notes.pdf' }))
    await waitFor(() => { expect(view.props.readAttachment).toHaveBeenCalledWith(fileAttachment) })
    expect(download).toHaveBeenCalledOnce()
    download.mockRestore()

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: '删除 diagram.png' }))
    expect(view.props.deleteAttachment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '删除 diagram.png' }))
    expect(view.props.deleteAttachment).toHaveBeenCalledWith(image, true)
    confirm.mockRestore()
  })

  it('configures the disabled-by-default Patrol and can trigger one Run', async () => {
    const view = mountDetails(snapshot({ detailPanel: 'patrol', patrol: patrol() }))
    expect(screen.getByText(/已恢复 1 次/)).toBeTruthy()
    expect(screen.getByText(/输入 120/)).toBeTruthy()
    expect(screen.getByText(/输出 24/)).toBeTruthy()
    expect(screen.getByText(/缓存读取 80/)).toBeTruthy()
    expect(screen.getByText(/推理 6/)).toBeTruthy()
    expect(screen.getByText(/RATE_LIMIT/)).toBeTruthy()
    expect(screen.getByText(/重试等待 1500 毫秒/)).toBeTruthy()
    expect(screen.getByText(/request-taskboard-ui/)).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: '开启或关闭自动巡检' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(view.props.updatePatrol).toHaveBeenCalledWith(expect.objectContaining({
        enabled: true,
        interval: '1h',
        baseBranch: 'main',
        permissionPreset: 'workspace-write',
      }))
    })

    fireEvent.change(screen.getByLabelText('固定间隔'), { target: { value: '30m' } })
    fireEvent.change(screen.getByLabelText('权限预设'), { target: { value: 'danger-full-access' } })
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    await waitFor(() => {
      expect(view.props.updatePatrol).toHaveBeenLastCalledWith(expect.objectContaining({
        interval: '30m', permissionPreset: 'danger-full-access',
      }))
    })

    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))
    expect(view.props.runPatrol).toHaveBeenCalledWith()
  })

  it('distinguishes unfinished dependencies from done code awaiting Base Branch integration', () => {
    const selected = issue()
    const incomplete = issue({
      id: 'issue-incomplete' as never,
      identifier: 'DSH-2' as never,
      status: 'in_review',
    })
    const unintegrated = issue({
      id: 'issue-unintegrated' as never,
      identifier: 'DSH-3' as never,
      status: 'done',
    })
    mountDetails(snapshot({
      selectedIssue: selected,
      detailPanel: 'issue',
      detailPhase: 'ready',
      issues: [selected, incomplete, unintegrated],
      relations: [incomplete, unintegrated].map((related, index) => ({
        id: `relation-${String(index)}` as never,
        type: 'blocked_by',
        issueId: selected.id,
        relatedIssueId: related.id,
        createdAt: '2026-08-16T00:00:00.000Z',
      })),
      patrolIssue: {
        context: null,
        worktreePresent: false,
        diff: null,
        reviews: [],
        dependencyWaits: [
          { issueId: incomplete.id, reason: 'predecessor_not_done' },
          { issueId: unintegrated.id, reason: 'waiting_for_integration' },
        ],
      },
    }))

    expect(screen.getByText('等待前置 Issue 完成')).toBeTruthy()
    expect(screen.getByText('等待代码集成')).toBeTruthy()
  })

  it('shows persistent Agent and Reviewer evidence before the human marks done', async () => {
    const selected = issue({ status: 'in_review' })
    const view = mountDetails(snapshot({
      selectedIssue: selected,
      detailPanel: 'issue',
      detailPhase: 'ready',
      patrolIssue: {
        context: {
          issueId: selected.id,
          sessionId: 'session-implementation' as never,
          sessionStartedAt: '2026-08-16T00:00:00.000Z',
          baseBranch: 'main',
          branch: 'dsh-task/dsh-1',
          worktreePath: '/worktrees/dsh-1',
          agentPreset: 'coding',
          provider: 'deepseek',
          model: 'deepseek-chat',
          reasoningEffort: null,
          permissionPreset: 'workspace-write',
          resultCommit: 'abc123',
          createdAt: '2026-08-16T00:00:00.000Z',
          updatedAt: '2026-08-16T00:00:00.000Z',
        },
        worktreePresent: true,
        dependencyWaits: [],
        diff: {
          stat: ' src/index.ts | 1 +',
          patch: 'diff --git a/src/index.ts b/src/index.ts\n+export const ready = true',
        },
        reviews: [{
          attemptId: 'attempt-1' as never,
          issueId: selected.id,
          sessionId: 'session-reviewer' as never,
          reviewedCommit: 'preliminary123',
          verdict: 'changes_requested',
          findings: 'Add the missing regression test.',
          verification: ['Inspected diff'],
          risks: ['Platform matrix remains in CI'],
          createdAt: '2026-08-16T00:01:00.000Z',
        }],
      },
    }))

    fireEvent.click(screen.getByRole('button', { name: '打开 Session session-implementation' }))
    expect(view.props.openSession).toHaveBeenCalledWith('session-implementation')
    expect(screen.getByText(/src\/index\.ts \| 1 \+/)).toBeTruthy()
    expect(screen.getByText(/export const ready = true/)).toBeTruthy()
    expect(screen.getByText('Add the missing regression test.')).toBeTruthy()
    expect(screen.getByText(/Inspected diff/)).toBeTruthy()
    expect(screen.getByText('/worktrees/dsh-1')).toBeTruthy()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: '移除 worktree' }))
    expect(view.props.removePatrolWorktree).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '移除 worktree' }))
    expect(view.props.removePatrolWorktree).toHaveBeenCalledWith(true)
    confirm.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: '标记 done' }))
    expect(view.props.updateIssue).toHaveBeenCalledWith(selected, { status: 'done' })
    fireEvent.change(screen.getByPlaceholderText('退回 Agent 的具体修改意见'), { target: { value: 'Please cover Windows.' } })
    fireEvent.click(screen.getByRole('button', { name: '退回 todo' }))
    expect(view.props.updateIssue).toHaveBeenCalledWith(selected, { status: 'todo', reason: 'Please cover Windows.' })
  })
})
