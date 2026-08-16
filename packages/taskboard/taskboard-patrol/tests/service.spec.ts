import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent, type AgentFactory } from '@deepseek-ai/dsh-agent'
import { IssueId, IssueIdentifier, PatrolAttemptId, PatrolRunId } from '@deepseek-ai/dsh-taskboard'
import type { Issue, PatrolDevelopmentContext, PatrolPolicy } from '@deepseek-ai/dsh-taskboard'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import TaskboardPatrolService from '../src/index.ts'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

async function repository(): Promise<{ workspace: string; worktrees: string }> {
  const rawRoot = await mkdtemp(join(tmpdir(), 'dsh-taskboard-patrol-service-'))
  const rawWorktrees = await mkdtemp(join(tmpdir(), 'dsh-taskboard-patrol-service-worktrees-'))
  tempDirs.push(rawRoot, rawWorktrees)
  git(rawRoot, 'init', '-b', 'main')
  git(rawRoot, 'config', 'user.email', 'patrol@example.test')
  git(rawRoot, 'config', 'user.name', 'Patrol Test')
  const workspace = join(rawRoot, 'project')
  await mkdir(workspace)
  await writeFile(join(workspace, 'README.md'), '# fixture\n')
  git(rawRoot, 'add', '.')
  git(rawRoot, 'commit', '-m', 'base')
  return { workspace: await realpath(workspace), worktrees: await realpath(rawWorktrees) }
}

