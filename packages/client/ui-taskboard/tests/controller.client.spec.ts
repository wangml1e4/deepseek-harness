import { describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  Activity, Comment, Issue, IssueRelation, TaskboardActor, TaskboardAttachment, WorkspaceTaskboard,
} from '@deepseek-ai/dsh-taskboard/types'
import { MAX_ATTACHMENT_BYTES } from '@deepseek-ai/dsh-taskboard'
import type { TaskboardPatrolValue, TaskboardRemoteResult } from '@deepseek-ai/dsh-taskboard-remote/types'
import {
  MAX_TASKBOARD_ATTACHMENT_BYTES,
  TaskboardController,
  type TaskboardClientRemote,
} from '../src/client/controller.ts'

const actor = { type: 'user', id: 'local-user', name: 'User' } as TaskboardActor

function taskboard(workspaceId = 'ws'): WorkspaceTaskboard {
  return {
    workspaceId: workspaceId as never,
    title: workspaceId,
    prefix: workspaceId.toUpperCase(),
    version: 1,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  }
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1' as never,
    identifier: 'WS-1' as never,
    workspaceId: 'ws' as never,
    title: 'Build Taskboard',
    description: '',
    status: 'todo',
    priority: 'high',
    labels: ['frontend'],
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

function patrol(workspaceId = 'ws'): TaskboardPatrolValue {
  return {
    policy: {
      workspaceId: workspaceId as never,
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
    branches: ['main'],
    agentPresets: [{ id: 'coding', name: 'Coding' }],
    providers: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'Chat', reasoning: [] }] }],
    permissionPresets: [{ id: 'workspace-write', name: 'Workspace Write' }],
    runs: [],
  }
}

function ok<T>(value: T): Promise<RemoteResult<TaskboardRemoteResult<T>>> {
  return Promise.resolve({ ok: true, value: { ok: true, value } })
}

