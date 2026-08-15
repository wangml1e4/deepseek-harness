import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-taskboard/client'
import type { TaskboardInjected, TaskboardSidebarInjected } from '../src/client/index.ts'
import { TaskboardSurface } from '../src/client/TaskboardSurface.tsx'
import { TaskboardDetails } from '../src/client/TaskboardDetails.tsx'
import { TaskboardSidebarAction } from '../src/client/TaskboardSidebarAction.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const layout = {
    openSurface: vi.fn(), openDetails: vi.fn(), closeDetails: vi.fn(),
  }
  const one = {
    id: 'issue-1', identifier: 'WS-1', workspaceId: 'ws', title: 'Issue', description: '',
    status: 'todo', priority: 'none', labels: [], assignee: 'unassigned', startDate: null,
    dueDate: null, sortOrder: 1000, version: 1, archivedAt: null,
    createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
  }
  const ok = <T>(value: T) => Promise.resolve({ ok: true, value: { ok: true, value } })
  let taskboardChanged: ((workspaceId: string) => void) | undefined
  const listIssues = vi.fn(() => ok({ items: [one] }))
  const remote = {
    $on: vi.fn((event: string, listener: (workspaceId: string) => void) => {
      if (event === 'taskboard/changed') taskboardChanged = listener
      return () => {}
    }),
    taskboard: {
      workspace: () => ok({ workspaceId: 'ws', title: 'Workspace', prefix: 'WS', version: 1, createdAt: '', updatedAt: '' }),
      listIssues,
      getIssue: () => ok({ issue: one }),
      listComments: () => ok({ items: [] }),
      listAttachments: () => ok({ items: [] }),
      addAttachment: () => ok({ issue: one, attachment: {} }),
      readAttachment: () => ok({ attachment: {}, data: '' }),
      deleteAttachment: () => ok(one),
      listActivities: () => ok({ items: [] }),
      listWorkspaceRelations: () => ok({ items: [] }),
      listRelations: () => ok({ items: [] }),
      createIssue: () => ok(one),
      updateIssue: () => ok(one),
      archiveIssue: () => ok({ ...one, archivedAt: 'now' }),
      addComment: () => ok({}),
      addRelation: () => ok({ issue: one, relation: {} }),
      removeRelation: () => ok(one),
      patrol: () => ok({
        policy: { workspaceId: 'ws', enabled: false, interval: '1h', baseBranch: null, agentPreset: null, provider: null, model: null, reasoningEffort: null, permissionPreset: 'workspace-write', nextDueAt: null, version: 1, createdAt: '', updatedAt: '' },
        defaults: { baseBranch: 'main', agentPreset: 'coding', provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: null, permissionPreset: 'workspace-write' },
        branches: ['main'], agentPresets: [], providers: [], permissionPresets: [], runs: [],
      }),
      updatePatrol: () => ok({}),
      runPatrol: () => ok({}),
      patrolIssue: () => ok({ context: null, reviews: [] }),
    },
  }
  ctx.provide('layout', layout as never)
  ctx.provide('remote', remote as never)
  ctx.provide('remote.taskboard', remote.taskboard as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'shell.center': { kind: 'chain', scope: 'root' },
      'shell.details': { kind: 'chain', scope: 'root' },
      'sidebar.workspace.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, layout, listIssues, dispatchChanged: (workspaceId: string) => { taskboardChanged?.(workspaceId) } }
}

describe('ui-taskboard apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'locale', 'remote', 'remote.taskboard'])
  })

  it('registers a Workspace action and paired generic shell chain entries', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const sidebar = b.slots.entries('sidebar.workspace.action')[0]!
    const center = b.slots.entries('shell.center')[0]!
    const details = b.slots.entries('shell.details')[0]!
    expect(sidebar.component).toBe(TaskboardSidebarAction)
    expect(center.component).toBe(TaskboardSurface)
    expect(details.component).toBe(TaskboardDetails)
    expect(center.store).toBe(details.store)
    expect(center.select?.({ surface: { id: 'taskboard', context: 'ws' } } as never)).toBe('ws')
    expect(center.select?.({ surface: null } as never)).toBeNull()
    expect(details.select?.({ surface: { id: 'settings', context: 'general' } } as never)).toBeNull()

    const sidebarInjected = (sidebar.inject as unknown as () => TaskboardSidebarInjected)()
    sidebarInjected.openTaskboard('ws' as never)
    expect(b.layout.openSurface).toHaveBeenCalledWith({ id: 'taskboard', context: 'ws' })

    const taskboard = (center.inject as unknown as () => TaskboardInjected)()
    taskboard.openIssue('issue-1' as never)
    expect(b.layout.openDetails).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(taskboard.hooks.taskboard.getSnapshot().selectedIssue?.id).toBe('issue-1')
    })
    taskboard.close()
    expect(b.layout.closeDetails).toHaveBeenCalledOnce()
    expect(taskboard.hooks.taskboard.getSnapshot().selectedIssue).toBeNull()
    taskboard.openPatrol()
    expect(b.layout.openDetails).toHaveBeenCalledTimes(2)
    expect(taskboard.hooks.taskboard.getSnapshot().detailPanel).toBe('patrol')
    taskboard.close()

    await taskboard.activate('ws' as never)
    b.dispatchChanged('another')
    expect(b.listIssues).toHaveBeenCalledTimes(1)
    b.dispatchChanged('ws')
    await vi.waitFor(() => { expect(b.listIssues).toHaveBeenCalledTimes(2) })

    await fiber.dispose()
    expect(b.slots.entries('sidebar.workspace.action')).toHaveLength(0)
    expect(b.slots.entries('shell.center')).toHaveLength(0)
    expect(b.slots.entries('shell.details')).toHaveLength(0)
  })
})
