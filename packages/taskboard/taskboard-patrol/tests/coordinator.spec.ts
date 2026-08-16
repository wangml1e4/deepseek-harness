import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  IssueId,
  IssueIdentifier,
  PatrolAttemptId,
  PatrolRunId,
  TaskboardError,
  type Issue,
  type PatrolAttempt,
  type PatrolDevelopmentContext,
  type PatrolPolicy,
  type PatrolProviderError,
  type PatrolReview,
  type PatrolRun,
  type PatrolTokenUsage,
} from '@deepseek-ai/dsh-taskboard'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { PatrolCoordinator } from '../src/coordinator.ts'
import type { PatrolAgentLease, TaskboardPatrolService } from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const workspaceId = WorkspaceId('workspace-coordinator')
const NOW = '2026-08-16T00:00:00.000Z'

function issue(name: string, overrides: Partial<Issue> = {}): Issue {
  return {
    id: IssueId(name),
    identifier: IssueIdentifier(name.toUpperCase()),
    workspaceId,
    title: name,
    description: '',
    status: 'todo',
    priority: 'none',
    labels: [],
    assignee: 'unassigned',
    startDate: null,
    dueDate: null,
    sortOrder: 1000,
    version: 1,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function policy(overrides: Partial<PatrolPolicy> = {}): PatrolPolicy {
  return {
    workspaceId,
    enabled: false,
    interval: '1h',
    baseBranch: 'main',
    agentPreset: 'coding',
    provider: 'deepseek',
    model: 'deepseek-chat',
    reasoningEffort: null,
    permissionPreset: 'workspace-write',
    nextDueAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function development(value: Issue): PatrolDevelopmentContext {
  return {
    issueId: value.id,
    sessionId: SessionId(`session-${value.id}`),
    sessionStartedAt: NOW,
    baseBranch: 'main',
    branch: `dsh-task/${value.identifier.toLowerCase()}`,
    worktreePath: `/worktrees/${value.identifier.toLowerCase()}`,
    agentPreset: 'coding',
    provider: 'deepseek',
    model: 'deepseek-chat',
    reasoningEffort: null,
    permissionPreset: 'workspace-write',
    resultCommit: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function agent(
  reasons: readonly ('completed' | 'interrupted' | 'error' | 'none')[] = ['completed'],
  onTurn?: (turn: number) => void,
  usages: readonly PatrolTokenUsage[] = [],
  providerError?: PatrolProviderError,
): Agent {
  const events: unknown[] = []
  let turn = 0
  const value = {
    id: SessionId('session-agent'),
    session: { id: SessionId('session-agent'), events },
    status: 'idle',
    followup: () => {
      turn += 1
      onTurn?.(turn)
      const reason = reasons[turn - 1] ?? reasons.at(-1) ?? 'completed'
      const usage = usages[turn - 1]
      if (usage !== undefined) {
        events.push({
          type: 'assistant/message',
          data: { turn, step: 1, message: { role: 'assistant', content: [] }, usage },
        })
      }
      if (reason === 'error') {
        events.push({
          type: 'assistant/chunk',
          data: {
            turn,
            step: 1,
            chunk: {
              type: 'finish',
              reason: {
                kind: 'error',
                failure: providerError ?? { message: 'Provider failed', code: 'UNKNOWN' },
              },
            },
          },
        })
      }
      if (reason !== 'none') {
        events.push({
          type: 'turn/end',
          data: {
            turn,
            reason: reason === 'error'
              ? { kind: 'error', error: providerError ?? { message: 'Provider failed', code: 'UNKNOWN' } }
              : { kind: reason },
          },
        })
      }
    },
    whenIdle: () => Promise.resolve(),
    cancel: vi.fn(),
  }
  return value as unknown as Agent
}

interface HarnessOptions {
  readonly issues: Issue[]
  readonly comments?: Readonly<Record<string, string>>
  readonly relations?: Readonly<Record<string, readonly string[]>>
  readonly contexts?: Readonly<Record<string, PatrolDevelopmentContext>>
  readonly permissionBlocked?: ReadonlySet<string>
  readonly permissionWithoutReason?: ReadonlySet<string>
  readonly correctionBlocked?: ReadonlySet<string>
  readonly turnReasons?: readonly ('completed' | 'interrupted' | 'error' | 'none')[]
  readonly turnUsages?: readonly PatrolTokenUsage[]
  readonly providerError?: PatrolProviderError
  readonly result?: { readonly clean: boolean; readonly changedFromBase: boolean }
  readonly results?: readonly { readonly clean: boolean; readonly changedFromBase: boolean }[]
  readonly resultHeads?: readonly string[]
  readonly reviewVerdict?: PatrolReview['verdict']
  readonly missingPolicy?: boolean
  readonly policy?: PatrolPolicy
  readonly claimErrors?: Readonly<Record<string, unknown>>
  readonly disappearAfterClaim?: ReadonlySet<string>
  readonly missingWorkspace?: boolean
  readonly relationDirection?: Readonly<Record<string, 'blocks' | 'blocked_by'>>
  readonly duePolicies?: readonly PatrolPolicy[]
  readonly completeRunError?: unknown
  readonly prepareError?: unknown
  readonly reviews?: readonly PatrolReview[]
  readonly persistedEvents?: Readonly<Record<string, readonly SessionEvent[]>>
}

function harness(options: HarnessOptions) {
  const ctx = new Context()
  contexts.push(ctx)
  const savedPolicy = options.policy ?? policy()
  const issues = options.issues
  const runs: PatrolRun[] = []
  const attempts: PatrolAttempt[] = []
  const completedRuns: Array<{ result: string; error?: string }> = []
  const completedAttempts: Array<{
    issueId: string
    result: string
    error?: string
    tokenUsage?: PatrolTokenUsage
    providerError?: PatrolProviderError
  }> = []
  const released: string[] = []
  const turns: string[] = []
  const storedReviews = [...(options.reviews ?? [])]
  const taskboard = {
    getPatrolPolicy: () => Promise.resolve(options.missingPolicy ? undefined : savedPolicy),
    listIssues: () => Promise.resolve(issues.filter(value => value.status === 'todo')),
    getIssue: (reference: string) => Promise.resolve(issues.find(value => value.id === reference || value.identifier === reference)),
    listComments: (reference: string) => Promise.resolve(
      options.comments?.[reference] === undefined ? [] : [{ body: options.comments[reference] }],
    ),
    listRelations: (reference: string) => Promise.resolve((options.relations?.[reference] ?? []).map((relatedIssueId, index) => ({
      id: `relation-${index}`,
      type: options.relationDirection?.[reference] ?? 'blocked_by',
      issueId: reference,
      relatedIssueId,
      createdAt: NOW,
    }))),
    getPatrolDevelopmentContext: (reference: string) => Promise.resolve(options.contexts?.[reference]),
    beginPatrolRun: ({ trigger }: { trigger: PatrolRun['trigger'] }) => {
      const run: PatrolRun = {
        id: PatrolRunId(`run-${runs.length + 1}`),
        workspaceId,
        trigger,
        scheduledFor: trigger === 'scheduled' ? NOW : null,
        state: 'active',
        result: null,
        error: null,
        tokenUsage: null,
        providerError: null,
        recoveryCount: 0,
        lastRecoveredAt: null,
        startedAt: NOW,
        endedAt: null,
      }
      runs.push(run)
      return Promise.resolve(run)
    },
    claimPatrolIssue: ({ reference, runId }: { reference: string; runId: PatrolRunId }) => {
      if (Object.hasOwn(options.claimErrors ?? {}, reference)) throw options.claimErrors?.[reference]
      const value = issues.find(candidate => candidate.id === reference)
      if (value === undefined || value.status !== 'todo') {
        throw new TaskboardError('patrol_issue_ineligible', 'changed while scanning')
      }
      Object.assign(value, { status: 'in_progress', assignee: 'patrol_agent', version: value.version + 1 })
      const attempt: PatrolAttempt = {
        id: PatrolAttemptId(`attempt-${attempts.length + 1}`),
        runId,
        issueId: value.id,
        sessionId: null,
        state: 'active',
        result: null,
        error: null,
        tokenUsage: null,
        providerError: null,
        startedAt: NOW,
        endedAt: null,
      }
      attempts.push(attempt)
      if (options.disappearAfterClaim?.has(value.id)) issues.splice(issues.indexOf(value), 1)
      return Promise.resolve(attempt)
    },
    completePatrolAttempt: (input: {
      attemptId: PatrolAttemptId
      result: string
      error?: string
      tokenUsage?: PatrolTokenUsage
      providerError?: PatrolProviderError
    }) => {
      const attempt = attempts.find(value => value.id === input.attemptId)!
      const value = issues.find(candidate => candidate.id === attempt.issueId)!
      Object.assign(attempt, { state: 'completed', result: input.result, error: input.error ?? null })
      Object.assign(value, { status: input.result === 'review_handoff' ? 'in_review' : 'blocked' })
      completedAttempts.push({
        issueId: value.id,
        result: input.result,
        ...input.error === undefined ? {} : { error: input.error },
        ...input.tokenUsage === undefined ? {} : { tokenUsage: input.tokenUsage },
        ...input.providerError === undefined ? {} : { providerError: input.providerError },
      })
      return Promise.resolve(attempt)
    },
    completePatrolRun: (input: { runId: PatrolRunId; result: string; error?: string }) => {
      if (options.completeRunError !== undefined) throw options.completeRunError
      const run = runs.find(value => value.id === input.runId)!
      Object.assign(run, { state: 'completed', result: input.result, error: input.error ?? null })
      completedRuns.push({ result: input.result, ...input.error === undefined ? {} : { error: input.error } })
      return Promise.resolve(run)
    },
    getActivePatrolRun: () => Promise.resolve(runs.find(value => value.state === 'active')),
    recordPatrolRecovery: (runId: PatrolRunId) => {
      const run = runs.find(value => value.id === runId)!
      Object.assign(run, { recoveryCount: run.recoveryCount + 1, lastRecoveredAt: NOW })
      return Promise.resolve(run)
    },
    failPatrolRecovery: (input: {
      runId: PatrolRunId
      attemptId: PatrolAttemptId
      error: string
      tokenUsage?: PatrolTokenUsage
      providerError?: PatrolProviderError
    }) => {
      const run = runs.find(value => value.id === input.runId)!
      const attempt = attempts.find(value => value.id === input.attemptId)!
      const value = issues.find(candidate => candidate.id === attempt.issueId)
      Object.assign(attempt, { state: 'completed', result: 'failed', error: input.error })
      Object.assign(run, { state: 'completed', result: 'failed', error: input.error })
      if (value !== undefined) Object.assign(value, { status: 'blocked' })
      completedAttempts.push({
        issueId: attempt.issueId,
        result: 'failed',
        error: input.error,
        ...input.tokenUsage === undefined ? {} : { tokenUsage: input.tokenUsage },
        ...input.providerError === undefined ? {} : { providerError: input.providerError },
      })
      completedRuns.push({ result: 'failed', error: input.error })
      return Promise.resolve(run)
    },
    listPatrolAttempts: (runId: PatrolRunId) => Promise.resolve(attempts.filter(value => value.runId === runId)),
    listPatrolReviews: (reference: string) => Promise.resolve(storedReviews.filter(value => value.issueId === reference)),
    recordPatrolReview: (input: Omit<PatrolReview, 'issueId' | 'createdAt'>) => {
      const review = {
        ...input,
        issueId: attempts.find(value => value.id === input.attemptId)!.issueId,
        createdAt: NOW,
      }
      storedReviews.push(review)
      return Promise.resolve(review)
    },
    listDuePatrolPolicies: () => Promise.resolve(options.duePolicies ?? []),
  }
  ctx.provide('taskboard', taskboard as never)
  ctx.provide('sessionPersistence', {
    load: (id: SessionId) => Promise.resolve({ events: options.persistedEvents?.[id] ?? [] }),
  } as never)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => !options.missingWorkspace && id === workspaceId
      ? { id, path: '/workspace', title: 'Workspace' }
      : undefined,
    list: () => [],
  } as never)
  let resultCalls = 0
  const host = {
    defaults: () => Promise.resolve({ baseBranch: 'main' }),
    isAncestor: (_workspaceId: WorkspaceId, commit: string) => Promise.resolve(commit !== 'unintegrated'),
    prepare: vi.fn(async (_attempt: PatrolAttempt, value: Issue): Promise<PatrolAgentLease> => {
      if (options.prepareError !== undefined) throw options.prepareError
      const context = options.contexts?.[value.id] ?? development(value)
      const rejectedApprovals = options.permissionBlocked?.has(value.id)
        ? [{
          toolName: 'bash',
          ...options.permissionWithoutReason?.has(value.id) ? {} : { reason: 'outside workspace' },
        }]
        : []
      return {
        agent: agent(options.turnReasons, (turn) => {
          turns.push(`${value.id}:${turn}`)
          if (turn === 2 && options.correctionBlocked?.has(value.id)) rejectedApprovals.push({ toolName: 'write' })
        }, options.turnUsages, options.providerError),
        context,
        worktree: { root: context.worktreePath, sessionCwd: context.worktreePath },
        rejectedApprovals,
        release: () => { released.push(value.id); return Promise.resolve() },
      }
    }),
    result: vi.fn(() => {
      const resultIndex = resultCalls
      const selected = options.results?.[Math.min(resultIndex, options.results.length - 1)] ?? options.result
      resultCalls += 1
      return Promise.resolve({
        head: options.resultHeads?.[Math.min(resultIndex, options.resultHeads.length - 1)] ?? 'abc123',
        clean: selected?.clean ?? true,
        changedFromBase: selected?.changedFromBase ?? true,
      })
    }),
    diff: () => Promise.resolve({ patch: '+change', stat: '1 file changed' }),
  }
  const coordinator = new PatrolCoordinator(ctx, host as unknown as TaskboardPatrolService)
  const review = vi.fn((_attempt: PatrolAttempt, value: Issue) => Promise.resolve({
    sessionId: SessionId(`session-review-${value.id}`),
    reviewedCommit: 'abc123',
    verdict: options.reviewVerdict ?? 'approve',
    findings: 'No findings.',
    verification: [],
    risks: [],
  }))
  ;(coordinator as unknown as { reviewer: { review: typeof review } }).reviewer = { review }
  return {
    ctx, coordinator, taskboard, host, review, completedRuns, completedAttempts,
    released, runs, attempts, turns,
  }
}

describe('PatrolCoordinator', () => {
  it('skips explicit waits and dependencies until it hands one reviewed Issue to the human', async () => {
    const waiting = issue('waiting', { title: 'Waiting for design', sortOrder: 0 })
    const commented = issue('commented', { sortOrder: 1 })
    const blocker = issue('blocker', { status: 'done', sortOrder: 2 })
    const unintegrated = issue('unintegrated', { status: 'done', sortOrder: 3 })
    const blocked = issue('blocked', { sortOrder: 4 })
    const ready = issue('ready', { sortOrder: 5 })
    const test = harness({
      issues: [waiting, commented, blocker, unintegrated, blocked, ready],
      comments: { [commented.id]: '暂缓' },
      relations: { [blocked.id]: [unintegrated.id], [ready.id]: [blocker.id] },
      contexts: {
        [blocker.id]: { ...development(blocker), resultCommit: 'integrated' },
        [unintegrated.id]: { ...development(unintegrated), resultCommit: 'unintegrated' },
      },
    })

    await test.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })

    expect(test.completedRuns).toEqual([{ result: 'review_handoff' }])
    expect(test.completedAttempts).toEqual([{ issueId: ready.id, result: 'review_handoff' }])
    expect(test.review).toHaveBeenCalledOnce()
    expect(test.released).toEqual([ready.id])
    expect(ready.status).toBe('in_review')
  })

  it('continues only after permission approval blocks the current Issue', async () => {
    const first = issue('first', { sortOrder: 0 })
    const second = issue('second', { sortOrder: 1 })
    const test = harness({ issues: [first, second], permissionBlocked: new Set([first.id]) })

    await test.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })

    expect(test.completedAttempts).toEqual([
      { issueId: first.id, result: 'permission_blocked', error: 'Patrol skipped unattended approval: bash (outside workspace)' },
      { issueId: second.id, result: 'review_handoff' },
    ])
    expect(test.completedRuns).toEqual([{ result: 'review_handoff' }])
  })

  it('ends blocked after the only eligible Issue requests approval without a reason', async () => {
    const value = issue('approval-only')
    const test = harness({
      issues: [value],
      permissionBlocked: new Set([value.id]),
      permissionWithoutReason: new Set([value.id]),
    })
    await test.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })
    expect(test.completedAttempts).toEqual([{
      issueId: value.id,
      result: 'permission_blocked',
      error: 'Patrol skipped unattended approval: bash',
    }])
    expect(test.completedRuns).toEqual([{
      result: 'blocked',
      error: '1 Issue(s) were blocked by tool permission approval',
    }])
  })

  it('treats an approval requested during remediation as the only continue condition', async () => {
    const value = issue('correction-approval')
    const test = harness({ issues: [value], correctionBlocked: new Set([value.id]) })
    await test.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })
    expect(test.review).toHaveBeenCalledOnce()
    expect(test.completedAttempts).toEqual([{
      issueId: value.id,
      result: 'permission_blocked',
      error: 'Patrol skipped unattended approval: write',
    }])
  })

  it('requires a new correction commit after Reviewer changes are requested', async () => {
    const unchangedIssue = issue('unchanged-correction')
    const unchanged = harness({ issues: [unchangedIssue], reviewVerdict: 'changes_requested' })
    await unchanged.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(unchanged.completedRuns).toHaveLength(1) })
    expect(unchanged.completedRuns[0]?.result).toBe('failed')
    expect(unchanged.completedRuns[0]?.error).toContain('did not commit requested corrections')

    const correctedIssue = issue('committed-correction')
    const corrected = harness({
      issues: [correctedIssue],
      reviewVerdict: 'changes_requested',
      resultHeads: ['preliminary123', 'corrected456'],
    })
    await corrected.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(corrected.completedRuns).toHaveLength(1) })
    expect(corrected.completedRuns).toEqual([{ result: 'review_handoff' }])
  })

  it('records no eligible work and honors an exact preferred Issue', async () => {
    const skipped = issue('skipped', { assignee: 'user' })
    const test = harness({ issues: [skipped] })
    await test.coordinator.trigger({ workspaceId, issue: IssueIdentifier('MISSING-1') })
    await vi.waitFor(() => { expect(test.completedRuns).toEqual([{ result: 'no_eligible_issue' }]) })
  })

  it('runs an exact existing preferred todo instead of scanning the earlier todo', async () => {
    const earlier = issue('earlier', { sortOrder: 0 })
    const preferred = issue('preferred', { sortOrder: 1 })
    const test = harness({ issues: [earlier, preferred] })
    await test.coordinator.trigger({ workspaceId, issue: preferred.identifier })
    await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })
    expect(test.completedAttempts).toEqual([{ issueId: preferred.id, result: 'review_handoff' }])
    expect(earlier.status).toBe('todo')
  })

  it('continues scanning after claim races reported by either eligibility code', async () => {
    const versioned = issue('versioned')
    const ineligible = issue('ineligible')
    const ready = issue('claim-ready')
    const test = harness({
      issues: [versioned, ineligible, ready],
      claimErrors: {
        [versioned.id]: new TaskboardError('version_conflict', 'raced'),
        [ineligible.id]: new TaskboardError('patrol_issue_ineligible', 'raced'),
      },
    })
    await test.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })
    expect(test.completedAttempts).toEqual([{ issueId: ready.id, result: 'review_handoff' }])
  })

  it('fails loud when a claim disappears or returns an unrelated domain error', async () => {
    const disappeared = issue('disappeared')
    const missing = harness({ issues: [disappeared], disappearAfterClaim: new Set([disappeared.id]) })
    await missing.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(missing.completedRuns).toHaveLength(1) })
    expect(missing.completedRuns[0]?.result).toBe('failed')
    expect(missing.completedRuns[0]?.error).toContain('disappeared')

    const rejected = issue('claim-rejected')
    const domain = harness({
      issues: [rejected],
      claimErrors: { [rejected.id]: new TaskboardError('workspace_not_found', 'wrong workspace') },
    })
    await domain.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(domain.completedRuns).toHaveLength(1) })
    expect(domain.completedRuns).toEqual([{ result: 'failed', error: 'wrong workspace' }])
  })

  it.each([
    [{ clean: false, changedFromBase: true }, 'uncommitted'],
    [{ clean: true, changedFromBase: false }, 'no committed change'],
  ] as const)('blocks a failed implementation and fails its Run for %s', async (result, message) => {
    const value = issue('failure')
    const test = harness({ issues: [value], result })
    await test.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })
    expect(test.completedAttempts[0]?.issueId).toBe(value.id)
    expect(test.completedAttempts[0]?.result).toBe('failed')
    expect(test.completedAttempts[0]?.error).toContain(message)
    expect(test.completedRuns[0]?.result).toBe('failed')
    expect(test.completedRuns[0]?.error).toContain(message)
  })

  it('fails a Run when the implementation turn does not close normally', async () => {
    const value = issue('interrupted')
    const test = harness({ issues: [value], turnReasons: ['interrupted'] })
    await test.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })
    expect(test.completedRuns[0]?.result).toBe('failed')
    expect(test.completedRuns[0]?.error).toContain('did not complete')
  })

  it('records model usage from every Attempt turn and retains a terminal Provider error', async () => {
    const successfulIssue = issue('usage')
    const successful = harness({
      issues: [successfulIssue],
      turnUsages: [
        { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4 },
        { inputTokens: 5, outputTokens: 1, reasoningTokens: 1 },
      ],
    })
    await successful.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(successful.completedRuns).toHaveLength(1) })
    expect(successful.completedAttempts).toEqual([{
      issueId: successfulIssue.id,
      result: 'review_handoff',
      tokenUsage: {
        inputTokens: 15,
        outputTokens: 3,
        cacheReadTokens: 4,
        reasoningTokens: 1,
      },
    }])

    const providerIssue = issue('provider-error')
    const providerError = {
      message: 'Provider is rate limited',
      code: 'RATE_LIMIT',
      status: 429,
      providerRetryAfterMs: 1_500,
      requestId: 'request-provider-error' as never,
    }
    const failed = harness({
      issues: [providerIssue],
      turnReasons: ['error'],
      turnUsages: [{ inputTokens: 7, outputTokens: 0 }],
      providerError,
    })
    await failed.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(failed.completedRuns).toHaveLength(1) })
    expect(failed.completedAttempts).toEqual([{
      issueId: providerIssue.id,
      result: 'failed',
      error: 'Provider is rate limited',
      tokenUsage: { inputTokens: 7, outputTokens: 0 },
      providerError,
    }])
    expect(failed.completedRuns).toEqual([{ result: 'failed', error: 'Provider is rate limited' }])
  })

  it('fails when the policy, Workspace, correction commit, or thrown value is invalid', async () => {
    const noPolicy = harness({ issues: [], missingPolicy: true })
    await noPolicy.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(noPolicy.completedRuns).toHaveLength(1) })
    expect(noPolicy.completedRuns[0]?.error).toContain('has no Taskboard Patrol Policy')

    const workspaceIssue = issue('missing-workspace')
    const noWorkspace = harness({ issues: [workspaceIssue], missingWorkspace: true })
    await noWorkspace.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(noWorkspace.completedRuns).toHaveLength(1) })
    expect(noWorkspace.completedRuns[0]?.error).toContain('is not registered')

    const correctionIssue = issue('bad-correction')
    const correction = harness({
      issues: [correctionIssue],
      results: [
        { clean: true, changedFromBase: true },
        { clean: false, changedFromBase: true },
      ],
    })
    await correction.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(correction.completedRuns).toHaveLength(1) })
    expect(correction.completedRuns[0]?.error).toContain('uncommitted')

    const thrownIssue = issue('non-error')
    const nonError = harness({ issues: [thrownIssue], prepareError: 'plain failure' })
    await nonError.coordinator.trigger({ workspaceId })
    await vi.waitFor(() => { expect(nonError.completedRuns).toHaveLength(1) })
    expect(nonError.completedRuns).toEqual([{ result: 'failed', error: 'plain failure' }])
  })

  it('covers every structural and dependency eligibility exclusion', async () => {
    type Internals = {
      eligible(value: Issue, id: WorkspaceId, saved: PatrolPolicy): Promise<unknown>
    }
    const otherWorkspace = WorkspaceId('other-workspace')
    const structural = harness({ issues: [] })
    const eligible = (structural.coordinator as unknown as Internals).eligible.bind(structural.coordinator)
    await expect(eligible(issue('other', { workspaceId: otherWorkspace }), workspaceId, policy())).resolves.toBeUndefined()
    await expect(eligible(issue('not-todo', { status: 'backlog' }), workspaceId, policy())).resolves.toBeUndefined()
    await expect(eligible(issue('archived', { archivedAt: NOW }), workspaceId, policy())).resolves.toBeUndefined()
    await expect(eligible(issue('user-owned', { assignee: 'user' }), workspaceId, policy())).resolves.toBeUndefined()
    await expect(eligible(issue('description-wait', { description: 'WAITING FOR input' }), workspaceId, policy()))
      .resolves.toBeUndefined()

    const ignoredRelation = issue('ignored-relation')
    const relationHarness = harness({
      issues: [ignoredRelation],
      relations: { [ignoredRelation.id]: [IssueId('irrelevant')] },
      relationDirection: { [ignoredRelation.id]: 'blocks' },
      policy: policy({ baseBranch: null }),
    })
    await expect((relationHarness.coordinator as unknown as Internals).eligible(
      ignoredRelation, workspaceId, policy({ baseBranch: null }),
    )).resolves.toMatchObject({ issue: ignoredRelation })

    const blockerCases = [
      { name: 'missing-blocker', blocker: undefined, binding: undefined },
      { name: 'unfinished-blocker', blocker: issue('unfinished', { status: 'todo' }), binding: development(issue('unused')) },
      { name: 'missing-binding', blocker: issue('done-no-binding', { status: 'done' }), binding: undefined },
      { name: 'null-commit', blocker: issue('done-null', { status: 'done' }), binding: development(issue('unused-null')) },
    ] as const
    for (const value of blockerCases) {
      const anchor = issue(value.name)
      const blockerId = value.blocker?.id ?? IssueId(`${value.name}-absent`)
      const contextsForCase = value.binding === undefined ? {} : {
        [blockerId]: { ...value.binding, issueId: blockerId, resultCommit: null },
      }
      const test = harness({
        issues: value.blocker === undefined ? [anchor] : [anchor, value.blocker],
        relations: { [anchor.id]: [blockerId] },
        contexts: contextsForCase,
      })
      await expect((test.coordinator as unknown as Internals).eligible(anchor, workspaceId, policy()))
        .resolves.toBeUndefined()
    }
  })

  it('consumes due fixed-interval triggers and stops future scheduling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const ctx = new Context()
    contexts.push(ctx)
    const due = policy({ enabled: true, nextDueAt: '2026-08-16T00:00:01.000Z' })
    const begin = vi.fn(() => Promise.resolve({
      id: PatrolRunId('scheduled-skip'), workspaceId, trigger: 'scheduled', scheduledFor: due.nextDueAt,
      state: 'completed', result: 'skipped_global_busy', error: null,
      tokenUsage: null, providerError: null,
      recoveryCount: 0, lastRecoveredAt: null, startedAt: NOW, endedAt: NOW,
    } satisfies PatrolRun))
    ctx.provide('taskboard', {
      getActivePatrolRun: () => Promise.resolve(undefined),
      getPatrolPolicy: () => Promise.resolve(due),
      listDuePatrolPolicies: () => Promise.resolve([due]),
      beginPatrolRun: begin,
    } as never)
    ctx.provide('workspaceRegistry', { list: () => [{ id: workspaceId }] } as never)
    const coordinator = new PatrolCoordinator(ctx, {} as TaskboardPatrolService)
    const stop = coordinator.start()
    await vi.advanceTimersByTimeAsync(0)
    ctx.emit('taskboard/changed', workspaceId)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(begin).toHaveBeenCalledWith({ workspaceId, trigger: 'scheduled' })
    stop()
    ctx.emit('taskboard/changed', workspaceId)
    type SchedulingInternals = { reschedule(): void; tick(): Promise<void> }
    ;(coordinator as unknown as SchedulingInternals).reschedule()
    await (coordinator as unknown as SchedulingInternals).tick()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(begin).toHaveBeenCalledOnce()
  })

  it('launches active scheduled Runs and records scheduler failures without escaping', async () => {
    type SchedulingInternals = { tick(): Promise<void> }
    const ready = issue('scheduled-ready')
    const active = harness({ issues: [ready], duePolicies: [policy({ enabled: true, nextDueAt: NOW })] })
    await (active.coordinator as unknown as SchedulingInternals).tick()
    await vi.waitFor(() => { expect(active.completedRuns).toHaveLength(1) })
    expect(active.runs[0]?.trigger).toBe('scheduled')

    const ctx = new Context()
    contexts.push(ctx)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    ctx.provide('taskboard', {
      getPatrolPolicy: () => Promise.resolve(policy({ enabled: true, nextDueAt: NOW })),
      listDuePatrolPolicies: () => Promise.reject(new Error('due read failed')),
    } as never)
    ctx.provide('workspaceRegistry', { list: () => [{ id: workspaceId }] } as never)
    const failed = new PatrolCoordinator(ctx, {} as TaskboardPatrolService)
    await (failed as unknown as SchedulingInternals).tick()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('scheduled trigger failed'))

    const scanCtx = new Context()
    contexts.push(scanCtx)
    const scanWarn = vi.spyOn(scanCtx.logger, 'warn').mockImplementation(() => undefined)
    scanCtx.provide('taskboard', {
      getActivePatrolRun: () => Promise.resolve(undefined),
      getPatrolPolicy: () => Promise.reject(new Error('policy read failed')),
    } as never)
    scanCtx.provide('workspaceRegistry', { list: () => [{ id: workspaceId }] } as never)
    const scan = new PatrolCoordinator(scanCtx, {} as TaskboardPatrolService)
    const stop = scan.start()
    await vi.waitFor(() => { expect(scanWarn).toHaveBeenCalledWith(expect.stringContaining('could not schedule')) })
    stop()

    const recoveryCtx = new Context()
    contexts.push(recoveryCtx)
    const recoveryError = vi.spyOn(recoveryCtx.logger, 'error').mockImplementation(() => undefined)
    recoveryCtx.provide('taskboard', {
      getActivePatrolRun: () => Promise.reject(new Error('active Run read failed')),
    } as never)
    const recovery = new PatrolCoordinator(recoveryCtx, {} as TaskboardPatrolService)
    const stopRecovery = recovery.start()
    await vi.waitFor(() => {
      expect(recoveryError).toHaveBeenCalledWith(expect.stringContaining('startup recovery failed before scheduling'))
    })
    stopRecovery()

    const stoppedCtx = new Context()
    contexts.push(stoppedCtx)
    let resolveActive!: (value: undefined) => void
    stoppedCtx.provide('taskboard', {
      getActivePatrolRun: () => new Promise<undefined>((resolve) => { resolveActive = resolve }),
    } as never)
    const stopped = new PatrolCoordinator(stoppedCtx, {} as TaskboardPatrolService)
    const stopBeforeRecovery = stopped.start()
    stopBeforeRecovery()
    resolveActive(undefined)
    await new Promise<void>((resolve) => { queueMicrotask(resolve) })
  })

  it('contains duplicate launches and a failure to persist the terminal Run state', async () => {
    type LaunchInternals = {
      executing: Set<string>
      launch(run: PatrolRun): void
    }
    const test = harness({ issues: [], missingPolicy: true, completeRunError: new Error('completion failed') })
    const error = vi.spyOn(test.ctx.logger, 'error').mockImplementation(() => undefined)
    const run = await test.taskboard.beginPatrolRun({ trigger: 'manual' })
    const internals = test.coordinator as unknown as LaunchInternals
    internals.executing.add(run.id)
    internals.launch(run)
    internals.executing.delete(run.id)
    internals.launch({ ...run, state: 'completed' })
    internals.launch(run)
    await vi.waitFor(() => { expect(error).toHaveBeenCalledWith(expect.stringContaining('could not be completed')) })
  })

  it('recovers an active Attempt before scheduling and reuses its recorded Reviewer evidence', async () => {
    const value = issue('recover-reviewed', { status: 'in_progress', assignee: 'patrol_agent', version: 2 })
    const context = development(value)
    const attemptId = PatrolAttemptId('attempt-recover-reviewed')
    const review: PatrolReview = {
      attemptId,
      issueId: value.id,
      sessionId: SessionId('session-review-recover-reviewed'),
      reviewedCommit: 'preliminary123',
      verdict: 'changes_requested',
      findings: 'Update the recovery path.',
      verification: ['pnpm test'],
      risks: [],
      createdAt: NOW,
    }
    const test = harness({
      issues: [value],
      contexts: { [value.id]: context },
      reviews: [review],
      resultHeads: ['corrected456'],
      turnUsages: [{ inputTokens: 3, outputTokens: 1 }],
      persistedEvents: {
        [context.sessionId]: [
          {
            type: 'assistant/chunk',
            seq: 0,
            time: Date.parse(NOW) - 1,
            data: {
              turn: 1,
              step: 1,
              chunk: { type: 'usage', usage: { inputTokens: 90, outputTokens: 90 } },
            },
          },
          {
            type: 'assistant/chunk',
            seq: 1,
            time: Date.parse(NOW),
            data: {
              turn: 2,
              step: 1,
              chunk: { type: 'usage', usage: { inputTokens: 11, outputTokens: 2 } },
            },
          },
        ],
        [review.sessionId]: [{
          type: 'assistant/chunk',
          seq: 0,
          time: Date.parse(NOW),
          data: {
            turn: 1,
            step: 1,
            chunk: { type: 'usage', usage: { inputTokens: 7, outputTokens: 1 } },
          },
        }],
      },
    })
    const run = await test.taskboard.beginPatrolRun({ trigger: 'manual' })
    test.attempts.push({
      id: attemptId,
      runId: run.id,
      issueId: value.id,
      sessionId: context.sessionId,
      state: 'active',
      result: null,
      error: null,
      tokenUsage: null,
      providerError: null,
      startedAt: NOW,
      endedAt: null,
    })

    const stop = test.coordinator.start()
    await vi.waitFor(() => { expect(test.completedRuns).toEqual([{ result: 'review_handoff' }]) })
    stop()

    expect(run).toMatchObject({ recoveryCount: 1, lastRecoveredAt: NOW })
    expect(test.review).not.toHaveBeenCalled()
    expect(test.turns).toEqual([`${value.id}:1`])
    expect(test.completedAttempts).toEqual([{
      issueId: value.id,
      result: 'review_handoff',
      tokenUsage: { inputTokens: 21, outputTokens: 4 },
    }])
  })

  it('continues an interrupted implementation in its exact Session before creating Reviewer evidence', async () => {
    const value = issue('recover-implementation', { status: 'in_progress', assignee: 'patrol_agent', version: 2 })
    const context = development(value)
    const test = harness({
      issues: [value],
      contexts: { [value.id]: context },
    })
    const run = await test.taskboard.beginPatrolRun({ trigger: 'manual' })
    test.attempts.push({
      id: PatrolAttemptId('attempt-recover-implementation'),
      runId: run.id,
      issueId: value.id,
      sessionId: context.sessionId,
      state: 'active',
      result: null,
      error: null,
      tokenUsage: null,
      providerError: null,
      startedAt: NOW,
      endedAt: null,
    })

    const stop = test.coordinator.start()
    await vi.waitFor(() => { expect(test.completedRuns).toEqual([{ result: 'review_handoff' }]) })
    stop()

    expect(test.review).toHaveBeenCalledOnce()
    expect(test.turns).toEqual([`${value.id}:1`, `${value.id}:2`])
  })

  it('reconciles terminal Attempt checkpoints and restarts an unclaimed active Run', async () => {
    for (const checkpoint of [
      { result: 'review_handoff' as const, runResult: 'review_handoff', error: null },
      { result: 'blocked' as const, runResult: 'blocked', error: 'blocked checkpoint' },
      { result: 'failed' as const, runResult: 'failed', error: 'failed checkpoint' },
    ]) {
      const test = harness({ issues: [] })
      const run = await test.taskboard.beginPatrolRun({ trigger: 'manual' })
      test.attempts.push({
        id: PatrolAttemptId(`attempt-${checkpoint.result}`),
        runId: run.id,
        issueId: IssueId(`issue-${checkpoint.result}`),
        sessionId: SessionId(`session-${checkpoint.result}`),
        state: 'completed',
        result: checkpoint.result,
        error: checkpoint.error,
        tokenUsage: null,
        providerError: null,
        startedAt: NOW,
        endedAt: NOW,
      })
      const stop = test.coordinator.start()
      await vi.waitFor(() => { expect(test.completedRuns).toHaveLength(1) })
      stop()
      expect(test.completedRuns).toEqual([{
        result: checkpoint.runResult,
        ...checkpoint.error === null ? {} : { error: checkpoint.error },
      }])
    }

    const unclaimed = harness({ issues: [] })
    const run = await unclaimed.taskboard.beginPatrolRun({ trigger: 'manual' })
    const stop = unclaimed.coordinator.start()
    await vi.waitFor(() => { expect(unclaimed.completedRuns).toEqual([{ result: 'no_eligible_issue' }]) })
    stop()
    expect(run.recoveryCount).toBe(1)
  })

  it('continues a recovered Run after permission-blocked checkpoints', async () => {
    const interrupted = issue('recover-approval', { status: 'in_progress', assignee: 'patrol_agent', version: 2 })
    const ready = issue('recover-after-approval', { sortOrder: 1 })
    const context = development(interrupted)
    const active = harness({
      issues: [interrupted, ready],
      contexts: { [interrupted.id]: context },
      permissionBlocked: new Set([interrupted.id]),
    })
    const activeRun = await active.taskboard.beginPatrolRun({ trigger: 'manual' })
    active.attempts.push({
      id: PatrolAttemptId('attempt-recover-approval'),
      runId: activeRun.id,
      issueId: interrupted.id,
      sessionId: context.sessionId,
      state: 'active',
      result: null,
      error: null,
      tokenUsage: null,
      providerError: null,
      startedAt: NOW,
      endedAt: null,
    })
    const stopActive = active.coordinator.start()
    await vi.waitFor(() => { expect(active.completedRuns).toEqual([{ result: 'review_handoff' }]) })
    stopActive()
    expect(active.completedAttempts.map(value => value.result)).toEqual(['permission_blocked', 'review_handoff'])

    const prior = issue('prior-approval', { status: 'blocked', assignee: 'patrol_agent', version: 3 })
    const next = issue('next-after-prior', { sortOrder: 1 })
    const completed = harness({ issues: [prior, next] })
    const completedRun = await completed.taskboard.beginPatrolRun({ trigger: 'manual' })
    completed.attempts.push({
      id: PatrolAttemptId('attempt-prior-approval'),
      runId: completedRun.id,
      issueId: prior.id,
      sessionId: SessionId('session-prior-approval'),
      state: 'completed',
      result: 'permission_blocked',
      error: 'approval checkpoint',
      tokenUsage: null,
      providerError: null,
      startedAt: NOW,
      endedAt: NOW,
    })
    const stopCompleted = completed.coordinator.start()
    await vi.waitFor(() => { expect(completed.completedRuns).toEqual([{ result: 'review_handoff' }]) })
    stopCompleted()
    expect(completed.completedAttempts).toEqual([{ issueId: next.id, result: 'review_handoff' }])
  })

  it('durably fails every unrecoverable active-Attempt checkpoint', async () => {
    const cases = [
      { name: 'missing-issue', issues: [] as Issue[], contexts: {}, sessionId: SessionId('session-missing-issue') },
      {
        name: 'mismatched-session',
        issues: [issue('mismatched-session', { status: 'in_progress', assignee: 'patrol_agent', version: 2 })],
        contexts: {} as Record<string, PatrolDevelopmentContext>,
        sessionId: SessionId('session-wrong'),
      },
      {
        name: 'missing-policy',
        issues: [issue('missing-policy-recovery', { status: 'in_progress', assignee: 'patrol_agent', version: 2 })],
        contexts: {} as Record<string, PatrolDevelopmentContext>,
        sessionId: SessionId('session-missing-policy-recovery'),
        missingPolicy: true,
      },
      {
        name: 'resume-failure',
        issues: [issue('resume-failure', { status: 'in_progress', assignee: 'patrol_agent', version: 2 })],
        contexts: {} as Record<string, PatrolDevelopmentContext>,
        sessionId: SessionId('session-resume-failure'),
        prepareError: new Error('worktree cannot be resumed'),
      },
    ]
    for (const value of cases) {
      const claimed = value.issues[0]
      if (claimed !== undefined && value.name !== 'mismatched-session') {
        value.contexts[claimed.id] = { ...development(claimed), sessionId: value.sessionId }
      } else if (claimed !== undefined) {
        value.contexts[claimed.id] = development(claimed)
      }
      const test = harness({
        issues: value.issues,
        contexts: value.contexts,
        ...(value.missingPolicy === undefined ? {} : { missingPolicy: value.missingPolicy }),
        ...(value.prepareError === undefined ? {} : { prepareError: value.prepareError }),
      })
      const run = await test.taskboard.beginPatrolRun({ trigger: 'manual' })
      test.attempts.push({
        id: PatrolAttemptId(`attempt-${value.name}`),
        runId: run.id,
        issueId: claimed?.id ?? IssueId('absent-recovery-issue'),
        sessionId: value.sessionId,
        state: 'active',
        result: null,
        error: null,
        tokenUsage: null,
        providerError: null,
        startedAt: NOW,
        endedAt: null,
      })
      const stop = test.coordinator.start()
      await vi.waitFor(() => { expect(test.completedRuns[0]?.result).toBe('failed') })
      stop()
    }
  })

  it('blocks recovery without creating a replacement when the exact Development Context is missing', async () => {
    const value = issue('recover-missing', { status: 'in_progress', assignee: 'patrol_agent', version: 2 })
    const test = harness({ issues: [value] })
    const run = await test.taskboard.beginPatrolRun({ trigger: 'manual' })
    test.attempts.push({
      id: PatrolAttemptId('attempt-recover-missing'),
      runId: run.id,
      issueId: value.id,
      sessionId: SessionId('session-missing'),
      state: 'active',
      result: null,
      error: null,
      tokenUsage: null,
      providerError: null,
      startedAt: NOW,
      endedAt: null,
    })

    const stop = test.coordinator.start()
    await vi.waitFor(() => { expect(test.completedRuns[0]?.result).toBe('failed') })
    stop()

    expect(test.completedRuns[0]?.error).toContain('has no persistent Development Context')
    expect(test.host.prepare).not.toHaveBeenCalled()
    expect(value.status).toBe('blocked')
  })
})
