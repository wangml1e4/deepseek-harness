import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { effectiveSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { createScope, type Scope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { IssueId, IssueIdentifier, PatrolAttemptId, PatrolRunId } from '@deepseek-ai/dsh-taskboard'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { defineTool, type PostToolDecision } from '@deepseek-ai/dsh-tools'
import { effectiveApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { PatrolReviewer } from '../src/reviewer.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const workspaceId = WorkspaceId('workspace-reviewer')
const issueId = IssueId('issue-reviewer')
const issue = {
  id: issueId,
  identifier: IssueIdentifier('REVIEW-1'),
  workspaceId,
  title: 'Review implementation',
  description: 'Check the supplied patch.',
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
const attempt = {
  id: PatrolAttemptId('attempt-reviewer'),
  runId: PatrolRunId('run-reviewer'),
  issueId,
  sessionId: SessionId('session-implementation'),
  state: 'active' as const,
  result: null,
  error: null,
  startedAt: '2026-08-16T00:00:00.000Z',
  endedAt: null,
}
const development = {
  issueId,
  sessionId: SessionId('session-implementation'),
  sessionStartedAt: '2026-08-16T00:00:00.000Z',
  baseBranch: 'main',
  branch: 'dsh-task/review-1',
  worktreePath: '/worktrees/review-1',
  agentPreset: 'coding',
  provider: 'deepseek',
  model: 'deepseek-chat',
  reasoningEffort: 'high',
  permissionPreset: 'workspace-write',
  resultCommit: null,
  createdAt: '2026-08-16T00:00:00.000Z',
  updatedAt: '2026-08-16T00:00:00.000Z',
}

type ReviewMode = 'valid' | 'empty' | 'none' | 'interrupted' | 'duplicate' | 'post-error' | 'no-inherited' | 'missing-agent'

async function harness(mode: ReviewMode) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SessionStore)
  if (mode !== 'no-inherited' && mode !== 'missing-agent') {
    ctx.tools.register(defineTool({
      name: 'inherited_read',
      description: 'Inherited test tool.',
      parameters: {},
      output: {
        schema: { type: 'boolean' },
        render: () => [{ type: 'text', text: 'read' }],
      },
      execute: () => Promise.resolve(true),
    }))
  }
  if (mode === 'post-error') {
    ctx.on('tools/post-execute', async (exec, _result, next): Promise<PostToolDecision> => exec.name === 'patrol_review_submit'
      ? { kind: 'block', feedback: [{ type: 'text', text: 'review result rejected' }] }
      : await next())
  }
  const attached: SessionId[] = []
  const disposed = vi.fn()
  let reviewerAgent: Agent | undefined
  let visibleTools: string[] = []
  let presentationTitle: string | undefined
  ctx.provide('agentPresets', {
    mount: vi.fn(() => Promise.resolve({ id: 'coding' })),
  } as never)
  ctx.provide('agents', {
    create: async (options: CreateAgentOptions): Promise<AgentHandle> => {
      const session = ctx.sessions.create(options.sessionId, options.meta === undefined ? {} : { meta: options.meta })
      if (mode === 'missing-agent') {
        await options.setup?.(ctx)
        throw new Error('unreachable')
      }
      let pending = Promise.resolve()
      let turn = 0
      const agent = {
        id: options.sessionId,
        session,
        status: 'idle',
        cancel: vi.fn(),
        followup: () => {
          pending = (async () => {
            turn += 1
            visibleTools = agent.ctx.tools.schemas(agent).map(value => value.name)
            presentationTitle = ctx.tools
              .get('patrol_review_submit', agent)
              ?.presentCall?.({
                verdict: 'approve',
                findings: 'No findings.',
                verification: [],
                risks: [],
              })?.title
            if (mode !== 'none') {
              const args = mode === 'empty'
                ? { verdict: 'approve', findings: ' ', verification: [''], risks: [] }
                : {
                  verdict: 'changes_requested',
                  findings: 'Add a regression test.',
                  verification: ['Inspected the supplied patch'],
                  risks: ['CI still owns the platform matrix'],
                }
              await agent.ctx.tools.execute({
                signal: new AbortController().signal,
                callId: CallId(`review-${turn}`),
                name: 'patrol_review_submit',
                arguments: args,
                agent,
              })
              if (mode === 'duplicate') {
                await agent.ctx.tools.execute({
                  signal: new AbortController().signal,
                  callId: CallId(`review-duplicate-${turn}`),
                  name: 'patrol_review_submit',
                  arguments: args,
                  agent,
                })
              }
            }
            session.append('turn/end', {
              turn,
              reason: mode === 'interrupted' ? { kind: 'interrupted' } : { kind: 'completed' },
            })
          })()
        },
        whenIdle: () => pending,
      } as unknown as Agent
      let scope!: Scope
      const minter = ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent) }, {
        inject: ['tools', 'systemPrompt'],
      }))
      await minter.await()
      const agentCtx = scope.ctx.extend({ agent })
      ;(agent as { ctx: Context }).ctx = agentCtx
      reviewerAgent = agent
      await options.setup?.(agentCtx)
      return { agent, dispose: async () => { disposed(); await scope.dispose(); await minter.dispose() } }
    },
  } as never)
  const workspace = {
    attachSession: (id: SessionId) => { attached.push(id); return Promise.resolve() },
  }
  return {
    ctx,
    workspace,
    attached,
    disposed,
    agent: () => reviewerAgent,
    tools: () => visibleTools,
    presentationTitle: () => presentationTitle,
  }
}

