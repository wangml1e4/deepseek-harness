/** Host execution support for Workspace Taskboard Patrol Agents. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection, type Agent, type AgentHandle, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {
  Issue,
  PatrolAttempt,
  PatrolDevelopmentContext,
  PatrolPolicy,
} from '@deepseek-ai/dsh-taskboard'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace'
import { PatrolGit, patrolBranch, patrolWorktreePath } from './git.ts'
import type { PatrolGitResult, PatrolWorktree } from './git.ts'

export {
  PatrolGit,
  patrolBranch,
  patrolWorktreePath,
  type PatrolGitConfig,
  type PatrolGitResult,
  type PatrolRepository,
  type PatrolWorktree,
} from './git.ts'

/** Defaults applied to local Git subprocess calls. */
const DEFAULT_GIT_GRACE_MS = 5000
const DEFAULT_GIT_OUTPUT_BYTES = 64 * 1024

/** Taskboard Patrol execution plugin configuration. */
export interface Config {
  /** Host-managed parent directory for permanent Issue worktrees. */
  worktreeRoot: string
  /** Git executable name or absolute path. */
  gitCommand?: string
  /** Termination grace for local Git processes. */
  gitGraceMs?: number
  /** Per-stream diagnostic output cap for local Git processes. */
  gitOutputBytes?: number
}

/** Resolved creation choices captured in a new Development Context. */
export interface PatrolPolicyDefaults {
  /** Local base branch selected from the Workspace checkout. */
  readonly baseBranch: string
  /** Concrete Agent Preset id. */
  readonly agentPreset: string
  /** Canonical provider/model selection. */
  readonly selection: ModelSelection
  /** Existing Permission Preset name. */
  readonly permissionPreset: string
}

/** One tool approval rejected by the unattended Patrol owner. */
export interface RejectedPatrolApproval {
  /** Tool whose operation was rejected. */
  readonly toolName: string
  /** Human-readable reason supplied by the permission gate, when any. */
  readonly reason?: string
}

/** Owned or borrowed live Agent prepared for one Patrol Attempt. */
export interface PatrolAgentLease {
  /** Exact live Agent bound to the Issue. */
  readonly agent: Agent
  /** Persistent Issue execution identity. */
  readonly context: PatrolDevelopmentContext
  /** Verified worktree and Session cwd. */
  readonly worktree: PatrolWorktree
  /** Approval requests rejected during this lease. */
  readonly rejectedApprovals: readonly RejectedPatrolApproval[]
  /** Flush, detach the approval guard, and dispose the Agent only when this lease created or resumed it. */
  release(): Promise<void>
}

interface ResolvedConfig {
  readonly worktreeRoot: string
  readonly gitCommand: string
  readonly gitGraceMs: number
  readonly gitOutputBytes: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskboardPatrol: TaskboardPatrolService
  }
}