function failure<T>(message = 'Rejected'): Promise<RemoteResult<TaskboardRemoteResult<T>>> {
  return Promise.resolve({ ok: true, value: { ok: false, error: { code: 'version_conflict', message } } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function remote(overrides: Partial<TaskboardClientRemote> = {}): TaskboardClientRemote {
  const one = issue()
  return {
    workspace: workspaceId => ok(taskboard(workspaceId)),
    todoCount: () => ok({ count: 1 }),
    listIssues: () => ok({ items: [one] }),
    getIssue: () => ok({ issue: one }),
    createIssue: input => ok(issue({ title: input.title })),
    updateIssue: input => ok(issue({ ...input, version: 2 })),
    archiveIssue: () => ok(issue({ archivedAt: '2026-08-16T00:00:00.000Z', version: 2 })),
    listComments: () => ok({ items: [] }),
    addComment: input => ok({
      id: 'comment-1' as never,
      issueId: one.id,
      body: input.body,
      actor: input.actor,
      createdAt: '2026-08-16T00:00:00.000Z',
    }),
    listAttachments: () => ok({ items: [] }),
    addAttachment: input => ok({
      issue: issue({ version: 2 }),
      attachment: {
        id: 'attachment-1' as never,
        issueId: one.id,
        name: input.name,
        mediaType: input.mediaType,
        size: 1,
        actor: input.actor,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    }),
    readAttachment: input => ok({
      attachment: {
        id: input.attachmentId,
        issueId: one.id,
        name: 'evidence.txt',
        mediaType: 'text/plain',
        size: 1,
        actor,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
      data: 'eA==',
    }),
    deleteAttachment: () => ok(issue({ version: 3 })),
    listActivities: () => ok({ items: [] }),
    listWorkspaceActivities: () => ok({ items: [] }),
    listWorkspaceRelations: () => ok({ items: [] }),
    listRelations: () => ok({ items: [] }),
    addRelation: input => ok({
      issue: issue({ version: 2 }),
      relation: {
        id: 'relation-1' as never,
        type: input.type,
        issueId: one.id,
        relatedIssueId: 'issue-2' as never,
        createdAt: '2026-08-16T00:00:00.000Z',
      },
    }),
    removeRelation: () => ok(issue({ version: 2 })),
    patrol: workspaceId => ok(patrol(workspaceId)),
    updatePatrol: input => ok({ ...patrol(input.workspaceId).policy, ...input, version: 2 }),
    runPatrol: input => ok({
      id: 'run-1' as never,
      workspaceId: input.workspaceId,
      trigger: 'manual',
      scheduledFor: null,
      state: 'active',
      result: null,
      error: null,
      tokenUsage: null,
      providerError: null,
      recoveryCount: 0,
      lastRecoveredAt: null,
      startedAt: '2026-08-16T00:00:00.000Z',
      endedAt: null,
    }),
    patrolIssue: () => ok({ context: null, diff: null, reviews: [] }),
    ...overrides,
  }
}

describe('TaskboardController', () => {
  it('keeps the browser preflight limit aligned with the Host protocol', () => {
    expect(MAX_TASKBOARD_ATTACHMENT_BYTES).toBe(MAX_ATTACHMENT_BYTES)
  })

  it('loads Workspace metadata and active Issues into one immutable snapshot', async () => {
    const workspaceRelation: IssueRelation = {
      id: 'relation-0' as never,
      type: 'blocks',
      issueId: 'issue-1' as never,
      relatedIssueId: 'issue-2' as never,
      createdAt: '2026-08-15T00:00:00.000Z',
    }
    const workspaceActivity: Activity = {
      id: 'activity-0' as never,
      issueId: 'issue-1' as never,
      actor,
      changes: [{ field: 'status', before: 'backlog', after: 'todo' }],
      createdAt: '2026-08-16T00:00:00.000Z',
    }
    const controller = new TaskboardController(remote({
      listWorkspaceActivities: () => ok({ items: [workspaceActivity] }),
      listWorkspaceRelations: () => ok({ items: [workspaceRelation] }),
    }))
    const snapshots: string[] = []
    controller.subscribe(() => { snapshots.push(controller.getSnapshot().phase) })

    await expect(controller.activate('ws' as never)).resolves.toEqual({ ok: true })

    expect(snapshots).toEqual(['loading', 'ready'])
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      workspaceId: 'ws',
      workspace: { prefix: 'WS' },
      issues: [{ identifier: 'WS-1' }],
      workspaceActivities: [workspaceActivity],
      workspaceRelations: [workspaceRelation],
      error: null,
    })
  })

  it('orders Issue columns, manual positions, and identifiers and releases subscriptions', async () => {
    const controller = new TaskboardController(remote({
      listIssues: () => ok({
        items: [
          issue({ id: 'done' as never, identifier: 'WS-9' as never, status: 'done' }),
          issue({ id: 'b' as never, identifier: 'WS-B' as never, sortOrder: 2000 }),
          issue({ id: 'a' as never, identifier: 'WS-A' as never, sortOrder: 2000 }),
          issue({ id: 'first' as never, identifier: 'WS-Z' as never, sortOrder: 1000 }),
        ],
      }),
    }))
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    unsubscribe()

    await controller.activate('ws' as never)

    expect(listener).not.toHaveBeenCalled()
    expect(controller.getSnapshot().issues.map(item => item.id)).toEqual(['first', 'a', 'b', 'done'])
  })

  it('does not let an older Workspace response replace a newer selection', async () => {
    const firstWorkspace = deferred<RemoteResult<TaskboardRemoteResult<WorkspaceTaskboard>>>()
    const firstIssues = deferred<RemoteResult<TaskboardRemoteResult<{ items: readonly Issue[] }>>>()
    const client = remote({
      workspace: workspaceId => workspaceId === 'first' ? firstWorkspace.promise : ok(taskboard('second')),
      listIssues: input => input.workspaceId === 'first'
        ? firstIssues.promise
        : ok({ items: [issue({ workspaceId: 'second' as never, identifier: 'SECOND-1' as never })] }),
    })
    const controller = new TaskboardController(client)

    const old = controller.activate('first' as never)
    await controller.activate('second' as never)
    firstWorkspace.resolve({ ok: true, value: { ok: true, value: taskboard('first') } })
    firstIssues.resolve({ ok: true, value: { ok: true, value: { items: [] } } })
    await old

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready', workspaceId: 'second', workspace: { prefix: 'SECOND' },
    })

    const failedWorkspace = deferred<RemoteResult<TaskboardRemoteResult<WorkspaceTaskboard>>>()
    const failedIssues = deferred<RemoteResult<TaskboardRemoteResult<{ items: readonly Issue[] }>>>()
    const staleFailure = new TaskboardController(remote({
      workspace: workspaceId => workspaceId === 'first' ? failedWorkspace.promise : ok(taskboard('second')),
      listIssues: input => input.workspaceId === 'first' ? failedIssues.promise : ok({ items: [] }),
    }))
    const failed = staleFailure.activate('first' as never)
    await staleFailure.activate('second' as never)
    failedWorkspace.resolve({ ok: true, value: { ok: false, error: { code: 'version_conflict', message: 'Old failure' } } })
    failedIssues.resolve({ ok: true, value: { ok: true, value: { items: [] } } })
    await expect(failed).resolves.toMatchObject({ ok: false })
    expect(staleFailure.getSnapshot().workspaceId).toBe('second')
  })

  it('does not publish an older Workspace mutation into the current Workspace', async () => {
    const created = deferred<RemoteResult<TaskboardRemoteResult<Issue>>>()
    const controller = new TaskboardController(remote({
      listIssues: input => ok({
        items: input.workspaceId === 'second'
          ? [issue({ id: 'second-1' as never, identifier: 'SECOND-1' as never, workspaceId: 'second' as never })]
          : [issue()],
      }),
      createIssue: () => created.promise,
    }))
    await controller.activate('ws' as never)

    const pending = controller.createIssue({ title: 'Old Workspace Issue' })
    await controller.activate('second' as never)
    created.resolve({
      ok: true,
      value: { ok: true, value: issue({ id: 'old-created' as never, title: 'Old Workspace Issue' }) },
    })
    await pending

    expect(controller.getSnapshot().workspaceId).toBe('second')
    expect(controller.getSnapshot().issues.map(item => item.id)).toEqual(['second-1'])
  })

  it('does not append a Comment after the selected Issue closes', async () => {
    const added = deferred<RemoteResult<TaskboardRemoteResult<Comment>>>()
    const controller = new TaskboardController(remote({ addComment: () => added.promise }))
    await controller.activate('ws' as never)
    await controller.selectIssue('issue-1' as never)

    const pending = controller.addComment('Late comment', actor)
    controller.clearSelection()
    added.resolve({
      ok: true,
      value: {
        ok: true,
        value: {
          id: 'comment-late' as never,
          issueId: 'issue-1' as never,
          body: 'Late comment',
          actor,
          createdAt: '2026-08-16T00:00:00.000Z',
        },
      },
    })
    await pending

    expect(controller.getSnapshot()).toMatchObject({ selectedIssue: null, comments: [] })
  })

  it('contains subscriber failures and notifies the remaining subscribers', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = new TaskboardController(remote())
    const notified = vi.fn()
    controller.subscribe(() => { throw new Error('listener failed') })
    controller.subscribe(notified)

    await expect(controller.activate('ws' as never)).resolves.toEqual({ ok: true })

    expect(notified).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith('[ui-taskboard] snapshot listener threw:', expect.any(Error))
    log.mockRestore()
  })

  it('folds carrier and business failures into a retryable error view', async () => {
    const controller = new TaskboardController(remote({
      workspace: () => Promise.resolve({
        ok: false,
        error: { code: 'offline', message: 'Host unavailable', details: {} },
      }),
    }))

    await expect(controller.activate('ws' as never)).resolves.toEqual({
      ok: false, error: { code: 'offline', message: 'Host unavailable' },
    })
    expect(controller.getSnapshot()).toMatchObject({ phase: 'error', error: 'Host unavailable' })
  })

  it('reports Workspace metadata, Issue-list, and rejected read failures', async () => {
    const cases: TaskboardClientRemote[] = [
      remote({ workspace: () => failure('Workspace rejected') }),
      remote({ listIssues: () => failure('Issue list rejected') }),
      remote({ listWorkspaceActivities: () => failure('Activity list rejected') }),
      remote({ listWorkspaceRelations: () => failure('Relations rejected') }),
      remote({ patrol: () => failure('Patrol rejected') }),
      remote({ workspace: () => Promise.reject(new Error('Read exploded')) }),
    ]
    for (const [index, client] of cases.entries()) {
      const controller = new TaskboardController(client)
      const result = await controller.activate(`ws-${index}` as never)
      expect(result.ok).toBe(false)
      expect(controller.getSnapshot().phase).toBe('error')
    }
  })

  it('refreshes as a no-op when cold and reports failed or stale refreshes', async () => {
    const cold = new TaskboardController(remote())
    await expect(cold.refresh()).resolves.toEqual({ ok: true })

    const ready = new TaskboardController(remote())
    await ready.activate('ws' as never)
    await expect(ready.refresh()).resolves.toEqual({ ok: true })

    let rejectWorkspace = false
    const workspaceFailure = new TaskboardController(remote({
      workspace: workspaceId => rejectWorkspace ? failure('Refresh rejected') : ok(taskboard(workspaceId)),
    }))
    await workspaceFailure.activate('ws' as never)
    rejectWorkspace = true
    await expect(workspaceFailure.refresh()).resolves.toMatchObject({ ok: false })
    expect(workspaceFailure.getSnapshot().error).toBe('Refresh rejected')

    let rejectIssues = false
    const issueFailure = new TaskboardController(remote({
      listIssues: () => rejectIssues ? failure('Refresh list rejected') : ok({ items: [issue()] }),
    }))
    await issueFailure.activate('ws' as never)
    rejectIssues = true
    await expect(issueFailure.refresh()).resolves.toMatchObject({ ok: false })

    let throwValue = false
    const rejectedRefresh = new TaskboardController(remote({
      workspace: (workspaceId) => {
        if (!throwValue) return ok(taskboard(workspaceId))
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Exercise non-Error transport rejection normalization.
        return Promise.reject('Refresh exploded')
      },
    }))
    await rejectedRefresh.activate('ws' as never)
    throwValue = true
    await expect(rejectedRefresh.refresh()).resolves.toEqual({
      ok: false, error: { code: 'unexpected', message: 'Refresh exploded' },
    })

    const secondRead = deferred<RemoteResult<TaskboardRemoteResult<WorkspaceTaskboard>>>()
    let pendingRefresh = false
    const changing = remote({
      workspace: workspaceId => pendingRefresh && workspaceId === 'ws'
        ? secondRead.promise
        : ok(taskboard(workspaceId)),
    })
    const staleRefresh = new TaskboardController(changing)
    await staleRefresh.activate('ws' as never)
    pendingRefresh = true
    const refresh = staleRefresh.refresh()
    await staleRefresh.activate('second' as never)
    secondRead.resolve({ ok: true, value: { ok: false, error: { code: 'version_conflict', message: 'Old read' } } })
    await expect(refresh).resolves.toMatchObject({ ok: false })
    expect(staleRefresh.getSnapshot().workspaceId).toBe('second')
  })

  it('loads Issue details together and applies versioned mutations to the shared view', async () => {
    const comments: readonly Comment[] = [{
      id: 'comment-0' as never,
      issueId: 'issue-1' as never,
      body: 'Initial note',
      actor,
      createdAt: '2026-08-15T00:00:00.000Z',
    }]
    const activities: readonly Activity[] = []
    const relations: readonly IssueRelation[] = []
    const client = remote({
      listComments: vi.fn(() => ok({ items: comments })),
      listActivities: vi.fn(() => ok({ items: activities })),
      listRelations: vi.fn(() => ok({ items: relations })),
      updateIssue: vi.fn((input: Parameters<TaskboardClientRemote['updateIssue']>[0]) => {
        if (input.title === undefined) throw new Error('test expected a title mutation')
        return ok(issue({ title: input.title, version: 2 }))
      }),
    })
    const controller = new TaskboardController(client)
    await controller.activate('ws' as never)
    await controller.selectIssue('issue-1' as never)

    expect(controller.getSnapshot()).toMatchObject({
      detailPhase: 'ready',
      selectedIssue: { id: 'issue-1' },
      comments: [{ body: 'Initial note' }],
      activities,
      relations,
    })

    await controller.updateIssue(issue(), { title: 'Updated title' }, actor)
    expect(client.updateIssue).toHaveBeenCalledWith(expect.objectContaining({
      reference: 'issue-1', expectedVersion: 1, title: 'Updated title', actor,
    }))
    expect(controller.getSnapshot().issues[0]?.title).toBe('Updated title')
    expect(controller.getSnapshot().selectedIssue?.version).toBe(2)
  })

  it('loads attachment metadata and applies upload, read, and confirmed deletion', async () => {
    const stored: TaskboardAttachment = {
      id: 'attachment-existing' as never,
      issueId: 'issue-1' as never,
      name: 'diagram.png',
      mediaType: 'image/png',
      size: 4,
      actor,
      createdAt: '2026-08-16T00:00:00.000Z',
    }
    const client = remote({
      listAttachments: vi.fn(() => ok({ items: [stored] })),
      addAttachment: vi.fn((input: Parameters<TaskboardClientRemote['addAttachment']>[0]) => ok({
        issue: issue({ version: 2 }),
        attachment: { ...stored, id: 'attachment-uploaded' as never, name: input.name, mediaType: input.mediaType },
      })),
      readAttachment: vi.fn(() => ok({ attachment: stored, data: 'eA==' })),
      deleteAttachment: vi.fn(() => ok(issue({ version: 3 }))),
    })
    const controller = new TaskboardController(client)
    await controller.activate('ws' as never)
    await controller.selectIssue('issue-1' as never)
    expect(controller.getSnapshot().attachments).toEqual([stored])

    const file = new File([Uint8Array.of(1, 2)], 'evidence.bin', { type: '' })
    await controller.addAttachment(file, actor)
    expect(client.addAttachment).toHaveBeenCalledWith(expect.objectContaining({
      reference: 'issue-1',
      expectedVersion: 1,
      name: 'evidence.bin',
      mediaType: 'application/octet-stream',
      data: 'AQI=',
      actor,
    }))
    expect(controller.getSnapshot()).toMatchObject({
      selectedIssue: { version: 2 },
      attachments: [{ id: 'attachment-existing' }, { id: 'attachment-uploaded' }],
    })

    await expect(controller.readAttachment(stored)).resolves.toMatchObject({
      ok: true,
      value: { attachment: stored, data: 'eA==' },
    })
    await controller.deleteAttachment(stored, true, actor)
    expect(client.deleteAttachment).toHaveBeenCalledWith(expect.objectContaining({
      reference: 'issue-1', attachmentId: stored.id, expectedVersion: 2, confirmed: true, actor,
    }))
    expect(controller.getSnapshot().attachments).toEqual([
      expect.objectContaining({ id: 'attachment-uploaded' }),
    ])
  })

  it('rejects attachment actions without the selected owning Issue and before oversized reads', async () => {
    const attachment: TaskboardAttachment = {
      id: 'attachment-foreign' as never,
      issueId: 'issue-2' as never,
      name: 'foreign.bin',
      mediaType: 'application/octet-stream',
      size: 1,
      actor,
      createdAt: '2026-08-16T00:00:00.000Z',
    }
    const client = remote()
    const controller = new TaskboardController(client)
    const unselectedFile = { name: 'unselected.bin', size: 1 } as File

    await expect(controller.addAttachment(unselectedFile, actor)).resolves.toMatchObject({
      ok: false, error: { code: 'issue_not_found' },
    })
    await expect(controller.readAttachment(attachment)).resolves.toMatchObject({
      ok: false, error: { code: 'attachment_not_found' },
    })
    await expect(controller.deleteAttachment(attachment, true, actor)).resolves.toMatchObject({
      ok: false, error: { code: 'attachment_not_found' },
    })

    await controller.activate('ws' as never)
    await controller.selectIssue('issue-1' as never)
    const oversizedFile = { name: 'large.bin', size: MAX_TASKBOARD_ATTACHMENT_BYTES + 1 } as File
    await expect(controller.addAttachment(oversizedFile, actor)).resolves.toMatchObject({
      ok: false, error: { code: 'attachment_too_large' },
    })
    await expect(controller.readAttachment(attachment)).resolves.toMatchObject({
      ok: false, error: { code: 'attachment_not_found' },
    })
    await expect(controller.deleteAttachment(attachment, true, actor)).resolves.toMatchObject({
      ok: false, error: { code: 'attachment_not_found' },
    })
  })

  it('normalizes a browser file read failure without calling the Host', async () => {
    const client = remote()
    const addAttachment = vi.spyOn(client, 'addAttachment')
    const controller = new TaskboardController(client)
    await controller.activate('ws' as never)
    await controller.selectIssue('issue-1' as never)
    const unreadable = {
      name: 'unreadable.bin',
      size: 1,
      type: 'application/octet-stream',
      arrayBuffer: vi.fn(async () => { throw new Error('browser file read failed') }),
    } as unknown as File

    await expect(controller.addAttachment(unreadable, actor)).resolves.toMatchObject({
      ok: false,
      error: { code: 'attachment_invalid', message: 'browser file read failed' },
    })
    expect(addAttachment).not.toHaveBeenCalled()
    expect(controller.getSnapshot().actionError).toBe('browser file read failed')
  })

  it('reports every Issue-detail read failure and missing Issue', async () => {
    const cases: Partial<TaskboardClientRemote>[] = [
      { getIssue: () => failure('Issue rejected') },
      { listComments: () => failure('Comments rejected') },
      { listAttachments: () => failure('Attachments rejected') },
      { listActivities: () => failure('Activities rejected') },
      { listRelations: () => failure('Relations rejected') },
      { patrolIssue: () => failure('Patrol evidence rejected') },
      { getIssue: () => Promise.reject(new Error('Details exploded')) },
    ]
    for (const client of cases) {
      const controller = new TaskboardController(remote(client))
      await controller.activate('ws' as never)
      await expect(controller.selectIssue('WS-1' as never)).resolves.toMatchObject({ ok: false })
      expect(controller.getSnapshot().detailPhase).toBe('error')
    }

    const missing = new TaskboardController(remote({ getIssue: () => ok({ issue: null }) }))
    await missing.activate('ws' as never)
    await expect(missing.selectIssue('missing' as never)).resolves.toEqual({
      ok: false,
      error: { code: 'issue_not_found', message: "Issue 'missing' does not exist" },
    })
    expect(missing.getSnapshot()).toMatchObject({ selectedIssue: null, detailPhase: 'error' })
  })

  it('drops stale failed detail reads and settled reads after disposal', async () => {
    const pending = deferred<RemoteResult<TaskboardRemoteResult<{ issue: Issue | null }>>>()
    const controller = new TaskboardController(remote({ getIssue: () => pending.promise }))
    await controller.activate('ws' as never)
    const selection = controller.selectIssue('issue-1' as never)
    controller.clearSelection()
    pending.resolve({ ok: true, value: { ok: false, error: { code: 'version_conflict', message: 'Late failure' } } })
    await expect(selection).resolves.toMatchObject({ ok: false })
    expect(controller.getSnapshot().detailPhase).toBe('idle')

    const afterDispose = deferred<RemoteResult<TaskboardRemoteResult<{ issue: Issue | null }>>>()
    const disposed = new TaskboardController(remote({ getIssue: () => afterDispose.promise }))
    await disposed.activate('ws' as never)
    const disposedSelection = disposed.selectIssue('issue-1' as never)
    disposed.dispose()
    afterDispose.resolve({ ok: true, value: { ok: true, value: { issue: issue() } } })
    await expect(disposedSelection).resolves.toEqual({ ok: true })
    const before = disposed.getSnapshot()
    disposed.clearSelection()
    expect(disposed.getSnapshot()).toBe(before)
  })

  it('refreshes the active Workspace without dropping its selected Issue details', async () => {
    let current = issue()
    let comments: readonly Comment[] = []
    const controller = new TaskboardController(remote({
      listIssues: () => ok({ items: [current] }),
      getIssue: () => ok({ issue: current }),
      listComments: () => ok({ items: comments }),
    }))
    await controller.activate('ws' as never)
    await controller.selectIssue(current.id)
    current = issue({ title: 'Changed elsewhere', version: 2 })
    comments = [{
      id: 'comment-remote' as never,
      issueId: current.id,
      body: 'CLI update',
      actor,
      createdAt: '2026-08-16T00:00:00.000Z',
    }]

    await controller.refresh()

    expect(controller.getSnapshot()).toMatchObject({
      phase: 'ready',
      selectedIssue: { title: 'Changed elsewhere', version: 2 },
      detailPhase: 'ready',
      comments: [{ body: 'CLI update' }],
    })
  })

  it('drops detail selection when a refresh no longer lists the Issue', async () => {
    let items: readonly Issue[] = [issue()]
    const controller = new TaskboardController(remote({ listIssues: () => ok({ items }) }))
    await controller.activate('ws' as never)
    await controller.selectIssue('issue-1' as never)
    items = []

    await controller.refresh()

    expect(controller.getSnapshot()).toMatchObject({
      selectedIssue: null,
      detailPhase: 'idle',
      comments: [],
      activities: [],
      relations: [],
    })
  })

  it('applies create, comment, dependency, and archive mutations to the shared snapshot', async () => {
    const relation: IssueRelation = {
      id: 'relation-1' as never,
      type: 'blocked_by',
      issueId: 'issue-1' as never,
      relatedIssueId: 'issue-2' as never,
      createdAt: '2026-08-16T00:00:00.000Z',
    }
    const second = issue({ id: 'issue-2' as never, identifier: 'WS-2' as never, sortOrder: 2000 })
    const client = remote({
      listIssues: () => ok({ items: [issue(), second] }),
      createIssue: input => ok(issue({ id: 'issue-3' as never, identifier: 'WS-3' as never, title: input.title, status: 'backlog' })),
      updateIssue: input => ok(input.reference === second.id
        ? { ...second, title: input.title ?? second.title, version: 2 }
        : issue({ ...(input.title === undefined ? {} : { title: input.title }), version: 2 })),
      archiveIssue: input => ok(issue({
        ...(input.reference === second.id ? second : issue()),
        archivedAt: '2026-08-16T00:00:00.000Z', version: 2,
      })),
    })
    const controller = new TaskboardController(client)
    await controller.activate('ws' as never)
    await controller.selectIssue('issue-1' as never)

    await expect(controller.createIssue({ title: 'Created' })).resolves.toEqual({ ok: true })
    await expect(controller.addComment('Comment', actor)).resolves.toEqual({ ok: true })
    await expect(controller.addRelation('blocked_by', second.id, actor)).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot()).toMatchObject({
      selectedIssue: { version: 2 },
      comments: [{ body: 'Comment' }],
      relations: [{ id: 'relation-1' }],
      workspaceRelations: [{
        id: 'relation-1', type: 'blocks', issueId: 'issue-2', relatedIssueId: 'issue-1',
      }],
    })
    await expect(controller.removeRelation(relation, actor)).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot().relations).toEqual([])
    expect(controller.getSnapshot().workspaceRelations).toEqual([])

    await expect(controller.addRelation('blocks', second.id, actor)).resolves.toEqual({ ok: true })
    expect(controller.getSnapshot().workspaceRelations).toMatchObject([{
      type: 'blocks', issueId: 'issue-1', relatedIssueId: 'issue-2',
    }])

    await controller.updateIssue(second, { title: 'Updated second' }, actor)
    expect(controller.getSnapshot().selectedIssue?.id).toBe('issue-1')

    await controller.archiveIssue(second, actor)
    expect(controller.getSnapshot().selectedIssue?.id).toBe('issue-1')
    await controller.archiveIssue(controller.getSnapshot().selectedIssue!, actor)
    expect(controller.getSnapshot()).toMatchObject({
      selectedIssue: null, detailPhase: 'idle', comments: [], activities: [], relations: [],
    })
  })

  it('publishes mutation precondition and Remote failures while preserving stale outcomes', async () => {
    const cold = new TaskboardController(remote())
    await expect(cold.createIssue({ title: 'No Workspace' })).resolves.toMatchObject({ ok: false })
    await expect(cold.addComment('No Issue', actor)).resolves.toMatchObject({ ok: false })
    await expect(cold.addRelation('blocks', 'issue-2' as never, actor)).resolves.toMatchObject({ ok: false })
    await expect(cold.removeRelation({ id: 'relation-1' } as never, actor)).resolves.toMatchObject({ ok: false })
    await expect(cold.updatePatrol({ interval: '30m' })).resolves.toMatchObject({ ok: false })
    await expect(cold.runPatrol()).resolves.toMatchObject({ ok: false })

    const rejectedMutation = new TaskboardController(remote({ createIssue: () => failure('Create rejected') }))
    await rejectedMutation.activate('ws' as never)
    await expect(rejectedMutation.createIssue({ title: 'Rejected' })).resolves.toMatchObject({ ok: false })
    expect(rejectedMutation.getSnapshot().actionError).toBe('Create rejected')

    const thrownMutation = new TaskboardController(remote({ createIssue: () => Promise.reject(new Error('Create exploded')) }))
    await thrownMutation.activate('ws' as never)
    await expect(thrownMutation.createIssue({ title: 'Explodes' })).resolves.toMatchObject({ ok: false })

    const late = deferred<RemoteResult<TaskboardRemoteResult<Comment>>>()
    const staleFailure = new TaskboardController(remote({ addComment: () => late.promise }))
    await staleFailure.activate('ws' as never)
    await staleFailure.selectIssue('issue-1' as never)
    const pending = staleFailure.addComment('Late', actor)
    staleFailure.clearSelection()
    late.resolve({ ok: true, value: { ok: false, error: { code: 'version_conflict', message: 'Late rejected' } } })
    await expect(pending).resolves.toMatchObject({ ok: false })

    const foreign = issue({ workspaceId: 'other' as never })
    await expect(staleFailure.updateIssue(foreign, { title: 'Foreign' }, actor)).resolves.toEqual({ ok: true })
  })

  it('opens Patrol, saves its exact version, and publishes a manual Run', async () => {
    const client = remote()
    const updatePatrol = vi.spyOn(client, 'updatePatrol')
    const runPatrol = vi.spyOn(client, 'runPatrol')
    const controller = new TaskboardController(client)
    await controller.activate('ws' as never)

    controller.openPatrol()
    expect(controller.getSnapshot()).toMatchObject({ detailPanel: 'patrol', selectedIssue: null })
    await controller.refresh()
    expect(controller.getSnapshot().detailPanel).toBe('patrol')
    await expect(controller.updatePatrol({
      enabled: true,
      interval: '30m',
      baseBranch: 'main',
    })).resolves.toEqual({ ok: true })
    expect(updatePatrol).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws', expectedVersion: 1, enabled: true, interval: '30m',
    }))
    expect(controller.getSnapshot().patrol?.policy).toMatchObject({ enabled: true, interval: '30m', version: 2 })

    await expect(controller.runPatrol('issue-1' as never)).resolves.toEqual({ ok: true })
    expect(runPatrol).toHaveBeenCalledWith({ workspaceId: 'ws', issue: 'issue-1' })
    expect(controller.getSnapshot().patrol?.runs[0]?.run).toMatchObject({ id: 'run-1', state: 'active' })
    await expect(controller.runPatrol()).resolves.toEqual({ ok: true })
    expect(runPatrol).toHaveBeenLastCalledWith({ workspaceId: 'ws' })
    expect(controller.getSnapshot().patrol?.runs).toHaveLength(1)
  })
})
