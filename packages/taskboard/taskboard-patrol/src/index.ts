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
  IssueId,
  IssueReference,
  PatrolAttempt,
  PatrolDevelopmentContext,
  PatrolPolicy,
  PatrolRun,
  UpdatePatrolPolicyInput,
} from '@deepseek-ai/dsh-taskboard'
import { TaskboardError } from '@deepseek-ai/dsh-taskboard'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-workspace'
import { PatrolCoordinator, type TriggerPatrolRunInput } from './coordinator.ts'
import { PatrolGit, patrolBranch, patrolWorktreePath } from './git.ts'
import type { PatrolGitDiff, PatrolGitResult, PatrolWorktree } from './git.ts'

export {
  PatrolGit,
  patrolBranch,
  patrolWorktreePath,
  type PatrolGitConfig,
  type PatrolGitDiff,
  type PatrolGitResult,
  type PatrolRepository,
  type PatrolWorktree,
} from './git.ts'
export type { TriggerPatrolRunInput } from './coordinator.ts'

/** Explicit user request to remove one safely integrated Issue worktree. */
export interface RemovePatrolWorktreeInput {
  /** Registered Workspace that owns the Issue. */
  readonly workspaceId: WorkspaceId
  /** Opaque Issue id or human-readable identifier. */
  readonly reference: IssueReference
  /** Explicit acknowledgement that the physical worktree will be removed. */
  readonly confirmed: boolean
}

/** Preserved Development Context identities returned after physical worktree removal. */
export interface PatrolWorktreeRemoval {
  /** Removed physical worktree path. */
  readonly worktreePath: string
  /** Preserved local Issue branch. */
  readonly branch: string
  /** Preserved result commit already recorded for the Issue. */
  readonly resultCommit: string
}

/** Why one predecessor prevents a Patrol claim. */
export type PatrolDependencyWaitReason = 'predecessor_not_done' | 'waiting_for_integration'

/** One predecessor whose current state prevents a Patrol claim. */
export interface PatrolDependencyWait {
  /** Blocking Issue identity. */
  readonly issueId: IssueId
  /** User-visible reason the successor must wait. */
  readonly reason: PatrolDependencyWaitReason
}

/** Current dependency evidence used by both claim execution and read projections. */
export interface PatrolDependencyInspection {
  /** Exact integrated predecessor commits supplied to the atomic claim. */
  readonly dependencyCommits: Readonly<Record<string, string>>
  /** Unsatisfied predecessors in relation order. */
  readonly waits: readonly PatrolDependencyWait[]
}

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

/** One selectable Agent Preset for new Issue bindings. */
export interface PatrolAgentPresetOption {
  /** Stable preset id. */
  readonly id: string
  /** User-facing preset name. */
  readonly name: string
  /** Optional preset summary. */
  readonly description?: string
}

/** One selectable reasoning effort for an exact provider/model route. */
export interface PatrolReasoningOption {
  /** Adapter-owned stable value. */
  readonly id: string
  /** User-facing effort name. */
  readonly name: string
}

/** One selectable model and its adapter-owned reasoning choices. */
export interface PatrolModelOption {
  /** Model id sent to the provider. */
  readonly id: string
  /** User-facing model name. */
  readonly name: string
  /** Reasoning values accepted for this exact route. */
  readonly reasoning: readonly PatrolReasoningOption[]
}

/** One live provider route and its advisory model catalog. */
export interface PatrolProviderOption {
  /** Stable provider route id. */
  readonly id: string
  /** User-facing provider name. */
  readonly name: string
  /** Adapter-advertised models. */
  readonly models: readonly PatrolModelOption[]
}

/** One existing Permission Preset available to new Issue bindings. */
export interface PatrolPermissionOption {
  /** Stable Permission Preset name. */
  readonly id: string
  /** User-facing Permission Preset name. */
  readonly name: string
  /** Optional security summary. */
  readonly description?: string
}