/** Host Consumer that binds Patrol claims to local Git isolation and ordinary persistent Agents. */
export class TaskboardPatrolService extends Service {
  static inject = [
    'agentDefaultModel',
    'agentPresets',
    'agents',
    'llm',
    'permissionPresets',
    'sessionPersistence',
    'sessions',
    'subprocess',
    'taskboard',
    'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    worktreeRoot: z.string().required(),
    gitCommand: z.string().default('git'),
    gitGraceMs: z.number().step(1).min(1).default(DEFAULT_GIT_GRACE_MS),
    gitOutputBytes: z.number().step(1).min(1024).default(DEFAULT_GIT_OUTPUT_BYTES),
  })

  private readonly resolved: ResolvedConfig
  private readonly git: PatrolGit

  constructor(ctx: Context, readonly config: Config) {
    super(ctx, 'taskboardPatrol')
    this.resolved = {
      worktreeRoot: config.worktreeRoot,
      gitCommand: config.gitCommand ?? 'git',
      gitGraceMs: config.gitGraceMs ?? DEFAULT_GIT_GRACE_MS,
      gitOutputBytes: config.gitOutputBytes ?? DEFAULT_GIT_OUTPUT_BYTES,
    }
    this.git = new PatrolGit(ctx.subprocess, {
      gitCommand: this.resolved.gitCommand,
      graceMs: this.resolved.gitGraceMs,
      maxOutputBytes: this.resolved.gitOutputBytes,
    })
  }

  /**
   * Resolve the current new-Session defaults and checked-out local branch for a Workspace.
   * @param workspaceId - Registered Workspace whose checkout supplies the branch.
   * @returns concrete values suitable for a Patrol Policy save.
   */
  async defaults(workspaceId: WorkspaceId): Promise<PatrolPolicyDefaults> {
    const workspace = this.requireWorkspace(workspaceId)
    const baseBranch = await this.git.currentBranch(workspace.path)
    const agentPreset = (await this.ctx.agentPresets.resolve()).id
    const selected = this.ctx.agentDefaultModel.currentSelection()
    const selection = await this.resolveSelection(selected)
    const permissionPreset = this.ctx.permissionPresets.names.includes('workspace-write')
      ? 'workspace-write'
      : this.ctx.permissionPresets.defaultPreset
    this.ctx.permissionPresets.resolve(permissionPreset)
    return { baseBranch, agentPreset, selection, permissionPreset }
  }

  /**
   * List branches local to one registered Workspace repository.
   * @param workspaceId - Workspace whose repository is inspected.
   * @returns local branch names.
   */
  localBranches(workspaceId: WorkspaceId): Promise<readonly string[]> {
    return this.git.localBranches(this.requireWorkspace(workspaceId).path)
  }

  /**
   * Check dependency integration against an exact local Base Branch.
   * @param workspaceId - Workspace whose repository is inspected.
   * @param commit - predecessor result commit.
   * @param baseBranch - local branch the successor will start from.
   * @returns whether the commit is an ancestor of the branch.
   */
  isAncestor(workspaceId: WorkspaceId, commit: string, baseBranch: string): Promise<boolean> {
    return this.git.isAncestor(this.requireWorkspace(workspaceId).path, commit, baseBranch)
  }

  /**
   * Create or reuse one claim's permanent Development Context, worktree, and exact Session.
   * @param attempt - active durable claim.
   * @param issue - claimed Issue snapshot.
   * @param policy - saved Workspace Patrol choices for an unbound Issue.
   * @returns a live guarded Agent lease.
   */
  async prepare(
    attempt: PatrolAttempt,
    issue: Issue,
    policy: PatrolPolicy,
  ): Promise<PatrolAgentLease> {
    if (attempt.state !== 'active' || attempt.issueId !== issue.id || issue.status !== 'in_progress') {
      throw new Error(`Patrol Attempt "${attempt.id}" is not the active claim for Issue "${issue.id}"`)
    }
    const workspace = this.requireWorkspace(issue.workspaceId)
    let context = await this.ctx.taskboard.getPatrolDevelopmentContext(issue.id)
    if (context === undefined) {
      if (attempt.sessionId !== null) {
        throw new Error(`Patrol Attempt "${attempt.id}" names Session "${attempt.sessionId}" without a Development Context`)
      }
      context = await this.createBinding(attempt, issue, policy, workspace)
    } else if (attempt.sessionId !== context.sessionId) {
      throw new Error(
        `Patrol Attempt "${attempt.id}" Session does not match Issue "${issue.identifier}" Development Context`,
      )
    }
    const worktree = await this.git.ensureWorktree(workspace.path, context)
    const acquired = await this.acquireAgent(context, worktree.sessionCwd)
    try {
      await workspace.attachSession(context.sessionId)
      await this.ctx.sessions.flush(acquired.agent.session)
      context = await this.ctx.taskboard.markPatrolSessionStarted(attempt.id)
    } catch (error: unknown) {
      await acquired.handle?.dispose()
      throw error
    }
    return this.lease(acquired.agent, acquired.handle, context, worktree)
  }

  /**
   * Read commit, cleanliness, and Base Branch diff evidence from a bound Issue worktree.
   * @param context - persistent Development Context.
   * @returns current local Git evidence.
   */
  result(context: PatrolDevelopmentContext): Promise<PatrolGitResult> {
    return this.git.result(context)
  }

  /** Resolve and persist one new Issue's immutable execution choices. */
  private async createBinding(
    attempt: PatrolAttempt,
    issue: Issue,
    policy: PatrolPolicy,
    workspace: Workspace,
  ): Promise<PatrolDevelopmentContext> {
    const resolved = await this.resolvePolicy(policy, workspace)
    const sessionId = SessionId(`session-${randomUUID()}`)
    return await this.ctx.taskboard.bindPatrolDevelopmentContext({
      attemptId: attempt.id,
      context: {
        sessionId,
        baseBranch: resolved.baseBranch,
        branch: patrolBranch(issue.identifier),
        worktreePath: patrolWorktreePath(
          this.resolved.worktreeRoot,
          String(issue.workspaceId),
          issue.identifier,
        ),
        agentPreset: resolved.agentPreset,
        provider: resolved.selection.provider,
        model: resolved.selection.model,
        reasoningEffort: resolved.selection.reasoningEffort ?? null,
        permissionPreset: resolved.permissionPreset,
      },
    })
  }

  /** Resolve nullable saved choices only for a never-bound Issue. */
  private async resolvePolicy(policy: PatrolPolicy, workspace: Workspace): Promise<PatrolPolicyDefaults> {
    const baseBranch = policy.baseBranch ?? await this.git.currentBranch(workspace.path)
    const baseBranchExists = (await this.git.localBranches(workspace.path)).includes(baseBranch)
    if (!baseBranchExists) {
      throw new Error(`Patrol Base Branch "${baseBranch}" is not a local branch of Workspace "${workspace.title}"`)
    }
    const agentPreset = (await this.ctx.agentPresets.resolve(policy.agentPreset ?? undefined)).id
    const defaults = this.ctx.agentDefaultModel.currentSelection()
    let route: ModelSelection
    if (policy.provider === null) {
      if (policy.model !== null) throw new Error('Patrol model requires a provider route')
      route = defaults
    } else {
      if (policy.model === null) throw new Error('Patrol provider route requires a model')
      route = { provider: policy.provider, model: policy.model }
    }
    const selected: ModelSelection = policy.reasoningEffort === null
      ? route
      : { ...route, reasoningEffort: ReasoningEffortId(policy.reasoningEffort) }
    const selection = await this.resolveSelection(selected)
    this.ctx.permissionPresets.resolve(policy.permissionPreset)
    return { baseBranch, agentPreset, selection, permissionPreset: policy.permissionPreset }
  }

  /** Canonicalize one model selection through the LLM capability. */
  private async resolveSelection(selection: ModelSelection): Promise<ModelSelection> {
    const resolved = await this.ctx.llm.resolveCallConfig(selection)
    return {
      provider: resolved.provider,
      model: resolved.model,
      ...resolved.reasoningEffort === undefined ? {} : { reasoningEffort: resolved.reasoningEffort },
    }
  }

  /** Acquire the exact live, persisted, or just-bound Session without replacement. */
  private async acquireAgent(
    context: PatrolDevelopmentContext,
    cwd: string,
  ): Promise<{ agent: Agent; handle?: AgentHandle }> {
    const live = this.ctx.agents.get(context.sessionId)
    if (live !== undefined) {
      if (live.session.header.cwd !== cwd) {
        throw new Error(`bound Patrol Session "${context.sessionId}" is live in a different directory`)
      }
      if (this.ctx.agentPresets.composedPreset(live.ctx) !== context.agentPreset) {
        throw new Error(`bound Patrol Session "${context.sessionId}" is live under a different Agent Preset`)
      }
      if (live.status !== 'idle') throw new Error(`bound Patrol Session "${context.sessionId}" is already running`)
      return { agent: live }
    }
    const persisted = (await this.ctx.sessionPersistence.list())
      .some(header => header.id === context.sessionId)
    if (!persisted && context.sessionStartedAt !== null) {
      throw new Error(`bound Patrol Session "${context.sessionId}" cannot be resumed from persistence`)
    }
    const setup = async (agentCtx: Context): Promise<void> => {
      const agent = agentCtx.agent
      if (agent === undefined) throw new Error('Taskboard Patrol setup has no scoped Agent')
      await this.ctx.agentPresets.mount(agentCtx, context.agentPreset)
      const selected: ModelSelectionRef = {
        current: this.loggedOrBoundSelection(agent, context),
        assembled: undefined,
      }
      installModelSelection(agentCtx, selected)
      if (!persisted) this.ctx.permissionPresets.set(agent.session, context.permissionPreset)
    }
    const handle = persisted
      ? await this.ctx.agents.resume({
        resumeSessionId: context.sessionId,
        agentOptions: { provider: context.provider, model: context.model },
        setup,
      })
      : await this.ctx.agents.create({
        sessionId: context.sessionId,
        meta: { cwd, agentPreset: context.agentPreset },
        agentOptions: { provider: context.provider, model: context.model },
        setup,
      })
    return { agent: handle.agent, handle }
  }

  /** Keep a resumed Session's logged model selection ahead of its original binding snapshot. */
  private loggedOrBoundSelection(agent: Agent, context: PatrolDevelopmentContext): ModelSelection {
    const logged = agent.session.requestHeader()?.config
    if (logged !== undefined) {
      return {
        provider: logged.provider,
        model: logged.model,
        ...logged.reasoningEffort === undefined ? {} : { reasoningEffort: logged.reasoningEffort },
      }
    }
    return {
      provider: context.provider,
      model: context.model,
      ...context.reasoningEffort === null ? {} : { reasoningEffort: ReasoningEffortId(context.reasoningEffort) },
    }
  }

  /** Install the unattended approval answerer and own a created/resumed handle's teardown. */
  private lease(
    agent: Agent,
    handle: AgentHandle | undefined,
    context: PatrolDevelopmentContext,
    worktree: PatrolWorktree,
  ): PatrolAgentLease {
    const rejectedApprovals: RejectedPatrolApproval[] = []
    const stopApproval = agent.ctx.on('approval/request', (request, next) => {
      if (request.agent !== agent) return next()
      rejectedApprovals.push({
        toolName: request.toolName,
        ...request.reason === undefined ? {} : { reason: request.reason },
      })
      queueMicrotask(() => {
        agent.cancel({ kind: 'hook', reason: 'Taskboard Patrol rejected an unattended tool approval' })
      })
      return Promise.resolve('rejected')
    }, { prepend: true })
    let released = false
    return {
      agent,
      context,
      worktree,
      rejectedApprovals,
      release: async () => {
        if (released) return
        released = true
        stopApproval()
        try {
          await this.ctx.sessions.flush(agent.session)
        } finally {
          await handle?.dispose()
        }
      },
    }
  }

  /** Resolve one registered Workspace or fail before any filesystem action. */
  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) throw new Error(`Workspace "${workspaceId}" is not registered`)
    return workspace
  }
}

export default TaskboardPatrolService