describe('PatrolReviewer', () => {
  it('runs a separate read-only/never Session and accepts only its scoped structured tool', async () => {
    const test = await harness('valid')
    const result = await new PatrolReviewer(test.ctx).review(
      attempt,
      issue,
      development,
      { root: '/worktrees/review-1', sessionCwd: '/worktrees/review-1/project' },
      'abc123',
      { patch: '+tested', stat: '1 file changed' },
      test.workspace as never,
    )
    expect(result).toMatchObject({
      reviewedCommit: 'abc123',
      verdict: 'changes_requested',
      findings: 'Add a regression test.',
    })
    expect(result.sessionId).not.toBe(development.sessionId)
    expect(test.attached).toEqual([result.sessionId])
    expect(effectiveSandboxMode(test.agent()!.session.events)).toBe('read-only')
    expect(effectiveApprovalPolicy(test.agent()!.session.events)).toBe('never')
    expect(test.tools()).toEqual(['patrol_review_submit'])
    expect(test.presentationTitle()).toBe('Submit Patrol review: approve')
    expect(test.disposed).toHaveBeenCalledOnce()
  })

  it('also exposes only the submit tool when there are no inherited tools to restrict', async () => {
    const test = await harness('no-inherited')
    await expect(new PatrolReviewer(test.ctx).review(
      attempt, issue, { ...development, reasoningEffort: null },
      { root: '/worktrees/review-1', sessionCwd: '/worktrees/review-1/project' },
      'abc123', { patch: '+change', stat: '1 file' }, test.workspace as never,
    )).resolves.toMatchObject({ verdict: 'changes_requested' })
    expect(test.tools()).toEqual(['patrol_review_submit'])
  })

  it('rejects invalid Attempts before creating a Session', async () => {
    const test = await harness('valid')
    await expect(new PatrolReviewer(test.ctx).review(
      { ...attempt, state: 'completed' }, issue, development,
      { root: '/worktrees/review-1', sessionCwd: '/worktrees/review-1/project' },
      'abc123', { patch: '', stat: '' }, test.workspace as never,
    )).rejects.toThrow('cannot start an independent review')
    await expect(new PatrolReviewer(test.ctx).review(
      attempt, { ...issue, id: IssueId('other') }, development,
      { root: '/worktrees/review-1', sessionCwd: '/worktrees/review-1/project' },
      'abc123', { patch: '', stat: '' }, test.workspace as never,
    )).rejects.toThrow('cannot start an independent review')
  })

  it.each(['empty', 'none', 'interrupted'] as const)('rejects a %s Reviewer turn and still disposes it', async (mode) => {
    const test = await harness(mode)
    await expect(new PatrolReviewer(test.ctx).review(
      attempt, issue, development,
      { root: '/worktrees/review-1', sessionCwd: '/worktrees/review-1/project' },
      'abc123', { patch: '+change', stat: '1 file' }, test.workspace as never,
    )).rejects.toThrow(mode === 'interrupted' ? 'did not complete' : 'did not submit')
    expect(test.disposed).toHaveBeenCalledOnce()
  })

  it('does not commit structured evidence when post-execution policy rejects the tool result', async () => {
    const test = await harness('post-error')
    await expect(new PatrolReviewer(test.ctx).review(
      attempt, issue, development,
      { root: '/worktrees/review-1', sessionCwd: '/worktrees/review-1/project' },
      'abc123', { patch: '+change', stat: '1 file' }, test.workspace as never,
    )).rejects.toThrow('did not submit')
  })

  it('rejects an Agent factory that omits the scoped Agent during setup', async () => {
    const test = await harness('missing-agent')
    await expect(new PatrolReviewer(test.ctx).review(
      attempt, issue, development,
      { root: '/worktrees/review-1', sessionCwd: '/worktrees/review-1/project' },
      'abc123', { patch: '+change', stat: '1 file' }, test.workspace as never,
    )).rejects.toThrow('has no scoped Agent')
  })

  it('keeps the first committed submission when a later duplicate call is rejected', async () => {
    const test = await harness('duplicate')
    await expect(new PatrolReviewer(test.ctx).review(
      attempt, issue, development,
      { root: '/worktrees/review-1', sessionCwd: '/worktrees/review-1/project' },
      'abc123', { patch: '+change', stat: '1 file' }, test.workspace as never,
    )).resolves.toMatchObject({ findings: 'Add a regression test.' })
  })
})
