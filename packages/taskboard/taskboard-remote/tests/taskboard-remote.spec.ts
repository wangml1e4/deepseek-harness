import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_ATTACHMENT_BYTES, TaskboardActorId } from '@deepseek-ai/dsh-taskboard'
import SqliteTaskboard from '@deepseek-ai/dsh-taskboard-sqlite'
import { WorkspaceId, type Workspace, type WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import TaskboardRemote from '../src/index.ts'

const contexts: Context[] = []
const tempDirs: string[] = []
const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000101')
const secondWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000102')
const actor = {
  type: 'user' as const,
  id: TaskboardActorId('remote-user'),
  name: 'Remote User',
}

function workspace(id = workspaceId, title = 'Alpha Workspace'): Workspace {
  return {
    id,
    path: `/workspace/${id}`,
    title,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    sessionIds: [],
    setTitle: () => Promise.resolve(),
    attachSession: () => Promise.resolve(),
    insertSessionBefore: () => Promise.resolve(),
    detachSession: () => Promise.resolve(),
    status: () => Promise.resolve('ok'),
  }
}

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  const registered = new Map([
    [workspaceId, workspace()],
    [secondWorkspaceId, workspace(secondWorkspaceId, 'Beta Workspace')],
  ])
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => registered.get(id),
  } as WorkspaceRegistry)
  const attachmentsPath = await mkdtemp(join(tmpdir(), 'dsh-taskboard-remote-attachments-'))
  tempDirs.push(attachmentsPath)
  await ctx.plugin(SqliteTaskboard, { path: ':memory:', attachmentsPath, journalMode: 'delete' })
  ctx.provide('taskboardPatrol', {
    configuration: () => Promise.resolve({
      defaults: {
        baseBranch: 'main',
        agentPreset: 'coding',
        selection: { provider: 'deepseek', model: 'deepseek-chat' },
        permissionPreset: 'workspace-write',
      },
      branches: ['main'],
      agentPresets: [{ id: 'coding', name: 'Coding' }],
      providers: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: [] }],
      }],
      permissionPresets: [{ id: 'workspace-write', name: 'Workspace Write' }],
    }),
    updatePolicy: (input: Parameters<typeof ctx.taskboard.updatePatrolPolicy>[0]) =>
      ctx.taskboard.updatePatrolPolicy(input),
    trigger: (input: { workspaceId: WorkspaceId }) =>
      ctx.taskboard.beginPatrolRun({ workspaceId: input.workspaceId, trigger: 'manual' }),
  } as never)
  await ctx.plugin(TaskboardRemote)
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Taskboard Remote Consumer', () => {
  it('publishes the complete V1 domain namespace as direct methods', async () => {
    const ctx = await harness()
    expect(ctx.taskboardRemote.typertRemote).toMatchObject({
      serviceKey: 'taskboardRemote',
      namespace: 'taskboard',
    })
    expect(remoteMethods(ctx.taskboardRemote)).toEqual([
      { method: 'workspace', invocation: { kind: 'direct' } },
      { method: 'setPrefix', invocation: { kind: 'direct' } },
      { method: 'listIssues', invocation: { kind: 'direct' } },
      { method: 'getIssue', invocation: { kind: 'direct' } },
      { method: 'createIssue', invocation: { kind: 'direct' } },
      { method: 'updateIssue', invocation: { kind: 'direct' } },
      { method: 'moveIssue', invocation: { kind: 'direct' } },
      { method: 'archiveIssue', invocation: { kind: 'direct' } },
      { method: 'restoreIssue', invocation: { kind: 'direct' } },
      { method: 'listComments', invocation: { kind: 'direct' } },
      { method: 'addComment', invocation: { kind: 'direct' } },
      { method: 'listAttachments', invocation: { kind: 'direct' } },
      { method: 'addAttachment', invocation: { kind: 'direct' } },
      { method: 'readAttachment', invocation: { kind: 'direct' } },
      { method: 'deleteAttachment', invocation: { kind: 'direct' } },
      { method: 'listActivities', invocation: { kind: 'direct' } },
      { method: 'listWorkspaceRelations', invocation: { kind: 'direct' } },
      { method: 'listRelations', invocation: { kind: 'direct' } },
      { method: 'addRelation', invocation: { kind: 'direct' } },
      { method: 'removeRelation', invocation: { kind: 'direct' } },
      { method: 'patrol', invocation: { kind: 'direct' } },
      { method: 'updatePatrol', invocation: { kind: 'direct' } },
      { method: 'runPatrol', invocation: { kind: 'direct' } },
      { method: 'patrolIssue', invocation: { kind: 'direct' } },
    ])
  })

  it('carries attachment bytes as base64 through the controlled Host namespace', async () => {
    const ctx = await harness()
    const created = await ctx.taskboardRemote.createIssue({ workspaceId, title: 'Remote attachment' })
    if (!created.ok) throw new Error(created.error.message)
    const added = await ctx.taskboardRemote.addAttachment({
      reference: created.value.id,
      expectedVersion: created.value.version,
      name: 'notes.txt',
      mediaType: 'text/plain',
      data: Buffer.from('attachment body').toString('base64'),
      actor,
    })
    expect(added).toMatchObject({ ok: true, value: { attachment: { name: 'notes.txt', size: 15 } } })
    if (!added.ok) throw new Error(added.error.message)
    await expect(ctx.taskboardRemote.listAttachments(created.value.id)).resolves.toEqual({
      ok: true,
      value: { items: [added.value.attachment] },
    })
    await expect(ctx.taskboardRemote.readAttachment({
      reference: created.value.id,
      attachmentId: added.value.attachment.id,
    })).resolves.toEqual({
      ok: true,
      value: { attachment: added.value.attachment, data: Buffer.from('attachment body').toString('base64') },
    })
    await expect(ctx.taskboardRemote.deleteAttachment({
      reference: created.value.id,
      attachmentId: added.value.attachment.id,
      expectedVersion: added.value.issue.version,
      confirmed: false,
      actor,
    })).resolves.toMatchObject({ ok: false, error: { code: 'attachment_confirmation_required' } })
  })

  it('rejects malformed and oversized attachment base64 at the Remote boundary', async () => {
    const ctx = await harness()
    const created = await ctx.taskboardRemote.createIssue({ workspaceId, title: 'Malformed attachment' })
    if (!created.ok) throw new Error(created.error.message)
    for (const data of ['not base64!', 'AB==']) {
      await expect(ctx.taskboardRemote.addAttachment({
        reference: created.value.id,
        expectedVersion: created.value.version,
        name: 'bad.bin',
        mediaType: 'application/octet-stream',
        data,
        actor,
      })).resolves.toEqual({
        ok: false,
        error: { code: 'attachment_invalid', message: 'attachment data must be canonical base64' },
      })
    }
    const maximumEncodedLength = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4
    await expect(ctx.taskboardRemote.addAttachment({
      reference: created.value.id,
      expectedVersion: created.value.version,
      name: 'oversized.bin',
      mediaType: 'application/octet-stream',
      data: 'A'.repeat(maximumEncodedLength + 1),
      actor,
    })).resolves.toMatchObject({ ok: false, error: { code: 'attachment_too_large' } })
    await expect(ctx.taskboardRemote.addAttachment({
      reference: created.value.id,
      expectedVersion: created.value.version,
      name: 'decoded-oversized.bin',
      mediaType: 'application/octet-stream',
      data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString('base64'),
      actor,
    })).resolves.toMatchObject({ ok: false, error: { code: 'attachment_too_large' } })
  })

  it('derives Taskboard metadata from the authoritative Workspace', async () => {
    const ctx = await harness()
    await expect(ctx.taskboardRemote.workspace(workspaceId)).resolves.toMatchObject({
      ok: true,
      value: { workspaceId, title: 'Alpha Workspace', prefix: 'ALPHAWORKSPA' },
    })
    await expect(ctx.taskboardRemote.workspace(WorkspaceId('missing'))).resolves.toEqual({
      ok: false,
      error: {
        code: 'workspace_not_found',
        message: "Workspace 'missing' does not exist",
      },
    })
  })

  it('delegates mutations and preserves stable optimistic-concurrency failures', async () => {
    const ctx = await harness()
    await ctx.taskboardRemote.workspace(workspaceId)
    const created = await ctx.taskboardRemote.createIssue({
      workspaceId,
      title: 'Remote mutation',
      status: 'todo',
    })
    if (!created.ok) throw new Error(created.error.message)

    await expect(ctx.taskboardRemote.updateIssue({
      reference: created.value.id,
      expectedVersion: 0,
      title: 'Stale mutation',
      actor,
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'version_conflict',
        message: `cannot update Issue '${created.value.id}': expected version 0, found 1`,
      },
    })

    await expect(ctx.taskboardRemote.updateIssue({
      reference: created.value.identifier,
      expectedVersion: 1,
      status: 'in_progress',
      actor,
    })).resolves.toMatchObject({
      ok: true,
      value: { identifier: created.value.identifier, status: 'in_progress', version: 2 },
    })
  })

  it('exposes the complete Issue, comment, Activity, and relation lifecycle', async () => {
    const ctx = await harness()
    const ensured = await ctx.taskboardRemote.workspace(workspaceId)
    if (!ensured.ok) throw new Error(ensured.error.message)
    await expect(ctx.taskboardRemote.setPrefix({
      workspaceId,
      prefix: 'ALPHA',
      expectedVersion: ensured.value.version,
    })).resolves.toMatchObject({ ok: true, value: { prefix: 'ALPHA', version: 2 } })

    const first = await ctx.taskboardRemote.createIssue({ workspaceId, title: 'First', status: 'todo' })
    const second = await ctx.taskboardRemote.createIssue({ workspaceId, title: 'Second' })
    if (!first.ok || !second.ok) throw new Error('fixture Issue creation failed')

    await expect(ctx.taskboardRemote.listIssues({ workspaceId })).resolves.toMatchObject({
      ok: true,
      value: { items: [{ identifier: 'ALPHA-2' }, { identifier: 'ALPHA-1' }] },
    })
    await expect(ctx.taskboardRemote.getIssue(first.value.identifier)).resolves.toMatchObject({
      ok: true,
      value: { issue: { id: first.value.id } },
    })
    await expect(ctx.taskboardRemote.getIssue('UNKNOWN-1' as typeof first.value.identifier)).resolves.toEqual({
      ok: true,
      value: { issue: null },
    })

    await expect(ctx.taskboardRemote.addComment({
      reference: first.value.id,
      body: 'Ready for the next step',
      actor,
    })).resolves.toMatchObject({ ok: true, value: { body: 'Ready for the next step' } })
    await expect(ctx.taskboardRemote.listComments(first.value.id)).resolves.toMatchObject({
      ok: true,
      value: { items: [{ body: 'Ready for the next step' }] },
    })
    const related = await ctx.taskboardRemote.addRelation({
      reference: first.value.id,
      relatedReference: second.value.id,
      type: 'blocks',
      expectedVersion: first.value.version,
      actor,
    })
    if (!related.ok) throw new Error(related.error.message)
    const activities = await ctx.taskboardRemote.listActivities(first.value.id)
    if (!activities.ok) throw new Error(activities.error.message)
    expect(activities.value.items.length).toBeGreaterThan(0)
    await expect(ctx.taskboardRemote.listRelations(first.value.id)).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: related.value.relation.id, type: 'blocks' }] },
    })
    await expect(ctx.taskboardRemote.listWorkspaceRelations(workspaceId)).resolves.toMatchObject({
      ok: true,
      value: { items: [{
        id: related.value.relation.id,
        type: 'blocks',
        issueId: first.value.id,
        relatedIssueId: second.value.id,
      }] },
    })
    const removed = await ctx.taskboardRemote.removeRelation({
      reference: first.value.id,
      relationId: related.value.relation.id,
      expectedVersion: related.value.issue.version,
      actor,
    })
    if (!removed.ok) throw new Error(removed.error.message)

    const moved = await ctx.taskboardRemote.moveIssue({
      reference: first.value.id,
      targetWorkspaceId: secondWorkspaceId,
      expectedVersion: removed.value.version,
      actor,
    })
    if (!moved.ok) throw new Error(moved.error.message)
    await expect(ctx.taskboardRemote.listIssues({ workspaceId: secondWorkspaceId })).resolves.toMatchObject({
      ok: true,
      value: { items: [{ id: first.value.id, workspaceId: secondWorkspaceId }] },
    })

    const archived = await ctx.taskboardRemote.archiveIssue({
      reference: first.value.id,
      expectedVersion: moved.value.version,
      actor,
    })
    if (!archived.ok) throw new Error(archived.error.message)
    await expect(ctx.taskboardRemote.restoreIssue({
      reference: first.value.id,
      expectedVersion: archived.value.version,
      actor,
    })).resolves.toMatchObject({ ok: true, value: { archivedAt: null } })
  })

  it('rejects unknown Workspace operations and preserves infrastructure failures', async () => {
    const ctx = await harness()
    await expect(ctx.taskboardRemote.listIssues({ workspaceId: WorkspaceId('missing') })).resolves.toMatchObject({
      ok: false,
      error: { code: 'workspace_not_found' },
    })
    vi.spyOn(ctx.taskboard, 'getIssue').mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(ctx.taskboardRemote.getIssue('UNKNOWN-1' as never)).rejects.toThrow('storage unavailable')
  })

  it('exposes Patrol choices, policy saves, manual Runs, and Issue evidence', async () => {
    const ctx = await harness()
    await ctx.taskboardRemote.workspace(workspaceId)
    const view = await ctx.taskboardRemote.patrol(workspaceId)
    if (!view.ok) throw new Error(view.error.message)
    expect(view.value).toMatchObject({
      policy: { enabled: false, interval: '1h' },
      defaults: { baseBranch: 'main', provider: 'deepseek', model: 'deepseek-chat' },
      branches: ['main'],
      runs: [],
    })
    await expect(ctx.taskboardRemote.updatePatrol({
      workspaceId,
      expectedVersion: view.value.policy.version,
      interval: '30m',
      baseBranch: 'main',
    })).resolves.toMatchObject({ ok: true, value: { interval: '30m' } })
    await expect(ctx.taskboardRemote.runPatrol({ workspaceId })).resolves.toMatchObject({
      ok: true,
      value: { workspaceId, trigger: 'manual', state: 'active' },
    })
    const issue = await ctx.taskboardRemote.createIssue({ workspaceId, title: 'Evidence' })
    if (!issue.ok) throw new Error(issue.error.message)
    await expect(ctx.taskboardRemote.patrolIssue(issue.value.id)).resolves.toEqual({
      ok: true,
      value: { context: null, reviews: [] },
    })
  })
})
