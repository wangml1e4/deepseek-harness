import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  type PatrolPolicy,
  PatrolRunId,
} from '@deepseek-ai/dsh-taskboard'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import TaskboardPatrolService from '../src/index.ts'
import type { PatrolCoordinator } from '../src/coordinator.ts'
import type { PatrolGit } from '../src/git.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const workspaceId = WorkspaceId('workspace-configuration')
const NOW = '2026-08-16T00:00:00.000Z'

function policy(replacements: Partial<PatrolPolicy> = {}): PatrolPolicy {
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
    ...replacements,
  }
}

async function harness() {
  const ctx = new Context()
  contexts.push(ctx)
  let current: PatrolPolicy | undefined = policy()
  let invalidPreset = false
  let invalidPermission = false
  let invalidModel: unknown
  const resolvedSelections: ModelSelection[] = []
  const updatePatrolPolicy = vi.fn((input: Partial<PatrolPolicy>) => {
    current = { ...current!, ...input, version: current!.version + 1, updatedAt: NOW }
    return Promise.resolve(current)
  })
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'host', model: 'host-model' }),
  } as never)
  ctx.provide('agentPresets', {
    resolve: (id?: string) => invalidPreset
      ? Promise.reject(new Error('unknown Agent Preset'))
      : Promise.resolve({ id: id ?? 'coding' }),
    list: () => Promise.resolve([
      { id: 'coding', name: 'Coding', description: 'Implementation tools.' },
      { id: 'plain' },
      { id: 'broken', name: 'Broken', broken: { message: 'missing plugin' } },
    ]),
  } as never)
  ctx.provide('agents', {} as never)
  ctx.provide('llm', {
    listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
    listModels: () => Promise.resolve([
      { id: 'deepseek-chat', name: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
    ]),
    resolveModelInfo: (_provider: string, model: string) => Promise.resolve(model === 'deepseek-reasoner'
      ? { reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } }
      : {}),
    resolveCallConfig: async (selection: ModelSelection) => {
      resolvedSelections.push(selection)
      if (invalidModel !== undefined) throw invalidModel
      return selection
    },
  } as never)
  ctx.provide('permissionPresets', {
    names: ['workspace-write', 'danger-full-access'],
    defaultPreset: 'workspace-write',
    resolve: () => {
      if (invalidPermission) throw new Error('unknown Permission Preset')
      return { sandbox: 'workspace-write', approval: 'ask' }
    },
    optionOf: (id: string) => id === 'workspace-write'
      ? { value: id, name: 'Workspace Write', description: 'Write inside the Workspace.' }
      : { value: id, name: 'Full Access' },
  } as never)
  ctx.provide('sessionPersistence', {} as never)
  ctx.provide('sessions', {} as never)
  ctx.provide('subprocess', {} as never)
  ctx.provide('taskboard', {
    getPatrolPolicy: () => Promise.resolve(current),
    updatePatrolPolicy,
  } as never)
  ctx.provide('tools', {} as never)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === workspaceId
      ? { id, path: '/workspace', title: 'Workspace', sessionIds: [] }
      : undefined,
    list: () => [],
  } as never)
  const fiber = await ctx.plugin(TaskboardPatrolService, { worktreeRoot: '/worktrees' })
  const service = ctx.taskboardPatrol
  const git = (service as unknown as { git: PatrolGit }).git
  vi.spyOn(git, 'currentBranch').mockResolvedValue('main')
  vi.spyOn(git, 'localBranches').mockResolvedValue(['main', 'release'])
  vi.spyOn(git, 'diff').mockResolvedValue({ patch: '+change', stat: '1 file changed' })
  return {
    ctx,
    fiber,
    service,
    updatePatrolPolicy,
    resolvedSelections,
    current: () => current,
    setCurrent: (value: PatrolPolicy | undefined) => { current = value },
    setInvalidPreset: (value: boolean) => { invalidPreset = value },
    setInvalidPermission: (value: boolean) => { invalidPermission = value },
    setInvalidModel: (value: unknown) => { invalidModel = value },
  }
}