describe('TaskboardPatrolService', () => {
  it('binds an unbound claim before creating its worktree and visible ordinary Session', async () => {
    const fixture = await repository()
    const workspaceId = WorkspaceId('workspace-patrol-service')
    const issueId = IssueId('issue-patrol-service')
    const attemptId = PatrolAttemptId('attempt-patrol-service')
    const attached: string[] = []
    const permissionSelections: string[] = []
    const mountedPresets: string[] = []
    let storedIssue: Issue | undefined
    let binding: PatrolDevelopmentContext | undefined
    const workspace = {
      id: workspaceId,
      path: fixture.workspace,
      title: 'Patrol Service',
      sessionIds: [],
      attachSession: (id: string) => { attached.push(id); return Promise.resolve() },
    }
    const ctx = new Context()
    const systemPromptFiber = await ctx.plugin(SystemPrompt)
    const toolsFiber = await ctx.plugin(ToolRuntime)
    const sessionFiber = await ctx.plugin(SessionStore)
    const agentFiber = await ctx.plugin(AgentRegistry)
    const subprocessFiber = await ctx.plugin(LocalSubprocessRuntime)
    ctx.provide('agentDefaultModel', {
      currentSelection: () => ({ provider: 'provider-default', model: 'model-default', reasoningEffort: 'high' }),
    } as never)
    ctx.provide('agentPresets', {
      defaultId: 'coding',
      resolve: (id?: string) => Promise.resolve({ id: id ?? 'coding' }),
      mount: (_agentCtx: Context, id?: string) => {
        mountedPresets.push(id ?? 'coding')
        return Promise.resolve({ id: id ?? 'coding' })
      },
      composedPreset: () => 'coding',
    } as never)
    ctx.provide('llm', {
      resolveCallConfig: (selection: object) => Promise.resolve(selection),
    } as never)
    const permissionPresets = {
      names: ['workspace-write', 'danger-full-access'],
      defaultPreset: 'workspace-write',
      resolve: (name: string) => ({ sandbox: name, approval: 'ask' }),
      set: (_session: unknown, name: string) => { permissionSelections.push(name) },
    }
    ctx.provide('permissionPresets', permissionPresets as never)
    ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
    ctx.provide('taskboard', {
      getIssue: () => Promise.resolve(storedIssue),
      getPatrolDevelopmentContext: () => Promise.resolve(binding),
      bindPatrolDevelopmentContext: (input: { context: Omit<
        PatrolDevelopmentContext,
        'issueId' | 'sessionStartedAt' | 'resultCommit' | 'createdAt' | 'updatedAt'
      > }) => {
        binding = {
          issueId,
          ...input.context,
          sessionStartedAt: null,
          resultCommit: null,
          createdAt: '2026-08-16T00:00:00.000Z',
          updatedAt: '2026-08-16T00:00:00.000Z',
        }
        return Promise.resolve(binding)
      },
      markPatrolSessionStarted: () => {
        binding = { ...binding!, sessionStartedAt: '2026-08-16T00:00:01.000Z' }
        return Promise.resolve(binding)
      },
    } as never)
    ctx.provide('workspaceRegistry', {
      get: (id: WorkspaceId) => id === workspaceId ? workspace : undefined,
      list: () => [],
    } as never)

    let cancelled: unknown
    const factory: AgentFactory = {
      async createAgent(_ownerCtx, options) {
        const session = ctx.sessions.create(
          options.sessionId,
          options.meta === undefined ? {} : { meta: options.meta },
        )
        const agent = {
          id: options.sessionId,
          session,
          status: 'idle',
          whenIdle: () => Promise.resolve(),
          cancel: (cause: unknown) => { cancelled = cause },
        } as unknown as Agent
        const agentCtx = ctx.extend({ agent })
        ;(agent as { ctx: Context }).ctx = agentCtx
        await options.setup?.(agentCtx)
        const unregister = ctx.agents.register(agent)
        return { agent, dispose: () => { unregister(); return Promise.resolve() } }
      },
      resume() {
        return Promise.reject(new Error('unexpected resume'))
      },
    }
    ctx.agents.setFactory(factory)
    const patrolFiber = await ctx.plugin(TaskboardPatrolService, {
      worktreeRoot: fixture.worktrees,
    })
    try {
      const issue = {
        id: issueId,
        identifier: IssueIdentifier('PATROL-1'),
        workspaceId,
        title: 'Implement service',
        description: '',
        status: 'in_progress' as const,
        priority: 'none' as const,
        labels: [],
        assignee: 'patrol_agent' as const,
        startDate: null,
        dueDate: null,
        sortOrder: 0,
        version: 2,
        archivedAt: null,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
      }
      storedIssue = issue
      const attempt = {
        id: attemptId,
        runId: PatrolRunId('run-patrol-service'),
        issueId,
        sessionId: null,
        state: 'active' as const,
        result: null,
        error: null,
        tokenUsage: null,
        providerError: null,
        startedAt: '2026-08-16T00:00:00.000Z',
        endedAt: null,
      }
      const policy: PatrolPolicy = {
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
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
      }

      await expect(ctx.taskboardPatrol.defaults(workspaceId)).resolves.toMatchObject({
        baseBranch: 'main',
        agentPreset: 'coding',
        permissionPreset: 'workspace-write',
      })
      permissionPresets.names = ['danger-full-access']
      permissionPresets.defaultPreset = 'danger-full-access'
      await expect(ctx.taskboardPatrol.defaults(workspaceId)).resolves.toMatchObject({
        permissionPreset: 'danger-full-access',
      })
      permissionPresets.names = ['workspace-write', 'danger-full-access']
      permissionPresets.defaultPreset = 'workspace-write'
      await expect(ctx.taskboardPatrol.localBranches(workspaceId)).resolves.toEqual(['main'])
      const baseCommit = git(fixture.workspace, 'rev-parse', 'HEAD')
      await expect(ctx.taskboardPatrol.isAncestor(workspaceId, baseCommit, 'main')).resolves.toBe(true)
      await expect(ctx.taskboardPatrol.defaults(WorkspaceId('missing-workspace'))).rejects.toThrow('is not registered')

      const lease = await ctx.taskboardPatrol.prepare(attempt, issue, policy)
      expect(binding).toMatchObject({
        issueId,
        sessionStartedAt: '2026-08-16T00:00:01.000Z',
        baseBranch: 'main',
        branch: 'dsh-task/patrol-1',
        agentPreset: 'coding',
        provider: 'provider-default',
        model: 'model-default',
        reasoningEffort: 'high',
        permissionPreset: 'workspace-write',
      })
      expect(lease.agent.session.header.cwd).toBe(join(binding!.worktreePath, 'project'))
      expect(git(binding!.worktreePath, 'branch', '--show-current')).toBe('dsh-task/patrol-1')
      expect(attached).toEqual([binding!.sessionId])
      expect(permissionSelections).toEqual(['workspace-write'])
      expect(mountedPresets).toEqual(['coding'])
      await expect(ctx.taskboardPatrol.result(binding!)).resolves.toMatchObject({
        clean: true,
        changedFromBase: false,
      })

      const otherDelegated = vi.fn(() => Promise.resolve('allowed-once' as const))
      await expect(lease.agent.ctx.waterfall('approval/request', {
        agent: {} as Agent,
        toolName: 'read',
      }, otherDelegated)).resolves.toBe('allowed-once')
      expect(otherDelegated).toHaveBeenCalledOnce()

      const delegated = vi.fn(() => Promise.resolve('allowed-once' as const))
      const outcome = await lease.agent.ctx.waterfall('approval/request', {
        agent: lease.agent,
        toolName: 'bash',
        reason: 'write outside the workspace',
      }, delegated)
      expect(outcome).toBe('rejected')
      expect(delegated).not.toHaveBeenCalled()
      await new Promise<void>((resolve) => { queueMicrotask(resolve) })
      expect(cancelled).toEqual({ kind: 'hook', reason: 'Taskboard Patrol rejected an unattended tool approval' })
      expect(lease.rejectedApprovals).toEqual([{ toolName: 'bash', reason: 'write outside the workspace' }])
      await expect(lease.agent.ctx.waterfall('approval/request', {
        agent: lease.agent,
        toolName: 'write',
      }, delegated)).resolves.toBe('rejected')
      expect(lease.rejectedApprovals).toEqual([
        { toolName: 'bash', reason: 'write outside the workspace' },
        { toolName: 'write' },
      ])
      await lease.release()
      await lease.release()
      expect(ctx.agents.get(binding!.sessionId)).toBeUndefined()
      await expect(ctx.taskboardPatrol.prepare({
        ...attempt,
        id: PatrolAttemptId('attempt-patrol-service-returned'),
        sessionId: binding!.sessionId,
      }, issue, policy)).rejects.toThrow(
        `bound Patrol Session "${binding!.sessionId}" cannot be resumed from persistence`,
      )

      await writeFile(join(binding!.worktreePath, 'project', 'result.txt'), 'complete\n')
      git(binding!.worktreePath, 'add', '.')
      git(binding!.worktreePath, 'commit', '-m', 'complete issue')
      const result = await ctx.taskboardPatrol.result(binding!)
      binding = { ...binding!, resultCommit: result.head }

      await expect(ctx.taskboardPatrol.removeWorktree({
        workspaceId,
        reference: issue.id,
        confirmed: true,
      })).rejects.toMatchObject({ code: 'patrol_worktree_not_integrated' })
      await expect(stat(binding.worktreePath)).resolves.toMatchObject({})

      git(fixture.workspace, 'merge', '--ff-only', binding.branch)

      await writeFile(join(binding.worktreePath, 'project', 'result.txt'), 'dirty\n')
      await expect(ctx.taskboardPatrol.removeWorktree({
        workspaceId,
        reference: issue.id,
        confirmed: true,
      })).rejects.toMatchObject({ code: 'patrol_worktree_not_clean' })
      await expect(stat(binding.worktreePath)).resolves.toMatchObject({})
      await writeFile(join(binding.worktreePath, 'project', 'result.txt'), 'complete\n')

      await expect(ctx.taskboardPatrol.removeWorktree({
        workspaceId,
        reference: issue.id,
        confirmed: false,
      })).rejects.toMatchObject({ code: 'patrol_worktree_confirmation_required' })
      await expect(stat(binding.worktreePath)).resolves.toMatchObject({})

      await expect(ctx.taskboardPatrol.removeWorktree({
        workspaceId,
        reference: issue.id,
        confirmed: true,
      })).resolves.toEqual({
        worktreePath: binding.worktreePath,
        branch: binding.branch,
        resultCommit: result.head,
      })
      await expect(stat(binding.worktreePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(git(fixture.workspace, 'show-ref', '--verify', `refs/heads/${binding.branch}`)).not.toBe('')
      await expect(ctx.taskboard.getPatrolDevelopmentContext(issue.id)).resolves.toEqual(binding)
      await expect(ctx.taskboardPatrol.removeWorktree({
        workspaceId,
        reference: issue.id,
        confirmed: true,
      })).rejects.toMatchObject({ code: 'patrol_worktree_missing' })
    } finally {
      await patrolFiber.dispose()
      await toolsFiber.dispose()
      await systemPromptFiber.dispose()
      await subprocessFiber.dispose()
      await agentFiber.dispose()
      await sessionFiber.dispose()
    }
  })
})