/** Host-resolved choices presented by Patrol configuration clients. */
export interface PatrolConfiguration {
  /** Current defaults used when a saved nullable choice follows the Host. */
  readonly defaults: PatrolPolicyDefaults
  /** Branches already present in the local Workspace repository. */
  readonly branches: readonly string[]
  /** Mountable Agent Presets. */
  readonly agentPresets: readonly PatrolAgentPresetOption[]
  /** Live provider routes with their model catalogs. */
  readonly providers: readonly PatrolProviderOption[]
  /** Existing Permission Presets. */
  readonly permissionPresets: readonly PatrolPermissionOption[]
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
    'tools',
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
  private readonly coordinator: PatrolCoordinator

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
    this.coordinator = new PatrolCoordinator(ctx, this)
    ctx.effect(() => this.coordinator.start(), 'taskboardPatrol.coordinator')
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
   * Discover all choices needed by the Patrol settings sidebar.
   * @param workspaceId - registered Workspace whose local branches are listed.
   * @returns current defaults and selectable Host configuration.
   */
  async configuration(workspaceId: WorkspaceId): Promise<PatrolConfiguration> {
    const [defaults, branches, presets] = await Promise.all([
      this.defaults(workspaceId),
      this.localBranches(workspaceId),
      this.ctx.agentPresets.list(),
    ])
    const providers = await Promise.all(this.ctx.llm.listProviders().map(async (provider) => {
      const catalog = await this.ctx.llm.listModels(provider.id)
      const models = await Promise.all(catalog.map(async (model) => {
        const resolved = await this.ctx.llm.resolveModelInfo(provider.id, model.id)
        return {
          id: model.id,
          name: model.name,
          reasoning: resolved.reasoning?.efforts.map(effort => ({
            id: effort.id,
            name: effort.name,
          })) ?? [],
        }
      }))
      return { id: provider.id, name: provider.name, models }
    }))
    return {
      defaults,
      branches,
      agentPresets: presets
        .filter(preset => preset.broken === undefined)
        .map(preset => ({
          id: preset.id,
          name: preset.name ?? preset.id,
          ...preset.description === undefined ? {} : { description: preset.description },
        })),
      providers,
      permissionPresets: this.ctx.permissionPresets.names.map((id) => {
        const option = this.ctx.permissionPresets.optionOf(id)
        return {
          id,
          name: option.name,
          ...option.description === undefined ? {} : { description: option.description },
        }
      }),
    }
  }