describe('TaskboardPatrolService configuration', () => {
  it('discovers local, preset, model, reasoning, and Permission Preset choices', async () => {
    const test = await harness()
    await expect(test.service.configuration(workspaceId)).resolves.toEqual({
      defaults: {
        baseBranch: 'main',
        agentPreset: 'coding',
        selection: { provider: 'host', model: 'host-model' },
        permissionPreset: 'workspace-write',
      },
      branches: ['main', 'release'],
      agentPresets: [
        { id: 'coding', name: 'Coding', description: 'Implementation tools.' },
        { id: 'plain', name: 'plain' },
      ],
      providers: [{
        id: 'deepseek',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: [] },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoning: [{ id: 'high', name: 'High' }] },
        ],
      }],
      permissionPresets: [
        { id: 'workspace-write', name: 'Workspace Write', description: 'Write inside the Workspace.' },
        { id: 'danger-full-access', name: 'Full Access' },
      ],
    })
  })

  it('validates every Host-owned selection before persisting a policy', async () => {
    const test = await harness()
    await expect(test.service.updatePolicy({
      workspaceId,
      baseBranch: 'release',
      agentPreset: 'plain',
      provider: 'deepseek',
      model: 'deepseek-reasoner',
      reasoningEffort: 'high',
      permissionPreset: 'danger-full-access',
      expectedVersion: 1,
    })).resolves.toMatchObject({ version: 2, baseBranch: 'release' })
    expect(test.resolvedSelections.at(-1)).toEqual({
      provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'high',
    })

    test.setCurrent(policy({ provider: null, model: null, agentPreset: null, baseBranch: null }))
    await expect(test.service.updatePolicy({ workspaceId, expectedVersion: 1 }))
      .resolves.toMatchObject({ provider: null, model: null })
    expect(test.resolvedSelections.at(-1)).toEqual({ provider: 'host', model: 'host-model' })

    test.setCurrent(undefined)
    await expect(test.service.updatePolicy({ workspaceId, expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'workspace_not_found' })
    test.setCurrent(policy())
    await expect(test.service.updatePolicy({ workspaceId, baseBranch: 'remote-only', expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'patrol_policy_invalid' })
    await expect(test.service.updatePolicy({ workspaceId, provider: null, model: 'orphan', expectedVersion: 1 }))
      .rejects.toThrow('configured together')
    await expect(test.service.updatePolicy({ workspaceId, provider: 'deepseek', model: null, expectedVersion: 1 }))
      .rejects.toThrow('configured together')

    test.setInvalidPreset(true)
    await expect(test.service.updatePolicy({ workspaceId, agentPreset: 'missing', expectedVersion: 1 }))
      .rejects.toMatchObject({ code: 'patrol_policy_invalid' })
    test.setInvalidPreset(false)
    test.setInvalidPermission(true)
    await expect(test.service.updatePolicy({ workspaceId, permissionPreset: 'missing', expectedVersion: 1 }))
      .rejects.toThrow('unknown Permission Preset')
    test.setInvalidPermission(false)
    test.setInvalidModel(new Error('unknown model route'))
    await expect(test.service.updatePolicy({ workspaceId, expectedVersion: 1 }))
      .rejects.toThrow('unknown model route')
    test.setInvalidModel('non-error route failure')
    await expect(test.service.updatePolicy({ workspaceId, expectedVersion: 1 }))
      .rejects.toThrow('non-error route failure')
  })

  it('delegates committed diffs and manual triggers to the owned adapters', async () => {
    const test = await harness()
    await expect(test.service.diff({ baseBranch: 'main', worktreePath: '/worktree' } as never, 'abc123'))
      .resolves.toEqual({ patch: '+change', stat: '1 file changed' })
    const run = {
      id: PatrolRunId('run-configuration'), workspaceId, trigger: 'manual' as const,
      scheduledFor: null, state: 'active' as const, result: null, error: null,
      recoveryCount: 0, lastRecoveredAt: null,
      startedAt: NOW, endedAt: null,
    }
    const coordinator = (test.service as unknown as { coordinator: PatrolCoordinator }).coordinator
    vi.spyOn(coordinator, 'trigger').mockResolvedValue(run)
    await expect(test.service.trigger({ workspaceId })).resolves.toBe(run)
  })
})
