import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory, AgentSetup, ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { IssueId, IssueIdentifier, PatrolAttemptId, PatrolRunId } from '@deepseek-ai/dsh-taskboard'
import type { Issue, PatrolAttempt, PatrolDevelopmentContext, PatrolPolicy } from '@deepseek-ai/dsh-taskboard'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import TaskboardPatrolService from '../src/index.ts'
import type { PatrolGit, PatrolGitResult, PatrolWorktree } from '../src/git.ts'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(disposers.splice(0).map(dispose => dispose()))
})

const NOW = '2026-08-16T00:00:00.000Z'

function issue(id: string, workspaceId: WorkspaceId, status: Issue['status'] = 'in_progress'): Issue {
  return {
    id: IssueId(id),
    identifier: IssueIdentifier(id.toUpperCase()),
    workspaceId,
    title: id,
    description: '',
    status,
    priority: 'none',
    labels: [],
    assignee: 'patrol_agent',
    startDate: null,
    dueDate: null,
    sortOrder: 0,
    version: 2,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function attempt(value: Issue, sessionId: PatrolAttempt['sessionId'] = null): PatrolAttempt {
  return {
    id: PatrolAttemptId(`attempt-${value.id}`),
    runId: PatrolRunId('run-service-branches'),
    issueId: value.id,
    sessionId,
    state: 'active',
    result: null,
    error: null,
    startedAt: NOW,
    endedAt: null,
  }
}

function policy(workspaceId: WorkspaceId, replacements: Partial<PatrolPolicy> = {}): PatrolPolicy {
  return {
    workspaceId,
    enabled: false,
    interval: '1h',
    baseBranch: 'main',
    agentPreset: 'coding',
    provider: null,
    model: null,
    reasoningEffort: null,
    permissionPreset: 'workspace-write',
    nextDueAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...replacements,
  }
}

function context(value: Issue, sessionId: string, replacements: Partial<PatrolDevelopmentContext> = {}): PatrolDevelopmentContext {
  return {
    issueId: value.id,
    sessionId: SessionId(sessionId),
    sessionStartedAt: null,
    baseBranch: 'main',
    branch: `dsh-task/${String(value.identifier).toLowerCase()}`,
    worktreePath: `/worktrees/${String(value.identifier).toLowerCase()}`,
    agentPreset: 'coding',
    provider: 'provider-bound',
    model: 'model-bound',
    reasoningEffort: null,
    permissionPreset: 'workspace-write',
    resultCommit: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...replacements,
  }
}

interface Harness {
  readonly ctx: Context
  readonly workspaceId: WorkspaceId
  binding: PatrolDevelopmentContext | undefined
  persisted: string[]
  resumeLogged: ModelSelection | undefined
  resumeCwd: string
  attachError: Error | undefined
  flushError: Error | undefined
  markError: Error | undefined
  setupWithoutAgent: boolean
  livePreset: string
  readonly disposed: { count: number }
  readonly permissionSelections: string[]
  git: {
    currentBranch: ReturnType<typeof vi.fn>
    localBranches: ReturnType<typeof vi.fn>
    isAncestor: ReturnType<typeof vi.fn>
    ensureWorktree: ReturnType<typeof vi.fn>
    result: ReturnType<typeof vi.fn>
  }
}

async function mountHarness(): Promise<Harness> {
  const ctx = new Context()
  const workspaceId = WorkspaceId('workspace-service-branches')
  const disposed = { count: 0 }
  const permissionSelections: string[] = []
  const harness: Harness = {
    ctx,
    workspaceId,
    binding: undefined,
    persisted: [],
    resumeLogged: undefined,
    resumeCwd: '/worktrees/issue-a',
    attachError: undefined,
    flushError: undefined,
    markError: undefined,
    setupWithoutAgent: false,
    livePreset: 'coding',
    disposed,
    permissionSelections,
    git: undefined as never,
  }
  const workspace = {
    id: workspaceId,
    path: '/workspace',
    title: 'Branch coverage',
    sessionIds: [],
    attachSession: () => harness.attachError === undefined
      ? Promise.resolve()
      : Promise.reject(harness.attachError),
  }
  const systemPromptFiber = await ctx.plugin(SystemPrompt)
  const toolsFiber = await ctx.plugin(ToolRuntime)
  const agentFiber = await ctx.plugin(AgentRegistry)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'provider-default', model: 'model-default', reasoningEffort: 'high' }),
  } as never)
  ctx.provide('agentPresets', {
    defaultId: 'coding',
    resolve: (id?: string) => Promise.resolve({ id: id ?? 'coding' }),
    mount: () => Promise.resolve({ id: 'coding' }),
    composedPreset: () => harness.livePreset,
  } as never)
  ctx.provide('llm', {
    resolveCallConfig: (selection: ModelSelection) => Promise.resolve(selection),
  } as never)
  ctx.provide('permissionPresets', {
    names: ['workspace-write'],
    defaultPreset: 'workspace-write',
    resolve: (name: string) => ({ sandbox: name, approval: 'ask' }),
    set: (_session: unknown, name: string) => { permissionSelections.push(name) },
  } as never)
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve(harness.persisted.map(id => ({ id: SessionId(id) }))),
  } as never)
  ctx.provide('sessions', {
    flush: () => harness.flushError === undefined
      ? Promise.resolve()
      : Promise.reject(harness.flushError),
  } as never)
  ctx.provide('subprocess', {} as never)
  ctx.provide('taskboard', {
    getPatrolDevelopmentContext: () => Promise.resolve(harness.binding),
    bindPatrolDevelopmentContext: (input: {
      attemptId: PatrolAttempt['id']
      context: Omit<
        PatrolDevelopmentContext,
        'issueId' | 'sessionStartedAt' | 'resultCommit' | 'createdAt' | 'updatedAt'
      >
    }) => {
      harness.binding = {
        issueId: IssueId(String(input.attemptId).replace('attempt-', '')),
        ...input.context,
        sessionStartedAt: null,
        resultCommit: null,
        createdAt: NOW,
        updatedAt: NOW,
      }
      return Promise.resolve(harness.binding)
    },
    markPatrolSessionStarted: () => {
      if (harness.markError !== undefined) return Promise.reject(harness.markError)
      harness.binding = { ...harness.binding!, sessionStartedAt: NOW }
      return Promise.resolve(harness.binding)
    },
  } as never)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === workspaceId ? workspace : undefined,
    list: () => [],
  } as never)

  const makeAgent = async (
    sessionId: SessionId,
    cwd: string,
    setup: AgentSetup | undefined,
    logged: ModelSelection | undefined,
  ) => {
    const session = {
      id: sessionId,
      header: { id: sessionId, cwd },
      requestHeader: () => logged === undefined ? undefined : { config: logged },
    }
    const agent = {
      id: sessionId,
      session,
      status: 'idle',
      whenIdle: () => Promise.resolve(),
      cancel: vi.fn(),
    } as unknown as Agent
    if (harness.setupWithoutAgent) {
      await setup?.(ctx)
    } else {
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx: Context }).ctx = agentCtx
      await setup?.(agentCtx)
    }
    const unregister = ctx.agents.register(agent)
    return {
      agent,
      dispose: () => {
        disposed.count += 1
        unregister()
        return Promise.resolve()
      },
    }
  }
  const factory: AgentFactory = {
    createAgent: (_ownerCtx, options) => makeAgent(
      options.sessionId,
      options.meta?.cwd ?? '/missing-cwd',
      options.setup,
      undefined,
    ),
    resume: (_ownerCtx, options) => makeAgent(
      options.resumeSessionId,
      harness.resumeCwd,
      options.setup,
      harness.resumeLogged,
    ),
  }
  ctx.agents.setFactory(factory)
  const patrolFiber = await ctx.plugin(TaskboardPatrolService, {
    worktreeRoot: '/worktrees',
    gitCommand: '/usr/bin/git',
    gitGraceMs: 25,
    gitOutputBytes: 4096,
  })
  const rawGit = (ctx.taskboardPatrol as unknown as { git: PatrolGit }).git
  harness.git = {
    currentBranch: vi.spyOn(rawGit, 'currentBranch').mockResolvedValue('main'),
    localBranches: vi.spyOn(rawGit, 'localBranches').mockResolvedValue(['main']),
    isAncestor: vi.spyOn(rawGit, 'isAncestor').mockResolvedValue(true),
    ensureWorktree: vi.spyOn(rawGit, 'ensureWorktree').mockImplementation(async (_path, value) => ({
      root: value.worktreePath,
      sessionCwd: value.worktreePath,
    } satisfies PatrolWorktree)),
    result: vi.spyOn(rawGit, 'result').mockResolvedValue({
      head: '0123456789abcdef',
      clean: true,
      changedFromBase: true,
    } satisfies PatrolGitResult),
  }
  disposers.push(async () => {
    await patrolFiber.dispose()
    await agentFiber.dispose()
    await toolsFiber.dispose()
    await systemPromptFiber.dispose()
  })
  return harness
}