  /**
   * Validate Host-owned choices before saving one version-checked policy.
   * @param input - replacement policy fields.
   * @returns updated durable policy.
   */
  async updatePolicy(input: UpdatePatrolPolicyInput): Promise<PatrolPolicy> {
    this.requireWorkspace(input.workspaceId)
    const current = await this.ctx.taskboard.getPatrolPolicy(input.workspaceId)
    if (current === undefined) {
      throw new TaskboardError('workspace_not_found', `Workspace "${input.workspaceId}" has no Taskboard Patrol Policy`)
    }
    const baseBranch = input.baseBranch === undefined ? current.baseBranch : input.baseBranch
    if (baseBranch !== null && !(await this.localBranches(input.workspaceId)).includes(baseBranch)) {
      throw new TaskboardError('patrol_policy_invalid', `Patrol Base Branch "${baseBranch}" is not a local branch`)
    }
    const agentPreset = input.agentPreset === undefined ? current.agentPreset : input.agentPreset
    const permissionPreset = input.permissionPreset ?? current.permissionPreset
    const provider = input.provider === undefined ? current.provider : input.provider
    const model = input.model === undefined ? current.model : input.model
    const reasoningEffort = input.reasoningEffort === undefined
      ? current.reasoningEffort
      : input.reasoningEffort
    try {
      if (agentPreset !== null) await this.ctx.agentPresets.resolve(agentPreset)
      this.ctx.permissionPresets.resolve(permissionPreset)
      const defaults = this.ctx.agentDefaultModel.currentSelection()
      let route: ModelSelection
      if (provider === null) {
        if (model !== null) {
          throw new TaskboardError('patrol_policy_invalid', 'Patrol provider and model must be configured together')
        }
        route = defaults
      } else {
        if (model === null) {
          throw new TaskboardError('patrol_policy_invalid', 'Patrol provider and model must be configured together')
        }
        route = { provider, model }
      }
      await this.resolveSelection(reasoningEffort === null
        ? route
        : { ...route, reasoningEffort: ReasoningEffortId(reasoningEffort) })
    } catch (error: unknown) {
      if (error instanceof TaskboardError) throw error
      throw new TaskboardError(
        'patrol_policy_invalid',
        `Patrol configuration is invalid: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return await this.ctx.taskboard.updatePatrolPolicy(input)
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
   * Inspect every blocked-by predecessor against the Base Branch used by an Issue.
   * @param issue - Successor whose dependency state is inspected.
   * @param policy - Saved Workspace policy used when the Issue has no Development Context.
   * @returns integrated commit evidence plus distinct unfinished and unintegrated waits.
   */
  async inspectDependencies(
    issue: Issue,
    policy: PatrolPolicy,
  ): Promise<PatrolDependencyInspection> {
    const context = await this.ctx.taskboard.getPatrolDevelopmentContext(issue.id)
    const baseBranch = context?.baseBranch
      ?? policy.baseBranch
      ?? (await this.defaults(issue.workspaceId)).baseBranch
    const dependencyCommits: Record<string, string> = {}
    const waits: PatrolDependencyWait[] = []
    for (const relation of await this.ctx.taskboard.listRelations(issue.id)) {
      if (relation.type !== 'blocked_by') continue
      const blocker = await this.ctx.taskboard.getIssue(relation.relatedIssueId)
      if (blocker?.status !== 'done') {
        waits.push({ issueId: relation.relatedIssueId, reason: 'predecessor_not_done' })
        continue
      }
      const blockerContext = await this.ctx.taskboard.getPatrolDevelopmentContext(blocker.id)
      const resultCommit = blockerContext?.resultCommit
      if (
        resultCommit === null
        || resultCommit === undefined
        || !await this.isAncestor(issue.workspaceId, resultCommit, baseBranch)
      ) {
        waits.push({ issueId: blocker.id, reason: 'waiting_for_integration' })
        continue
      }
      dependencyCommits[String(blocker.id)] = resultCommit
    }
    return { dependencyCommits, waits }
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

  /**
   * Read one exact committed diff for an independent Reviewer.
   * @param context - persistent Development Context.
   * @param commit - exact preliminary implementation commit.
   * @returns bounded patch and summary.
   */
  diff(context: PatrolDevelopmentContext, commit: string): Promise<PatrolGitDiff> {
    return this.git.diff(context, commit)
  }

  /**
   * Read whether one recorded physical Issue worktree is currently present.
   * @param context - persistent Development Context.
   * @returns true only for the exact physical directory.
   */
  worktreePresent(context: PatrolDevelopmentContext): Promise<boolean> {
    return this.git.worktreePresent(context)
  }

  /**
   * Remove one exact physical Issue worktree while preserving its branch and durable binding.
   * @param input - Workspace, Issue lookup, and explicit confirmation.
   * @returns preserved branch, path, and result-commit identities; rejects unless the worktree is
   * clean and its result commit is integrated.
   */
  async removeWorktree(input: RemovePatrolWorktreeInput): Promise<PatrolWorktreeRemoval> {
    if (!input.confirmed) {
      throw new TaskboardError(
        'patrol_worktree_confirmation_required',
        'Explicit confirmation is required to remove a Patrol worktree',
      )
    }
    const workspace = this.requireWorkspace(input.workspaceId)
    const issue = await this.ctx.taskboard.getIssue(input.reference)
    if (issue === undefined || issue.workspaceId !== input.workspaceId) {
      throw new TaskboardError('issue_not_found', `Issue "${input.reference}" does not exist in this Workspace`)
    }
    const context = await this.ctx.taskboard.getPatrolDevelopmentContext(issue.id)
    if (context === undefined || context.resultCommit === null) {
      throw new TaskboardError('patrol_context_missing', `Issue "${issue.identifier}" has no completed Development Context`)
    }
    if (!(await this.git.worktreePresent(context))) {
      throw new TaskboardError(
        'patrol_worktree_missing',
        `Issue "${issue.identifier}" physical worktree is not present`,
      )
    }
    if (!(await this.git.result(context)).clean) {
      throw new TaskboardError(
        'patrol_worktree_not_clean',
        `Issue "${issue.identifier}" worktree has uncommitted changes`,
      )
    }
    if (!(await this.git.isAncestor(workspace.path, context.resultCommit, context.baseBranch))) {
      throw new TaskboardError(
        'patrol_worktree_not_integrated',
        `Issue "${issue.identifier}" result commit is not integrated into Base Branch "${context.baseBranch}"`,
      )
    }
    await this.git.removeWorktree(workspace.path, context)
    return {
      worktreePath: context.worktreePath,
      branch: context.branch,
      resultCommit: context.resultCommit,
    }
  }

  /**
   * Start one manual background Run under Host-wide exclusivity.
   * @param input - Workspace and optional exact todo Issue.
   * @returns active durable Run accepted by the Taskboard Provider.
   */
  trigger(input: TriggerPatrolRunInput): Promise<PatrolRun> {
    return this.coordinator.trigger(input)
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
