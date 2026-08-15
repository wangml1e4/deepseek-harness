import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { IssueId, PatrolAttemptId, PatrolRunId, RelationId, TaskboardActorId } from '@deepseek-ai/dsh-taskboard'
import type { Issue } from '@deepseek-ai/dsh-taskboard'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import SqliteTaskboard from '../src/index.ts'
import type { Config } from '../src/index.ts'

const tempDirs: string[] = []
const actor = {
  type: 'user' as const,
  id: TaskboardActorId('local-user'),
  name: 'Local User',
}
const patrolActor = {
  type: 'patrol_agent' as const,
  id: TaskboardActorId('patrol-agent'),
  name: 'Patrol Agent',
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function databasePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-taskboard-'))
  tempDirs.push(dir)
  return join(dir, 'taskboard.db')
}

async function mount(path: string, config: Omit<Config, 'path'> = { journalMode: 'delete' }) {
  const ctx = new Context()
  const fiber = await ctx.plugin(SqliteTaskboard, { path, ...config })
  return { ctx, dispose: () => fiber.dispose() }
}

describe('SQLite Taskboard service', () => {
  it('persists a default-off one-hour Patrol Policy and recalculates cadence from each save', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000041')
    const mounted = await mount(path)
    try {
      vi.useFakeTimers()
      vi.setSystemTime('2026-08-16T01:00:00.000Z')
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Patrol Policy' })
      const initial = await mounted.ctx.taskboard.getPatrolPolicy(workspaceId)
      expect(initial).toMatchObject({
        workspaceId,
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
      })

      await expect(mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: true,
        expectedVersion: initial!.version,
      })).rejects.toMatchObject({ code: 'patrol_policy_invalid' })
      await expect(mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        permissionPreset: ' ',
        expectedVersion: initial!.version,
      })).rejects.toMatchObject({ code: 'patrol_policy_invalid' })
      await expect(mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        provider: 'provider-only',
        expectedVersion: initial!.version,
      })).rejects.toMatchObject({ code: 'patrol_policy_invalid' })
      await expect(mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        model: 'model-only',
        expectedVersion: initial!.version,
      })).rejects.toMatchObject({ code: 'patrol_policy_invalid' })

      const enabled = await mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: true,
        baseBranch: 'main',
        agentPreset: 'coding',
        provider: 'provider-explicit',
        model: 'model-explicit',
        reasoningEffort: 'high',
        permissionPreset: 'danger-full-access',
        expectedVersion: initial!.version,
      })
      expect(enabled).toMatchObject({
        enabled: true,
        interval: '1h',
        agentPreset: 'coding',
        provider: 'provider-explicit',
        model: 'model-explicit',
        reasoningEffort: 'high',
        permissionPreset: 'danger-full-access',
        nextDueAt: '2026-08-16T02:00:00.000Z',
      })

      vi.setSystemTime('2026-08-16T01:10:00.000Z')
      const changed = await mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        interval: '30m',
        expectedVersion: enabled.version,
      })
      expect(changed).toMatchObject({ enabled: true, interval: '30m', nextDueAt: '2026-08-16T01:40:00.000Z' })

      const disabled = await mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: false,
        expectedVersion: changed.version,
      })
      expect(disabled).toMatchObject({ enabled: false, interval: '30m', nextDueAt: null })
    } finally {
      vi.useRealTimers()
      await mounted.dispose()
    }

    const reopened = await mount(path)
    try {
      await expect(reopened.ctx.taskboard.getPatrolPolicy(workspaceId)).resolves.toMatchObject({
        enabled: false,
        interval: '30m',
        nextDueAt: null,
        version: 4,
      })
    } finally {
      await reopened.dispose()
    }
  })

  it('consumes one overdue cadence point and discards missed triggers', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000042')
    const mounted = await mount(path)
    try {
      vi.useFakeTimers()
      vi.setSystemTime('2026-08-16T01:00:00.000Z')
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Overdue Patrol' })
      const initial = await mounted.ctx.taskboard.getPatrolPolicy(workspaceId)
      await mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: true,
        interval: '30m',
        baseBranch: 'main',
        expectedVersion: initial!.version,
      })

      vi.setSystemTime('2026-08-16T03:12:00.000Z')
      await expect(mounted.ctx.taskboard.listDuePatrolPolicies()).resolves.toHaveLength(1)
      const run = await mounted.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'scheduled' })
      expect(run).toMatchObject({
        workspaceId,
        trigger: 'scheduled',
        scheduledFor: '2026-08-16T01:30:00.000Z',
        state: 'active',
        result: null,
      })
      await expect(mounted.ctx.taskboard.getPatrolPolicy(workspaceId)).resolves.toMatchObject({
        enabled: true,
        nextDueAt: '2026-08-16T03:30:00.000Z',
      })
      await expect(mounted.ctx.taskboard.listDuePatrolPolicies()).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
      await mounted.dispose()
    }
  })

  it('records scheduled global-busy overlaps without queueing and rejects a busy manual Run', async () => {
    const path = await databasePath()
    const firstWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000043')
    const secondWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000044')
    const mounted = await mount(path)
    try {
      vi.useFakeTimers()
      vi.setSystemTime('2026-08-16T01:00:00.000Z')
      for (const [workspaceId, title] of [[firstWorkspaceId, 'First Patrol'], [secondWorkspaceId, 'Second Patrol']] as const) {
        await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title })
        const policy = await mounted.ctx.taskboard.getPatrolPolicy(workspaceId)
        await mounted.ctx.taskboard.updatePatrolPolicy({
          workspaceId,
          enabled: true,
          interval: '5m',
          baseBranch: 'main',
          expectedVersion: policy!.version,
        })
      }
      vi.setSystemTime('2026-08-16T01:05:00.000Z')
      const active = await mounted.ctx.taskboard.beginPatrolRun({
        workspaceId: firstWorkspaceId,
        trigger: 'scheduled',
      })
      const skipped = await mounted.ctx.taskboard.beginPatrolRun({
        workspaceId: secondWorkspaceId,
        trigger: 'scheduled',
      })
      expect(active.state).toBe('active')
      expect(skipped).toMatchObject({ state: 'completed', result: 'skipped_global_busy' })
      await expect(mounted.ctx.taskboard.beginPatrolRun({
        workspaceId: secondWorkspaceId,
        trigger: 'manual',
      })).rejects.toMatchObject({ code: 'patrol_busy' })
    } finally {
      vi.useRealTimers()
      await mounted.dispose()
    }
  })

  it('persists terminal Patrol history and prevents completing a Run twice', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000045')
    const first = await mount(path)
    let runId = PatrolRunId('')
    try {
      await first.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Patrol History' })
      const run = await first.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'manual' })
      runId = run.id
      const completed = await first.ctx.taskboard.completePatrolRun({
        runId,
        result: 'no_eligible_issue',
      })
      expect(completed).toMatchObject({ state: 'completed', result: 'no_eligible_issue' })
      expect(completed.endedAt).toBeTypeOf('string')
      await expect(first.ctx.taskboard.completePatrolRun({
        runId,
        result: 'failed',
        error: 'must not overwrite history',
      })).rejects.toMatchObject({ code: 'patrol_run_not_active' })
    } finally {
      await first.dispose()
    }

    const reopened = await mount(path)
    try {
      await expect(reopened.ctx.taskboard.listPatrolRuns(workspaceId)).resolves.toMatchObject([
        { id: runId, state: 'completed', result: 'no_eligible_issue' },
      ])
    } finally {
      await reopened.dispose()
    }
  })

  it('rejects invalid Patrol scheduling mutations without changing durable state', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000046')
    const missingWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000047')
    const mounted = await mount(path)
    try {
      await expect(mounted.ctx.taskboard.getPatrolPolicy(missingWorkspaceId)).resolves.toBeUndefined()
      await expect(mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId: missingWorkspaceId,
        enabled: true,
        expectedVersion: 1,
      })).rejects.toMatchObject({ code: 'workspace_not_found' })
      await expect(mounted.ctx.taskboard.beginPatrolRun({
        workspaceId: missingWorkspaceId,
        trigger: 'manual',
      })).rejects.toMatchObject({ code: 'workspace_not_found' })

      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Guarded Patrol' })
      const initial = await mounted.ctx.taskboard.getPatrolPolicy(workspaceId)
      await expect(mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: true,
        baseBranch: 'main',
        expectedVersion: 99,
      })).rejects.toMatchObject({ code: 'version_conflict' })
      await expect(mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: false,
        interval: '1h',
        expectedVersion: initial!.version,
      })).resolves.toEqual(initial)
      await expect(mounted.ctx.taskboard.beginPatrolRun({
        workspaceId,
        trigger: 'scheduled',
      })).rejects.toMatchObject({ code: 'patrol_not_due' })

      const enabled = await mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: true,
        baseBranch: 'main',
        expectedVersion: initial!.version,
      })
      await expect(mounted.ctx.taskboard.beginPatrolRun({
        workspaceId,
        trigger: 'scheduled',
      })).rejects.toMatchObject({ code: 'patrol_not_due' })
      await expect(mounted.ctx.taskboard.getPatrolPolicy(workspaceId)).resolves.toEqual(enabled)
      await expect(mounted.ctx.taskboard.listPatrolRuns(workspaceId)).resolves.toEqual([])
    } finally {
      await mounted.dispose()
    }
  })

  it('keeps an active Run through disablement and records its terminal error', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000048')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Active Patrol' })
      const policy = await mounted.ctx.taskboard.getPatrolPolicy(workspaceId)
      const enabled = await mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: true,
        baseBranch: 'main',
        expectedVersion: policy!.version,
      })
      const run = await mounted.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'manual' })
      await mounted.ctx.taskboard.updatePatrolPolicy({
        workspaceId,
        enabled: false,
        expectedVersion: enabled.version,
      })
      await expect(mounted.ctx.taskboard.listPatrolRuns(workspaceId)).resolves.toMatchObject([
        { id: run.id, state: 'active' },
      ])

      const completed = await mounted.ctx.taskboard.completePatrolRun({
        runId: run.id,
        result: 'failed',
        error: 'Provider unavailable',
      })
      expect(completed).toMatchObject({
        state: 'completed',
        result: 'failed',
        error: 'Provider unavailable',
      })
      await expect(mounted.ctx.taskboard.completePatrolRun({
        runId: PatrolRunId('missing-run'),
        result: 'failed',
      })).rejects.toMatchObject({ code: 'patrol_run_not_active' })
    } finally {
      await mounted.dispose()
    }
  })

  it('atomically claims a todo Issue and persists its exact Session and Git binding through review handoff', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000049')
    const sessionId = SessionId('session-patrol-49')
    const mounted = await mount(path)
    let issue!: Issue
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Patrol Execution' })
      issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Implement claim', status: 'todo' })
      const run = await mounted.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'manual' })
      const attempt = await mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: issue.id,
        expectedVersion: issue.version,
        dependencyCommits: {},
        actor: patrolActor,
      })
      expect(attempt).toMatchObject({ issueId: issue.id, sessionId: null, state: 'active', result: null })
      await expect(mounted.ctx.taskboard.getIssue(issue.id)).resolves.toMatchObject({
        status: 'in_progress',
        assignee: 'patrol_agent',
        version: 2,
      })

      const context = await mounted.ctx.taskboard.bindPatrolDevelopmentContext({
        attemptId: attempt.id,
        context: {
          sessionId,
          baseBranch: 'main',
          branch: 'dsh-task/patrol-49',
          worktreePath: '/tmp/dsh-patrol-49',
          agentPreset: 'coding',
          provider: 'deepseek-official',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
          permissionPreset: 'workspace-write',
        },
      })
      expect(context).toMatchObject({ issueId: issue.id, sessionId, sessionStartedAt: null, resultCommit: null })
      const startedContext = await mounted.ctx.taskboard.markPatrolSessionStarted(attempt.id)
      expect(startedContext.sessionStartedAt).not.toBeNull()
      await expect(mounted.ctx.taskboard.listPatrolAttempts(run.id)).resolves.toMatchObject([
        { id: attempt.id, sessionId, state: 'active' },
      ])

      const review = await mounted.ctx.taskboard.recordPatrolReview({
        attemptId: attempt.id,
        sessionId: SessionId('session-patrol-reviewer-49'),
        reviewedCommit: 'fedcba9876543210',
        verdict: 'changes_requested',
        findings: 'Handle the empty branch case before handoff.',
        verification: ['pnpm test -- taskboard'],
        risks: ['The integration branch is user-owned.'],
      })
      expect(review).toMatchObject({
        issueId: issue.id,
        reviewedCommit: 'fedcba9876543210',
        verdict: 'changes_requested',
        verification: ['pnpm test -- taskboard'],
      })
      await expect(mounted.ctx.taskboard.listPatrolReviews(issue.identifier)).resolves.toEqual([review])
      await expect(mounted.ctx.taskboard.recordPatrolReview({
        attemptId: attempt.id,
        sessionId: SessionId('another-reviewer'),
        reviewedCommit: 'fedcba9876543210',
        verdict: 'approve',
        findings: 'No findings.',
        verification: [],
        risks: [],
      })).rejects.toMatchObject({ code: 'patrol_review_exists' })

      const completed = await mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: attempt.id,
        result: 'review_handoff',
        resultCommit: '0123456789abcdef',
        actor: patrolActor,
      })
      expect(completed).toMatchObject({ state: 'completed', result: 'review_handoff', error: null })
      await expect(mounted.ctx.taskboard.getIssue(issue.id)).resolves.toMatchObject({ status: 'in_review' })
      await expect(mounted.ctx.taskboard.getPatrolDevelopmentContext(issue.identifier)).resolves.toMatchObject({
        sessionId,
        baseBranch: 'main',
        branch: 'dsh-task/patrol-49',
        worktreePath: '/tmp/dsh-patrol-49',
        resultCommit: '0123456789abcdef',
      })
      await mounted.ctx.taskboard.completePatrolRun({ runId: run.id, result: 'review_handoff' })
    } finally {
      await mounted.dispose()
    }

    const reopened = await mount(path)
    try {
      await expect(reopened.ctx.taskboard.getPatrolDevelopmentContext(issue.id)).resolves.toMatchObject({
        sessionId,
        resultCommit: '0123456789abcdef',
      })
      await expect(reopened.ctx.taskboard.listPatrolReviews(issue.id)).resolves.toMatchObject([
        { sessionId: 'session-patrol-reviewer-49', verdict: 'changes_requested' },
      ])
    } finally {
      await reopened.dispose()
    }
  })

  it('allows another todo claim only after a permission-blocked Attempt becomes terminal', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000050')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Approval Skip' })
      const first = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Needs approval', status: 'todo' })
      const second = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Can proceed', status: 'todo' })
      const third = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Must wait for another Run', status: 'todo' })
      const run = await mounted.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'manual' })
      const firstAttempt = await mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: first.id,
        expectedVersion: first.version,
        dependencyCommits: {},
        actor: patrolActor,
      })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: second.id,
        expectedVersion: second.version,
        dependencyCommits: {},
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await mounted.ctx.taskboard.bindPatrolDevelopmentContext({
        attemptId: firstAttempt.id,
        context: {
          sessionId: SessionId('session-patrol-50-a'),
          baseBranch: 'main',
          branch: 'dsh-task/patrol-50-a',
          worktreePath: '/tmp/dsh-patrol-50-a',
          agentPreset: 'coding',
          provider: 'p',
          model: 'm',
          reasoningEffort: null,
          permissionPreset: 'workspace-write',
        },
      })
      await mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: firstAttempt.id,
        result: 'permission_blocked',
        error: 'bash requested full filesystem access',
        actor: patrolActor,
      })
      await expect(mounted.ctx.taskboard.getIssue(first.id)).resolves.toMatchObject({ status: 'blocked' })
      await expect(mounted.ctx.taskboard.listComments(first.id)).resolves.toMatchObject([
        { body: 'bash requested full filesystem access', actor: patrolActor },
      ])

      const secondAttempt = await mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: second.id,
        expectedVersion: second.version,
        dependencyCommits: {},
        actor: patrolActor,
      })
      expect(secondAttempt.issueId).toBe(second.id)
      await expect(mounted.ctx.taskboard.listPatrolAttempts(run.id)).resolves.toMatchObject([
        { issueId: first.id, result: 'permission_blocked' },
        { issueId: second.id, state: 'active' },
      ])
      await mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: secondAttempt.id,
        result: 'blocked',
        error: 'the implementation cannot proceed without user input',
        actor: patrolActor,
      })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: third.id,
        expectedVersion: third.version,
        dependencyCommits: {},
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
    } finally {
      await mounted.dispose()
    }
  })

  it('requires done dependency commit snapshots and refuses User-assigned todo work', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000051')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Patrol Eligibility' })
      const userIssue = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Human-owned',
        status: 'todo',
        assignee: 'user',
      })
      const blocker = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Foundation', status: 'todo' })
      const dependent = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Dependent', status: 'todo' })
      const related = await mounted.ctx.taskboard.addRelation({
        reference: dependent.id,
        type: 'blocked_by',
        relatedReference: blocker.id,
        expectedVersion: dependent.version,
        actor,
      })
      const run = await mounted.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'manual' })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: userIssue.id,
        expectedVersion: userIssue.version,
        dependencyCommits: {},
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: dependent.id,
        expectedVersion: related.issue.version,
        dependencyCommits: {},
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })

      const blockerAttempt = await mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: blocker.id,
        expectedVersion: blocker.version,
        dependencyCommits: {},
        actor: patrolActor,
      })
      await mounted.ctx.taskboard.bindPatrolDevelopmentContext({
        attemptId: blockerAttempt.id,
        context: {
          sessionId: SessionId('session-patrol-dependency'),
          baseBranch: 'main',
          branch: 'dsh-task/patrol-dependency',
          worktreePath: '/tmp/dsh-patrol-dependency',
          agentPreset: 'coding',
          provider: 'p',
          model: 'm',
          reasoningEffort: null,
          permissionPreset: 'workspace-write',
        },
      })
      const resultCommit = '1234567890abcdef'
      await mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: blockerAttempt.id,
        result: 'review_handoff',
        resultCommit,
        actor: patrolActor,
      })
      await mounted.ctx.taskboard.completePatrolRun({ runId: run.id, result: 'review_handoff' })
      const reviewedBlocker = await mounted.ctx.taskboard.getIssue(blocker.id)
      await mounted.ctx.taskboard.updateIssue({
        reference: blocker.id,
        status: 'done',
        expectedVersion: reviewedBlocker!.version,
        actor,
      })

      const integratedRun = await mounted.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'manual' })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: integratedRun.id,
        reference: dependent.id,
        expectedVersion: related.issue.version,
        dependencyCommits: {},
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: integratedRun.id,
        reference: dependent.id,
        expectedVersion: related.issue.version,
        dependencyCommits: { [blocker.id]: resultCommit, extra: resultCommit },
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: integratedRun.id,
        reference: dependent.id,
        expectedVersion: related.issue.version,
        dependencyCommits: { [blocker.id]: resultCommit },
        actor: patrolActor,
      })).resolves.toMatchObject({ issueId: dependent.id, state: 'active' })
    } finally {
      await mounted.dispose()
    }
  })

  it('rolls back invalid Patrol claims, bindings, Session starts, and Attempt completions', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000052')
    const otherWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000053')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Patrol Rejections' })
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: otherWorkspaceId, title: 'Other Patrol' })
      const candidate = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Patrol-owned todo',
        status: 'todo',
        assignee: 'patrol_agent',
      })
      const backlog = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Backlog', status: 'backlog' })
      const archived = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Archived', status: 'todo' })
      const archivedIssue = await mounted.ctx.taskboard.archiveIssue({
        reference: archived.id,
        expectedVersion: archived.version,
        actor,
      })
      const other = await mounted.ctx.taskboard.createIssue({
        workspaceId: otherWorkspaceId,
        title: 'Other Workspace',
        status: 'todo',
      })
      const run = await mounted.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'manual' })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: PatrolRunId('missing-run'),
        reference: candidate.id,
        expectedVersion: candidate.version,
        dependencyCommits: {},
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_run_not_active' })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: IssueId('missing-issue'),
        expectedVersion: 1,
        dependencyCommits: {},
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'issue_not_found' })
      await expect(mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: candidate.id,
        expectedVersion: 99,
        dependencyCommits: {},
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'version_conflict' })
      for (const invalid of [
        { issue: backlog, version: backlog.version },
        { issue: archivedIssue, version: archivedIssue.version },
        { issue: other, version: other.version },
      ]) {
        await expect(mounted.ctx.taskboard.claimPatrolIssue({
          runId: run.id,
          reference: invalid.issue.id,
          expectedVersion: invalid.version,
          dependencyCommits: {},
          actor: patrolActor,
        })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      }

      const claimed = await mounted.ctx.taskboard.claimPatrolIssue({
        runId: run.id,
        reference: candidate.id,
        expectedVersion: candidate.version,
        dependencyCommits: {},
        actor: patrolActor,
      })
      await expect(mounted.ctx.taskboard.getPatrolDevelopmentContext(candidate.id)).resolves.toBeUndefined()
      const missingAttempt = PatrolAttemptId('missing-attempt')
      await expect(mounted.ctx.taskboard.markPatrolSessionStarted(missingAttempt))
        .rejects.toMatchObject({ code: 'patrol_attempt_not_active' })
      await expect(mounted.ctx.taskboard.markPatrolSessionStarted(claimed.id))
        .rejects.toMatchObject({ code: 'patrol_context_missing' })
      const validContext = {
        sessionId: SessionId('session-patrol-rejections'),
        baseBranch: 'main',
        branch: 'dsh-task/patrol-rejections',
        worktreePath: '/tmp/dsh-patrol-rejections',
        agentPreset: 'coding',
        provider: 'p',
        model: 'm',
        reasoningEffort: null,
        permissionPreset: 'workspace-write',
      }
      await expect(mounted.ctx.taskboard.bindPatrolDevelopmentContext({
        attemptId: missingAttempt,
        context: validContext,
      })).rejects.toMatchObject({ code: 'patrol_attempt_not_active' })
      await expect(mounted.ctx.taskboard.bindPatrolDevelopmentContext({
        attemptId: claimed.id,
        context: { ...validContext, branch: ' ' },
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await expect(mounted.ctx.taskboard.bindPatrolDevelopmentContext({
        attemptId: claimed.id,
        context: { ...validContext, agentPreset: ' ' },
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await mounted.ctx.taskboard.bindPatrolDevelopmentContext({ attemptId: claimed.id, context: validContext })
      await expect(mounted.ctx.taskboard.recordPatrolReview({
        attemptId: claimed.id,
        sessionId: validContext.sessionId,
        reviewedCommit: 'commit',
        verdict: 'approve',
        findings: 'No findings.',
        verification: [],
        risks: [],
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await expect(mounted.ctx.taskboard.recordPatrolReview({
        attemptId: claimed.id,
        sessionId: SessionId('reviewer-invalid'),
        reviewedCommit: ' ',
        verdict: 'approve',
        findings: 'No findings.',
        verification: [],
        risks: [],
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await expect(mounted.ctx.taskboard.bindPatrolDevelopmentContext({
        attemptId: claimed.id,
        context: validContext,
      })).rejects.toMatchObject({ code: 'patrol_context_exists' })
      const started = await mounted.ctx.taskboard.markPatrolSessionStarted(claimed.id)
      const startedAgain = await mounted.ctx.taskboard.markPatrolSessionStarted(claimed.id)
      expect(startedAgain.sessionStartedAt).toBe(started.sessionStartedAt)
      await expect(mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: claimed.id,
        result: 'review_handoff',
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await expect(mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: claimed.id,
        result: 'blocked',
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
      await mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: claimed.id,
        result: 'blocked',
        error: 'requires user input',
        actor: patrolActor,
      })
      await expect(mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: claimed.id,
        result: 'blocked',
        error: 'second completion',
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_attempt_not_active' })
      await expect(mounted.ctx.taskboard.markPatrolSessionStarted(claimed.id))
        .rejects.toMatchObject({ code: 'patrol_attempt_not_active' })
      await mounted.ctx.taskboard.completePatrolRun({ runId: run.id, result: 'blocked' })

      const noContextIssue = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'No context',
        status: 'todo',
      })
      const noContextRun = await mounted.ctx.taskboard.beginPatrolRun({ workspaceId, trigger: 'manual' })
      const noContextAttempt = await mounted.ctx.taskboard.claimPatrolIssue({
        runId: noContextRun.id,
        reference: noContextIssue.id,
        expectedVersion: noContextIssue.version,
        dependencyCommits: {},
        actor: patrolActor,
      })
      await expect(mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: noContextAttempt.id,
        result: 'review_handoff',
        resultCommit: 'abcdef',
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_context_missing' })
      const claimedIssue = await mounted.ctx.taskboard.getIssue(noContextIssue.id)
      await mounted.ctx.taskboard.updateIssue({
        reference: noContextIssue.id,
        status: 'blocked',
        expectedVersion: claimedIssue!.version,
        actor,
      })
      await expect(mounted.ctx.taskboard.completePatrolAttempt({
        attemptId: noContextAttempt.id,
        result: 'blocked',
        error: 'stale owner',
        actor: patrolActor,
      })).rejects.toMatchObject({ code: 'patrol_issue_ineligible' })
    } finally {
      await mounted.dispose()
    }
  })
  it('contains synchronous and asynchronous Taskboard observers after commit', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000031')
    const mounted = await mount(path)
    const changed: string[] = []
    const warnings: string[] = []
    mounted.ctx.logger.warn = ((message: unknown) => { warnings.push(String(message)) }) as typeof mounted.ctx.logger.warn
    mounted.ctx.on('taskboard/changed', () => { throw new Error('sync observer') })
    mounted.ctx.on('taskboard/changed', () => Promise.reject(new Error('async observer')) as never)
    mounted.ctx.on('taskboard/changed', (id) => { changed.push(id) })
    try {
      await expect(mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Contained Board' }))
        .resolves.toMatchObject({ workspaceId })
      await Promise.resolve()
      expect(changed).toEqual([workspaceId])
      expect(warnings).toEqual([
        'taskboard/changed listener threw: Error: sync observer',
        'taskboard/changed listener rejected: Error: async observer',
      ])
    } finally {
      await mounted.dispose()
    }
  })

  it('publishes successful durable changes by owning Workspace without reporting reads or failed writes', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000030')
    const mounted = await mount(path)
    const changed: string[] = []
    mounted.ctx.on('taskboard/changed', (id) => { changed.push(id) })
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Live Board' })
      await mounted.ctx.taskboard.getWorkspace(workspaceId)
      await mounted.ctx.taskboard.listIssues({ workspaceId })
      const created = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Visible work' })
      const updated = await mounted.ctx.taskboard.updateIssue({
        reference: created.id,
        status: 'todo',
        expectedVersion: created.version,
        actor,
      })
      await expect(mounted.ctx.taskboard.updateIssue({
        reference: created.id,
        status: 'done',
        expectedVersion: created.version,
        actor,
      })).rejects.toMatchObject({ code: 'version_conflict' })
      await mounted.ctx.taskboard.addComment({ reference: created.id, body: 'Live note', actor })
      await mounted.ctx.taskboard.archiveIssue({
        reference: created.id,
        expectedVersion: updated.version,
        actor,
      })

      expect(changed).toEqual([workspaceId, workspaceId, workspaceId, workspaceId, workspaceId])
    } finally {
      await mounted.dispose()
    }
  })

  it('creates the first backlog Issue and retrieves it after reopening the store', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000001')
    const first = await mount(path)
    let created!: Issue
    try {
      await first.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Alpha Project' })
      created = await first.ctx.taskboard.createIssue({ workspaceId, title: 'Ship the first slice' })

      expect(created).toMatchObject({
        identifier: 'ALPHAPROJECT-1',
        workspaceId,
        title: 'Ship the first slice',
        description: '',
        status: 'backlog',
        priority: 'none',
        labels: [],
        sortOrder: 1000,
        version: 1,
        archivedAt: null,
      })
      expect(created.createdAt).toBe(created.updatedAt)
      expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false)
      await expect(first.ctx.taskboard.getIssue(created.id)).resolves.toEqual(created)
    } finally {
      await first.dispose()
    }

    const reopened = await mount(path)
    try {
      await expect(reopened.ctx.taskboard.getIssue(created.identifier)).resolves.toEqual(created)
    } finally {
      await reopened.dispose()
    }
  })

  it('allows a unique prefix change before the first Issue and freezes it afterward', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000002')
    const mounted = await mount(path)
    try {
      const initial = await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Harness Core' })

      const renamed = await mounted.ctx.taskboard.setWorkspacePrefix({
        workspaceId,
        prefix: 'CORE',
        expectedVersion: initial.version,
      })
      expect(renamed).toMatchObject({ prefix: 'CORE', version: 2 })

      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Freeze the prefix' })
      expect(issue.identifier).toBe('CORE-1')
      const afterCreate = await mounted.ctx.taskboard.getWorkspace(workspaceId)
      await expect(mounted.ctx.taskboard.setWorkspacePrefix({
        workspaceId,
        prefix: 'CHANGED',
        expectedVersion: afterCreate!.version,
      })).rejects.toMatchObject({ code: 'prefix_frozen' })
      await expect(mounted.ctx.taskboard.getWorkspace(workspaceId))
        .resolves.toMatchObject({ prefix: 'CORE' })
    } finally {
      await mounted.dispose()
    }
  })

  it('rejects invalid and duplicate Workspace prefixes before writing', async () => {
    const path = await databasePath()
    const firstWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000022')
    const secondWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000023')
    const mounted = await mount(path)
    try {
      const first = await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: firstWorkspaceId, title: 'Prefix One' })
      const second = await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: secondWorkspaceId, title: 'Prefix Two' })

      await expect(mounted.ctx.taskboard.setWorkspacePrefix({
        workspaceId: firstWorkspaceId,
        prefix: 'not-valid',
        expectedVersion: first.version,
      })).rejects.toMatchObject({ code: 'invalid_prefix' })
      await expect(mounted.ctx.taskboard.setWorkspacePrefix({
        workspaceId: firstWorkspaceId,
        prefix: second.prefix,
        expectedVersion: first.version,
      })).rejects.toMatchObject({ code: 'prefix_exists' })
      await expect(mounted.ctx.taskboard.getWorkspace(firstWorkspaceId)).resolves.toEqual(first)
    } finally {
      await mounted.dispose()
    }
  })

  it('rejects incompatible and unidentified SQLite files during initialization', async () => {
    const unversionedPath = await databasePath()
    const unversioned = new DatabaseSync(unversionedPath)
    unversioned.exec('CREATE TABLE foreign_data (value TEXT)')
    unversioned.close()
    await expect(mount(unversionedPath)).rejects.toThrow('unversioned schema or application identity')

    const newerPath = await databasePath()
    const newer = new DatabaseSync(newerPath)
    newer.exec('PRAGMA user_version = 99')
    newer.close()
    await expect(mount(newerPath)).rejects.toThrow('schema version 99')

    const foreignPath = await databasePath()
    const foreign = new DatabaseSync(foreignPath)
    foreign.exec('PRAGMA user_version = 4; PRAGMA application_id = 1234')
    foreign.close()
    await expect(mount(foreignPath)).rejects.toThrow('application id 1234')
  })

  it('creates owner-only durable paths and supports an in-memory store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-taskboard-private-'))
    tempDirs.push(root)
    const directory = join(root, 'state')
    const path = join(directory, 'taskboard.db')
    const durable = await mount(path)
    await durable.dispose()
    expect((await stat(directory)).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)

    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000024')
    const memory = await mount(':memory:')
    try {
      await memory.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Memory Work' })
      await expect(memory.ctx.taskboard.createIssue({ workspaceId, title: 'Ephemeral' }))
        .resolves.toMatchObject({ identifier: 'MEMORYWORK-1' })
    } finally {
      await memory.dispose()
    }
  })

  it('returns stable errors for missing records and invalid restore transitions', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000025')
    const missingWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000026')
    const missingIssueId = IssueId('00000000-0000-4000-8000-000000000027')
    const mounted = await mount(path)
    try {
      await expect(mounted.ctx.taskboard.createIssue({
        workspaceId: missingWorkspaceId,
        title: 'Missing Workspace',
      })).rejects.toMatchObject({ code: 'workspace_not_found' })

      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Failure Work' })
      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Active Issue' })
      await expect(mounted.ctx.taskboard.updateIssue({
        reference: missingIssueId,
        status: 'todo',
        expectedVersion: 1,
        actor,
      })).rejects.toMatchObject({ code: 'issue_not_found' })
      await expect(mounted.ctx.taskboard.restoreIssue({
        reference: issue.id,
        expectedVersion: issue.version,
        actor,
      })).rejects.toMatchObject({ code: 'issue_not_archived' })
      await expect(mounted.ctx.taskboard.removeRelation({
        reference: issue.id,
        relationId: RelationId('00000000-0000-4000-8000-000000000028'),
        expectedVersion: issue.version,
        actor,
      })).rejects.toMatchObject({ code: 'relation_not_found' })
    } finally {
      await mounted.dispose()
    }
  })

  it('allocates a deterministic unique prefix when Workspace titles collide', async () => {
    const path = await databasePath()
    const firstWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000003')
    const secondWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000004')
    const mounted = await mount(path)
    try {
      const first = await mounted.ctx.taskboard.ensureWorkspace({
        workspaceId: firstWorkspaceId,
        title: 'Alpha Project',
      })
      const second = await mounted.ctx.taskboard.ensureWorkspace({
        workspaceId: secondWorkspaceId,
        title: 'Alpha Project',
      })

      expect([first.prefix, second.prefix]).toEqual(['ALPHAPROJECT', 'ALPHAPROJEC2'])
      const firstIssue = await mounted.ctx.taskboard.createIssue({
        workspaceId: firstWorkspaceId,
        title: 'First Workspace Issue',
      })
      const secondIssue = await mounted.ctx.taskboard.createIssue({
        workspaceId: secondWorkspaceId,
        title: 'Second Workspace Issue',
      })
      expect([firstIssue.identifier, secondIssue.identifier])
        .toEqual(['ALPHAPROJECT-1', 'ALPHAPROJEC2-1'])
    } finally {
      await mounted.dispose()
    }
  })

  it('creates directly authorized todo Issues in manual order without priority reordering', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000005')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Ordered Work' })
      const first = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Keep first behind the new card',
        status: 'todo',
        priority: 'low',
      })
      const second = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Manual top card',
        description: 'Explicitly authorized work',
        status: 'todo',
        priority: 'urgent',
        labels: ['feature'],
        assignee: 'user',
        startDate: '2026-08-18',
        dueDate: '2026-08-21',
      })

      expect(second).toMatchObject({
        description: 'Explicitly authorized work',
        status: 'todo',
        priority: 'urgent',
        labels: ['feature'],
        assignee: 'user',
        startDate: '2026-08-18',
        dueDate: '2026-08-21',
      })
      await expect(mounted.ctx.taskboard.listIssues({ workspaceId, status: 'todo' }))
        .resolves.toEqual([second, first])
    } finally {
      await mounted.dispose()
    }
  })

  it('changes status only from the caller-observed Issue version', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000006')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Concurrent Work' })
      const issue = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Protect concurrent edits',
      })

      const updated = await mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        status: 'todo',
        expectedVersion: issue.version,
        actor,
      })
      expect(updated).toMatchObject({ status: 'todo', version: 2 })

      await expect(mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        status: 'done',
        expectedVersion: issue.version,
        actor,
      })).rejects.toMatchObject({ code: 'version_conflict' })
      await expect(mounted.ctx.taskboard.getIssue(issue.id)).resolves.toEqual(updated)
    } finally {
      await mounted.dispose()
    }
  })

  it('reorders one Issue by its explicit board position', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000007')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Drag Board' })
      const first = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'First', status: 'todo' })
      const second = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Second', status: 'todo' })
      const third = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Third', status: 'todo' })

      const reordered = await mounted.ctx.taskboard.updateIssue({
        reference: first.id,
        status: 'todo',
        sortOrder: (third.sortOrder + second.sortOrder) / 2,
        expectedVersion: first.version,
        actor,
      })

      expect(reordered.version).toBe(2)
      await expect(mounted.ctx.taskboard.listIssues({ workspaceId, status: 'todo' }))
        .resolves.toEqual([third, reordered, second])
    } finally {
      await mounted.dispose()
    }
  })

  it('archives without deletion and restores the same Issue', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000008')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Archive Work' })
      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Keep history' })

      const archived = await mounted.ctx.taskboard.archiveIssue({
        reference: issue.id,
        expectedVersion: issue.version,
        actor,
      })
      expect(archived).toMatchObject({ id: issue.id, version: 2 })
      expect(archived.archivedAt).not.toBeNull()
      await expect(mounted.ctx.taskboard.listIssues({ workspaceId })).resolves.toEqual([])
      await expect(mounted.ctx.taskboard.getIssue(issue.id)).resolves.toEqual(archived)
      await expect(mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        status: 'todo',
        expectedVersion: archived.version,
        actor,
      })).rejects.toMatchObject({ code: 'issue_archived' })

      const restored = await mounted.ctx.taskboard.restoreIssue({
        reference: issue.identifier,
        expectedVersion: archived.version,
        actor,
      })
      expect(restored).toMatchObject({ id: issue.id, version: 3, archivedAt: null })
      await expect(mounted.ctx.taskboard.listIssues({ workspaceId })).resolves.toEqual([restored])
      await expect(mounted.ctx.taskboard.listActivities(issue.id)).resolves.toMatchObject([
        { changes: [{ field: 'archivedAt', before: null, after: archived.archivedAt }] },
        { changes: [{ field: 'archivedAt', before: archived.archivedAt, after: null }] },
      ])
    } finally {
      await mounted.dispose()
    }
  })

  it('moves an Issue between Workspaces without changing its identifier', async () => {
    const path = await databasePath()
    const sourceWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000009')
    const targetWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000010')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: sourceWorkspaceId, title: 'Source' })
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: targetWorkspaceId, title: 'Target' })
      const targetExisting = await mounted.ctx.taskboard.createIssue({
        workspaceId: targetWorkspaceId,
        title: 'Existing target work',
        status: 'todo',
      })
      const issue = await mounted.ctx.taskboard.createIssue({
        workspaceId: sourceWorkspaceId,
        title: 'Portable work',
        status: 'todo',
        labels: ['portable', 'feature'],
      })

      const moved = await mounted.ctx.taskboard.moveIssue({
        reference: issue.id,
        targetWorkspaceId,
        expectedVersion: issue.version,
        actor,
      })

      expect(moved).toMatchObject({
        id: issue.id,
        identifier: issue.identifier,
        workspaceId: targetWorkspaceId,
        labels: ['portable', 'feature'],
        version: 2,
      })
      await expect(mounted.ctx.taskboard.listIssues({ workspaceId: sourceWorkspaceId })).resolves.toEqual([])
      await expect(mounted.ctx.taskboard.listIssues({ workspaceId: targetWorkspaceId, status: 'todo' }))
        .resolves.toEqual([moved, targetExisting])
      await expect(mounted.ctx.taskboard.listActivities(issue.id)).resolves.toMatchObject([
        {
          changes: [{
            field: 'workspaceId',
            before: sourceWorkspaceId,
            after: targetWorkspaceId,
          }],
        },
      ])
    } finally {
      await mounted.dispose()
    }
  })

  it('rejects moving an Issue when the move would leave a cross-Workspace relation', async () => {
    const path = await databasePath()
    const sourceWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000029')
    const targetWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000030')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: sourceWorkspaceId, title: 'Related Source' })
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: targetWorkspaceId, title: 'Related Target' })
      const blocker = await mounted.ctx.taskboard.createIssue({ workspaceId: sourceWorkspaceId, title: 'Blocker' })
      const blocked = await mounted.ctx.taskboard.createIssue({ workspaceId: sourceWorkspaceId, title: 'Blocked' })
      const related = await mounted.ctx.taskboard.addRelation({
        reference: blocker.id,
        type: 'blocks',
        relatedReference: blocked.id,
        expectedVersion: blocker.version,
        actor,
      })

      await expect(mounted.ctx.taskboard.moveIssue({
        reference: blocker.id,
        targetWorkspaceId,
        expectedVersion: related.issue.version,
        actor,
      })).rejects.toMatchObject({ code: 'relation_cross_workspace' })
      await expect(mounted.ctx.taskboard.getIssue(blocker.id))
        .resolves.toMatchObject({ workspaceId: sourceWorkspaceId, version: related.issue.version })
      await expect(mounted.ctx.taskboard.listRelations(blocker.id)).resolves.toEqual([related.relation])
    } finally {
      await mounted.dispose()
    }
  })

  it('appends attributed comments and retains their order after restart', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000011')
    const mounted = await mount(path)
    let issue!: Issue
    let comments
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Comment Work' })
      issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Discuss this' })
      const first = await mounted.ctx.taskboard.addComment({ reference: issue.id, body: 'First note', actor })
      const second = await mounted.ctx.taskboard.addComment({
        reference: issue.identifier,
        body: 'Second note',
        actor,
      })

      comments = [first, second]
      expect(first).toMatchObject({ issueId: issue.id, body: 'First note', actor })
      await expect(mounted.ctx.taskboard.listComments(issue.id)).resolves.toEqual(comments)
    } finally {
      await mounted.dispose()
    }

    const reopened = await mount(path)
    try {
      await expect(reopened.ctx.taskboard.listComments(issue.identifier)).resolves.toEqual(comments)
    } finally {
      await reopened.dispose()
    }
  })

  it('persists distinct Patrol, Reviewer, and System actor roles', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000031')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Attributed Work' })
      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Keep actor roles' })
      const reviewer = {
        type: 'reviewer' as const,
        id: TaskboardActorId('reviewer-1'),
        name: 'Independent Reviewer',
        avatarUrl: 'https://example.test/reviewer.png',
      }
      const patrol = {
        type: 'patrol_agent' as const,
        id: TaskboardActorId('patrol-1'),
        name: 'Patrol Agent',
        avatarUrl: 'https://example.test/patrol.png',
      }
      const system = {
        type: 'system' as const,
        id: TaskboardActorId('taskboard-system'),
        name: 'Taskboard System',
      }

      await mounted.ctx.taskboard.addComment({ reference: issue.id, body: 'Review finding', actor: reviewer })
      const updated = await mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        status: 'todo',
        expectedVersion: issue.version,
        actor: patrol,
      })
      await mounted.ctx.taskboard.archiveIssue({
        reference: issue.id,
        expectedVersion: updated.version,
        actor: system,
      })

      await expect(mounted.ctx.taskboard.listComments(issue.id)).resolves.toMatchObject([{ actor: reviewer }])
      await expect(mounted.ctx.taskboard.listActivities(issue.id)).resolves.toMatchObject([
        { actor: patrol },
        { actor: system },
      ])
    } finally {
      await mounted.dispose()
    }
  })

  it('appends attributed field changes to Issue activity', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000012')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Audited Work' })
      await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Existing todo', status: 'todo' })
      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Track changes' })
      const updated = await mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        status: 'todo',
        expectedVersion: issue.version,
        actor,
      })

      const activities = await mounted.ctx.taskboard.listActivities(issue.identifier)
      expect(activities).toHaveLength(1)
      expect(activities[0]).toMatchObject({
        issueId: issue.id,
        actor,
        changes: [
          { field: 'status', before: 'backlog', after: 'todo' },
          { field: 'sortOrder', before: 1000, after: 0 },
        ],
      })
      expect(Number.isNaN(Date.parse(activities[0]!.createdAt))).toBe(false)
      expect(updated.version).toBe(2)
    } finally {
      await mounted.dispose()
    }
  })

  it('stores blocks and blocked_by as two views of one directed relation', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000013')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Dependent Work' })
      const blocker = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Build foundation' })
      const blocked = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Use foundation' })

      const result = await mounted.ctx.taskboard.addRelation({
        reference: blocked.id,
        type: 'blocked_by',
        relatedReference: blocker.identifier,
        expectedVersion: blocked.version,
        actor,
      })

      expect(result.issue.version).toBe(2)
      expect(result.relation).toMatchObject({
        type: 'blocked_by',
        issueId: blocked.id,
        relatedIssueId: blocker.id,
      })
      await expect(mounted.ctx.taskboard.listRelations(blocked.id)).resolves.toEqual([result.relation])
      await expect(mounted.ctx.taskboard.listRelations(blocker.id)).resolves.toMatchObject([
        { id: result.relation.id, type: 'blocks', issueId: blocker.id, relatedIssueId: blocked.id },
      ])
      await expect(mounted.ctx.taskboard.listWorkspaceRelations(workspaceId)).resolves.toMatchObject([
        { id: result.relation.id, type: 'blocks', issueId: blocker.id, relatedIssueId: blocked.id },
      ])
      await expect(mounted.ctx.taskboard.addRelation({
        reference: blocked.id,
        type: 'blocked_by',
        relatedReference: blocker.id,
        expectedVersion: result.issue.version,
        actor,
      })).rejects.toMatchObject({ code: 'relation_exists' })
    } finally {
      await mounted.dispose()
    }
  })

  it('rejects a self-blocking relation', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000014')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Self Relation' })
      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Cannot block itself' })

      await expect(mounted.ctx.taskboard.addRelation({
        reference: issue.id,
        type: 'blocks',
        relatedReference: issue.identifier,
        expectedVersion: issue.version,
        actor,
      })).rejects.toMatchObject({ code: 'relation_self' })
      await expect(mounted.ctx.taskboard.listRelations(issue.id)).resolves.toEqual([])
    } finally {
      await mounted.dispose()
    }
  })

  it('rejects dependency relations across Workspaces', async () => {
    const path = await databasePath()
    const firstWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000015')
    const secondWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000016')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: firstWorkspaceId, title: 'First Space' })
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: secondWorkspaceId, title: 'Second Space' })
      const first = await mounted.ctx.taskboard.createIssue({ workspaceId: firstWorkspaceId, title: 'First work' })
      const second = await mounted.ctx.taskboard.createIssue({ workspaceId: secondWorkspaceId, title: 'Second work' })

      await expect(mounted.ctx.taskboard.addRelation({
        reference: first.id,
        type: 'blocks',
        relatedReference: second.id,
        expectedVersion: first.version,
        actor,
      })).rejects.toMatchObject({ code: 'relation_cross_workspace' })
    } finally {
      await mounted.dispose()
    }
  })

  it('rejects a dependency cycle', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000017')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Acyclic Work' })
      const first = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'First' })
      const second = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Second' })
      const third = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Third' })
      await mounted.ctx.taskboard.addRelation({
        reference: first.id,
        type: 'blocks',
        relatedReference: second.id,
        expectedVersion: first.version,
        actor,
      })
      await mounted.ctx.taskboard.addRelation({
        reference: second.id,
        type: 'blocks',
        relatedReference: third.id,
        expectedVersion: second.version,
        actor,
      })

      await expect(mounted.ctx.taskboard.addRelation({
        reference: third.id,
        type: 'blocks',
        relatedReference: first.id,
        expectedVersion: third.version,
        actor,
      })).rejects.toMatchObject({ code: 'relation_cycle' })
      await expect(mounted.ctx.taskboard.listRelations(third.id)).resolves.toMatchObject([
        { type: 'blocked_by', relatedIssueId: second.id },
      ])
    } finally {
      await mounted.dispose()
    }
  })

  it('removes a dependency while retaining its Activity history', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000018')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Mutable Dependencies' })
      const blocker = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Blocker' })
      const blocked = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Blocked' })
      const added = await mounted.ctx.taskboard.addRelation({
        reference: blocked.id,
        type: 'blocked_by',
        relatedReference: blocker.id,
        expectedVersion: blocked.version,
        actor,
      })

      const updated = await mounted.ctx.taskboard.removeRelation({
        reference: blocked.id,
        relationId: added.relation.id,
        expectedVersion: added.issue.version,
        actor,
      })

      expect(updated.version).toBe(3)
      await expect(mounted.ctx.taskboard.listRelations(blocked.id)).resolves.toEqual([])
      await expect(mounted.ctx.taskboard.listActivities(blocked.id)).resolves.toMatchObject([
        { changes: [{ field: 'relation', before: null, after: {
          type: 'blocked_by', relatedIssueId: blocker.id,
        } }] },
        { changes: [{ field: 'relation', before: {
          type: 'blocked_by', relatedIssueId: blocker.id,
        }, after: null }] },
      ])
    } finally {
      await mounted.dispose()
    }
  })

  it('requires and appends a reason when returning reviewed work to todo', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000019')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Review Feedback' })
      const issue = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Address review',
        status: 'in_review',
      })

      await expect(mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        status: 'todo',
        expectedVersion: issue.version,
        actor,
      })).rejects.toMatchObject({ code: 'reason_required' })

      const returned = await mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        status: 'todo',
        expectedVersion: issue.version,
        reason: 'Please cover the empty-input case.',
        actor,
      })
      expect(returned).toMatchObject({ status: 'todo', version: 2 })
      await expect(mounted.ctx.taskboard.listComments(issue.id)).resolves.toMatchObject([
        { body: 'Please cover the empty-input case.', actor },
      ])
    } finally {
      await mounted.dispose()
    }
  })

  it('updates editable Issue fields and records their before and after values', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000020')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Editable Work' })
      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Draft title' })

      const updated = await mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        expectedVersion: issue.version,
        actor,
        title: 'Final title',
        description: 'Detailed scope',
        priority: 'high',
        labels: ['frontend', 'v1'],
        assignee: 'patrol_agent',
        startDate: '2026-08-20',
        dueDate: '2026-08-25',
      })

      expect(updated).toMatchObject({
        title: 'Final title',
        description: 'Detailed scope',
        status: 'backlog',
        priority: 'high',
        labels: ['frontend', 'v1'],
        assignee: 'patrol_agent',
        startDate: '2026-08-20',
        dueDate: '2026-08-25',
        version: 2,
      })
      await expect(mounted.ctx.taskboard.listActivities(issue.id)).resolves.toMatchObject([
        { changes: [
          { field: 'title', before: 'Draft title', after: 'Final title' },
          { field: 'description', before: '', after: 'Detailed scope' },
          { field: 'priority', before: 'none', after: 'high' },
          { field: 'labels', before: [], after: ['frontend', 'v1'] },
          { field: 'assignee', before: 'unassigned', after: 'patrol_agent' },
          { field: 'startDate', before: null, after: '2026-08-20' },
          { field: 'dueDate', before: null, after: '2026-08-25' },
        ] },
      ])
    } finally {
      await mounted.dispose()
    }
  })

  it('treats an Issue update with no changed fields as a no-op', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000044')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'No-op Work' })
      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Already current' })

      await expect(mounted.ctx.taskboard.updateIssue({
        reference: issue.id,
        title: issue.title,
        expectedVersion: issue.version,
        actor,
      })).resolves.toEqual(issue)
      await expect(mounted.ctx.taskboard.listActivities(issue.id)).resolves.toEqual([])
    } finally {
      await mounted.dispose()
    }
  })

  it('searches Issue text and filters metadata including archived records', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000021')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Queryable Work' })
      const first = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Launch Taskboard',
        description: 'Prepare the first release',
        status: 'todo',
        priority: 'urgent',
        labels: ['feature', 'frontend'],
        assignee: 'user',
        startDate: '2026-08-20',
        dueDate: '2026-08-25',
      })
      const second = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Document filters',
        description: 'Include launch search examples',
        status: 'backlog',
        priority: 'low',
        labels: ['docs'],
      })
      const third = await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Routine maintenance',
        status: 'todo',
        priority: 'low',
        labels: ['docs'],
      })

      await expect(mounted.ctx.taskboard.listIssues({ workspaceId, query: 'LAUNCH' }))
        .resolves.toEqual([second, first])
      await expect(mounted.ctx.taskboard.listIssues({
        workspaceId,
        status: 'todo',
        priority: 'urgent',
        label: 'feature',
        assignee: 'user',
        startDate: '2026-08-20',
        dueDate: '2026-08-25',
      })).resolves.toEqual([first])

      const archived = await mounted.ctx.taskboard.archiveIssue({
        reference: first.id,
        expectedVersion: first.version,
        actor,
      })
      await expect(mounted.ctx.taskboard.listIssues({ workspaceId, archived: 'only' }))
        .resolves.toEqual([archived])
      await expect(mounted.ctx.taskboard.listIssues({ workspaceId, archived: 'include' }))
        .resolves.toEqual([second, third, archived])
    } finally {
      await mounted.dispose()
    }
  })

  it('stores reusable Workspace Labels through ordered Issue-label rows', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000043')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Normalized Labels' })
      await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'First labeled Issue',
        labels: ['feature', 'frontend'],
      })
      await mounted.ctx.taskboard.createIssue({
        workspaceId,
        title: 'Second labeled Issue',
        labels: ['feature'],
      })
    } finally {
      await mounted.dispose()
    }

    const db = new DatabaseSync(path)
    try {
      const issueColumns = db.prepare("SELECT name FROM pragma_table_info('issues') ORDER BY cid")
        .all() as unknown as { name: string }[]
      expect(issueColumns.map(column => column.name)).not.toContain('labels')
      expect(db.prepare('SELECT name FROM labels ORDER BY name').all()).toEqual([
        { name: 'feature' },
        { name: 'frontend' },
      ])
      expect(db.prepare('SELECT COUNT(*) AS count FROM issue_labels').get()).toEqual({ count: 3 })
    } finally {
      db.close()
    }
  })

  it('applies Provider defaults and propagates filesystem creation failures', async () => {
    const path = await databasePath()
    const mounted = await mount(path, {})
    await mounted.dispose()
    const defaultDatabase = new DatabaseSync(path)
    try {
      expect(defaultDatabase.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    } finally {
      defaultDatabase.close()
    }

    const root = await mkdtemp(join(tmpdir(), 'dsh-taskboard-long-path-'))
    tempDirs.push(root)
    await expect(mount(join(root, 'x'.repeat(300))))
      .rejects.toMatchObject({ code: 'ENAMETOOLONG' })
  })

  it('handles Taskboard lookup, idempotence, prefix fallback, and prefix conflicts', async () => {
    const path = await databasePath()
    const firstWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000032')
    const secondWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000033')
    const thirdWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000034')
    const missingWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000035')
    const mounted = await mount(path)
    try {
      await expect(mounted.ctx.taskboard.getWorkspace(missingWorkspaceId)).resolves.toBeUndefined()
      await expect(mounted.ctx.taskboard.setWorkspacePrefix({
        workspaceId: missingWorkspaceId,
        prefix: 'MISSING',
        expectedVersion: 1,
      })).rejects.toMatchObject({ code: 'workspace_not_found' })

      const first = await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: firstWorkspaceId, title: '!!!' })
      await expect(mounted.ctx.taskboard.ensureWorkspace({ workspaceId: firstWorkspaceId, title: 'Renamed' }))
        .resolves.toEqual(first)
      await expect(mounted.ctx.taskboard.setWorkspacePrefix({
        workspaceId: firstWorkspaceId,
        prefix: 'FIRST',
        expectedVersion: first.version + 1,
      })).rejects.toMatchObject({ code: 'version_conflict' })
      const second = await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: secondWorkspaceId, title: '???' })
      const third = await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: thirdWorkspaceId, title: '...' })
      expect([first.prefix, second.prefix, third.prefix]).toEqual(['TASK', 'TASK2', 'TASK3'])
    } finally {
      await mounted.dispose()
    }
  })

  it('returns stable move and archive conflicts without partial writes', async () => {
    const path = await databasePath()
    const sourceWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000036')
    const targetWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000037')
    const missingWorkspaceId = WorkspaceId('00000000-0000-4000-8000-000000000038')
    const missingIssueId = IssueId('00000000-0000-4000-8000-000000000039')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: sourceWorkspaceId, title: 'Move Source' })
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId: targetWorkspaceId, title: 'Move Target' })
      const issue = await mounted.ctx.taskboard.createIssue({ workspaceId: sourceWorkspaceId, title: 'Move safely' })

      await expect(mounted.ctx.taskboard.moveIssue({
        reference: missingIssueId,
        targetWorkspaceId,
        expectedVersion: 1,
        actor,
      })).rejects.toMatchObject({ code: 'issue_not_found' })
      await expect(mounted.ctx.taskboard.moveIssue({
        reference: issue.id,
        targetWorkspaceId,
        expectedVersion: issue.version + 1,
        actor,
      })).rejects.toMatchObject({ code: 'version_conflict' })
      await expect(mounted.ctx.taskboard.moveIssue({
        reference: issue.id,
        targetWorkspaceId: missingWorkspaceId,
        expectedVersion: issue.version,
        actor,
      })).rejects.toMatchObject({ code: 'workspace_not_found' })
      await expect(mounted.ctx.taskboard.moveIssue({
        reference: issue.id,
        targetWorkspaceId: sourceWorkspaceId,
        expectedVersion: issue.version,
        actor,
      })).resolves.toEqual(issue)

      await expect(mounted.ctx.taskboard.archiveIssue({
        reference: missingIssueId,
        expectedVersion: 1,
        actor,
      })).rejects.toMatchObject({ code: 'issue_not_found' })
      await expect(mounted.ctx.taskboard.archiveIssue({
        reference: issue.id,
        expectedVersion: issue.version + 1,
        actor,
      })).rejects.toMatchObject({ code: 'version_conflict' })
      const archived = await mounted.ctx.taskboard.archiveIssue({
        reference: issue.id,
        expectedVersion: issue.version,
        actor,
      })
      await expect(mounted.ctx.taskboard.archiveIssue({
        reference: issue.id,
        expectedVersion: archived.version,
        actor,
      })).rejects.toMatchObject({ code: 'issue_archived' })
      const moved = await mounted.ctx.taskboard.moveIssue({
        reference: archived.id,
        targetWorkspaceId,
        expectedVersion: archived.version,
        actor,
      })
      expect(moved).toMatchObject({ workspaceId: targetWorkspaceId, sortOrder: archived.sortOrder })
      const active = await mounted.ctx.taskboard.createIssue({ workspaceId: sourceWorkspaceId, title: 'Active move' })
      await expect(mounted.ctx.taskboard.moveIssue({
        reference: active.id,
        targetWorkspaceId,
        expectedVersion: active.version,
        actor,
      })).resolves.toMatchObject({ workspaceId: targetWorkspaceId, sortOrder: 1000 })
    } finally {
      await mounted.dispose()
    }
  })

  it('returns stable relation lookup and version conflicts', async () => {
    const path = await databasePath()
    const workspaceId = WorkspaceId('00000000-0000-4000-8000-000000000040')
    const missingIssueId = IssueId('00000000-0000-4000-8000-000000000041')
    const mounted = await mount(path)
    try {
      await mounted.ctx.taskboard.ensureWorkspace({ workspaceId, title: 'Relation Errors' })
      const first = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'First' })
      const second = await mounted.ctx.taskboard.createIssue({ workspaceId, title: 'Second' })

      await expect(mounted.ctx.taskboard.addRelation({
        reference: missingIssueId,
        type: 'blocks',
        relatedReference: second.id,
        expectedVersion: 1,
        actor,
      })).rejects.toMatchObject({ code: 'issue_not_found' })
      await expect(mounted.ctx.taskboard.addRelation({
        reference: first.id,
        type: 'blocks',
        relatedReference: missingIssueId,
        expectedVersion: first.version,
        actor,
      })).rejects.toMatchObject({ code: 'issue_not_found' })
      await expect(mounted.ctx.taskboard.addRelation({
        reference: first.id,
        type: 'blocks',
        relatedReference: second.id,
        expectedVersion: first.version + 1,
        actor,
      })).rejects.toMatchObject({ code: 'version_conflict' })

      const relation = await mounted.ctx.taskboard.addRelation({
        reference: first.id,
        type: 'blocks',
        relatedReference: second.id,
        expectedVersion: first.version,
        actor,
      })
      await expect(mounted.ctx.taskboard.removeRelation({
        reference: missingIssueId,
        relationId: relation.relation.id,
        expectedVersion: 1,
        actor,
      })).rejects.toMatchObject({ code: 'issue_not_found' })
      await expect(mounted.ctx.taskboard.removeRelation({
        reference: first.id,
        relationId: relation.relation.id,
        expectedVersion: relation.issue.version + 1,
        actor,
      })).rejects.toMatchObject({ code: 'version_conflict' })
      await expect(mounted.ctx.taskboard.getIssue(missingIssueId)).resolves.toBeUndefined()
      await expect(mounted.ctx.taskboard.listComments(missingIssueId))
        .rejects.toMatchObject({ code: 'issue_not_found' })
    } finally {
      await mounted.dispose()
    }
  })

  it('rejects Service use before the Provider lifecycle initializes it', async () => {
    const service = new SqliteTaskboard(new Context(), { path: ':memory:' })
    await expect(service.getIssue(IssueId('00000000-0000-4000-8000-000000000042')))
      .rejects.toThrow('not initialized')
  })
})