describe('TaskboardPatrolService rejection paths', () => {
  it('retains direct-construction defaults when Cordis validation is bypassed', () => {
    const ctx = new Context()
    ctx.provide('subprocess', {} as never)
    expect(new TaskboardPatrolService(ctx, { worktreeRoot: '/worktrees' }))
      .toBeInstanceOf(TaskboardPatrolService)
  })

  it('rejects inconsistent claims, bindings, policies, and failed Session publication', async () => {
    const harness = await mountHarness()
    const value = issue('issue-a', harness.workspaceId)
    const active = attempt(value)
    const savedPolicy = policy(harness.workspaceId)

    await expect(harness.ctx.taskboardPatrol.prepare({ ...active, state: 'completed' }, value, savedPolicy))
      .rejects.toThrow('is not the active claim')
    await expect(harness.ctx.taskboardPatrol.prepare(active, { ...value, id: IssueId('other') }, savedPolicy))
      .rejects.toThrow('is not the active claim')
    await expect(harness.ctx.taskboardPatrol.prepare(active, { ...value, status: 'todo' }, savedPolicy))
      .rejects.toThrow('is not the active claim')
    expect(() => harness.ctx.taskboardPatrol.localBranches(WorkspaceId('missing')))
      .toThrow('is not registered')

    await expect(harness.ctx.taskboardPatrol.prepare({
      ...active,
      sessionId: SessionId('unexpected-session'),
    }, value, savedPolicy)).rejects.toThrow('without a Development Context')
    harness.binding = context(value, 'bound-session')
    await expect(harness.ctx.taskboardPatrol.prepare({
      ...active,
      sessionId: SessionId('other-session'),
    }, value, savedPolicy)).rejects.toThrow('does not match')

    harness.binding = undefined
    await expect(harness.ctx.taskboardPatrol.prepare(active, value, policy(harness.workspaceId, {
      baseBranch: 'missing',
    }))).rejects.toThrow('is not a local branch')
    await expect(harness.ctx.taskboardPatrol.prepare(active, value, policy(harness.workspaceId, {
      provider: null,
      model: 'model-only',
    }))).rejects.toThrow('model requires a provider')
    await expect(harness.ctx.taskboardPatrol.prepare(active, value, policy(harness.workspaceId, {
      provider: 'provider-only',
      model: null,
    }))).rejects.toThrow('provider route requires a model')

    harness.attachError = new Error('attach failed')
    await expect(harness.ctx.taskboardPatrol.prepare(active, value, policy(harness.workspaceId, {
      baseBranch: null,
      agentPreset: null,
      provider: 'provider-explicit',
      model: 'model-explicit',
      reasoningEffort: 'low',
    }))).rejects.toThrow('attach failed')
    expect(harness.disposed.count).toBe(1)
    expect(harness.binding).toMatchObject({
      agentPreset: 'coding',
      provider: 'provider-explicit',
      model: 'model-explicit',
      reasoningEffort: 'low',
    })

    harness.binding = undefined
    await expect(harness.ctx.taskboardPatrol.prepare(active, value, policy(harness.workspaceId, {
      provider: 'provider-without-reasoning',
      model: 'model-without-reasoning',
      reasoningEffort: null,
    }))).rejects.toThrow('attach failed')
    expect(harness.disposed.count).toBe(2)
    expect(harness.binding).toMatchObject({ reasoningEffort: null })

    harness.attachError = undefined
    harness.markError = new Error('mark failed')
    await expect(harness.ctx.taskboardPatrol.prepare({
      ...active,
      sessionId: harness.binding!.sessionId,
    }, value, savedPolicy)).rejects.toThrow('mark failed')
    expect(harness.disposed.count).toBe(3)

    harness.markError = undefined
    harness.binding = context(value, 'setup-without-agent')
    harness.setupWithoutAgent = true
    await expect(harness.ctx.taskboardPatrol.prepare({
      ...active,
      sessionId: harness.binding.sessionId,
    }, value, savedPolicy)).rejects.toThrow('has no scoped Agent')
  })

  it('resumes persisted selection and validates borrowed live Agents', async () => {
    const harness = await mountHarness()
    const value = issue('issue-b', harness.workspaceId)
    harness.binding = context(value, 'persisted-session', { sessionStartedAt: NOW })
    harness.persisted = [harness.binding.sessionId]
    harness.resumeCwd = harness.binding.worktreePath
    harness.resumeLogged = {
      provider: 'provider-logged',
      model: 'model-logged',
      reasoningEffort: ReasoningEffortId('medium'),
    }
    const resumed = await harness.ctx.taskboardPatrol.prepare(
      attempt(value, harness.binding.sessionId),
      value,
      policy(harness.workspaceId),
    )
    expect(harness.permissionSelections).toEqual([])
    harness.flushError = new Error('release flush failed')
    await expect(resumed.release()).rejects.toThrow('release flush failed')
    expect(harness.disposed.count).toBe(1)
    harness.flushError = undefined

    harness.binding = context(value, 'persisted-without-reasoning', { sessionStartedAt: NOW })
    harness.persisted = [harness.binding.sessionId]
    harness.resumeCwd = harness.binding.worktreePath
    harness.resumeLogged = { provider: 'provider-logged', model: 'model-logged' }
    const withoutReasoning = await harness.ctx.taskboardPatrol.prepare(
      attempt(value, harness.binding.sessionId),
      value,
      policy(harness.workspaceId),
    )
    await withoutReasoning.release()

    harness.persisted = []
    const liveContext = context(value, 'live-session', { sessionStartedAt: NOW, reasoningEffort: 'high' })
    harness.binding = liveContext
    const liveSession = {
      id: liveContext.sessionId,
      header: { id: liveContext.sessionId, cwd: '/wrong-directory' },
      requestHeader: () => undefined,
    }
    const live = {
      id: liveContext.sessionId,
      session: liveSession,
      status: 'idle',
      whenIdle: () => Promise.resolve(),
      cancel: vi.fn(),
    } as unknown as Agent
    const liveCtx = harness.ctx.extend({ agent: live })
    ;(live as { ctx: Context }).ctx = liveCtx
    const unregister = harness.ctx.agents.register(live)
    try {
      const liveAttempt = attempt(value, liveContext.sessionId)
      await expect(harness.ctx.taskboardPatrol.prepare(liveAttempt, value, policy(harness.workspaceId)))
        .rejects.toThrow('live in a different directory')
      liveSession.header.cwd = liveContext.worktreePath
      harness.livePreset = 'reviewing'
      await expect(harness.ctx.taskboardPatrol.prepare(liveAttempt, value, policy(harness.workspaceId)))
        .rejects.toThrow('different Agent Preset')
      harness.livePreset = 'coding'
      ;(live as unknown as { status: string }).status = 'running'
      await expect(harness.ctx.taskboardPatrol.prepare(liveAttempt, value, policy(harness.workspaceId)))
        .rejects.toThrow('already running')
      ;(live as unknown as { status: string }).status = 'idle'
      const borrowed = await harness.ctx.taskboardPatrol.prepare(liveAttempt, value, policy(harness.workspaceId))
      await borrowed.release()
      expect(harness.disposed.count).toBe(2)
    } finally {
      unregister()
    }
  })
})
