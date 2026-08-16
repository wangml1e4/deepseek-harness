/** Fixed-interval Taskboard Patrol coordinator and one-Issue Run executor. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  TaskboardActorId,
  TaskboardError,
  type Issue,
  type IssueReference,
  type PatrolAttempt,
  type PatrolPolicy,
  type PatrolReview,
  type PatrolRun,
} from '@deepseek-ai/dsh-taskboard'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { TaskboardPatrolService } from './index.ts'
import { hasExplicitWait, implementationPrompt, recoveryPrompt, remediationPrompt } from './prompts.ts'
import { PatrolReviewer } from './reviewer.ts'
import { PatrolTelemetryRecorder } from './telemetry.ts'

const MAX_TIMER_MS = 2_147_483_647
const PATROL_ACTOR = {
  type: 'patrol_agent' as const,
  id: TaskboardActorId('taskboard-patrol'),
  name: 'Taskboard Patrol',
}

interface EligibleIssue {
  readonly issue: Issue
  readonly dependencyCommits: Readonly<Record<string, string>>
}

/** Manual trigger accepted by the Patrol Host Consumer. */
export interface TriggerPatrolRunInput {
  /** Workspace whose saved policy and todo Issues are used. */
  readonly workspaceId: WorkspaceId
  /** Optional exact todo Issue requested by the user. */
  readonly issue?: IssueReference
}

/** Coordinates fixed due instants and background Run execution. */
export class PatrolCoordinator {
  private readonly reviewer: PatrolReviewer
  private readonly executing = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private scheduleGeneration = 0
  private recovering = false
  private stopped = false

  constructor(
    private readonly ctx: Context,
    private readonly host: TaskboardPatrolService,
  ) {
    this.reviewer = new PatrolReviewer(ctx)
  }

  /**
   * Start fixed-interval observation and return its disposer.
   * @returns disposer that prevents later timers without aborting an active Run.
   */
  start(): () => void {
    const stopChanged = this.ctx.on('taskboard/changed', () => { this.reschedule() })
    this.recovering = true
    void this.recover().then(() => {
      if (this.stopped) return
      this.recovering = false
      this.reschedule()
    }).catch((error: unknown) => {
      this.ctx.logger.error(`taskboard-patrol: startup recovery failed before scheduling: ${String(error)}`)
    })
    return () => {
      this.stopped = true
      this.scheduleGeneration += 1
      stopChanged()
      if (this.timer !== undefined) clearTimeout(this.timer)
      this.timer = undefined
    }
  }

  /**
   * Persist and asynchronously execute one manual Run.
   * @param input - Workspace and optional exact todo Issue.
   * @returns active durable Run after its trigger is accepted.
   */
  async trigger(input: TriggerPatrolRunInput): Promise<PatrolRun> {
    const run = await this.ctx.taskboard.beginPatrolRun({
      workspaceId: input.workspaceId,
      trigger: 'manual',
    })
    this.launch(run, input.issue)
    return run
  }

  /** Reschedule from durable policy instants while discarding stale async scans. */
  private reschedule(): void {
    if (this.stopped || this.recovering) return
    const generation = ++this.scheduleGeneration
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    void this.nextDueAt().then((dueAt) => {
      if (this.stopped || generation !== this.scheduleGeneration || dueAt === undefined) return
      const delay = Math.min(Math.max(dueAt - Date.now(), 0), MAX_TIMER_MS)
      this.timer = setTimeout(() => { void this.tick() }, delay)
      this.timer.unref()
    }).catch((error: unknown) => {
      this.ctx.logger.warn(`taskboard-patrol: could not schedule the next Patrol Run: ${String(error)}`)
    })
  }

  /** Read the earliest enabled next-due instant across registered Workspaces. */
  private async nextDueAt(): Promise<number | undefined> {
    const policies = await Promise.all(this.ctx.workspaceRegistry.list().map(workspace =>
      this.ctx.taskboard.getPatrolPolicy(workspace.id)))
    const due = policies
      .filter((policy): policy is PatrolPolicy => policy?.enabled === true && policy.nextDueAt !== null)
      .map(policy => Date.parse(policy.nextDueAt as string))
      .filter(value => Number.isFinite(value))
    return due.length === 0 ? undefined : Math.min(...due)
  }

  /** Persist every currently due trigger; Host-wide exclusivity skips overlaps durably. */
  private async tick(): Promise<void> {
    if (this.stopped) return
    this.timer = undefined
    try {
      for (const policy of await this.ctx.taskboard.listDuePatrolPolicies()) {
        const run = await this.ctx.taskboard.beginPatrolRun({
          workspaceId: policy.workspaceId,
          trigger: 'scheduled',
        })
        if (run.state === 'active') this.launch(run)
      }
    } catch (error: unknown) {
      this.ctx.logger.warn(`taskboard-patrol: scheduled trigger failed: ${String(error)}`)
    } finally {
      this.reschedule()
    }
  }

  /** Launch one Run once and contain background failures in its durable history. */
  private launch(run: PatrolRun, preferred?: IssueReference): void {
    void this.perform(run, preferred)
  }

  /** Own one background Run's deduplication, terminal containment, and rescheduling. */
  private async perform(
    run: PatrolRun,
    preferred?: IssueReference,
    recovery = false,
  ): Promise<void> {
    if (run.state !== 'active' || this.executing.has(run.id)) return
    this.executing.add(run.id)
    try {
      if (recovery) await this.recoverRun(run)
      else await this.execute(run, preferred)
    } catch (error: unknown) {
      try {
        await this.ctx.taskboard.completePatrolRun({
          runId: run.id,
          result: 'failed',
          error: errorText(error),
        })
      } catch (completionError: unknown) {
        this.ctx.logger.error(`taskboard-patrol: Run "${run.id}" failed and could not be completed: ${String(completionError)}`)
      }
    } finally {
      this.executing.delete(run.id)
      this.reschedule()
    }
  }

  /** Recover the Host-wide unfinished Run before any new scheduled trigger. */
  private async recover(): Promise<void> {
    const active = await this.ctx.taskboard.getActivePatrolRun()
    if (active === undefined) return
    const recorded = await this.ctx.taskboard.recordPatrolRecovery(active.id)
    await this.perform(recorded, undefined, true)
  }

  /** Reconcile a durable Run checkpoint or resume its exact active Attempt. */
  private async recoverRun(run: PatrolRun): Promise<void> {
    const attempts = await this.ctx.taskboard.listPatrolAttempts(run.id)
    const latest = attempts.at(-1)
    if (latest === undefined || latest.result === 'permission_blocked') {
      await this.execute(run)
      return
    }
    if (latest.state === 'completed') {
      await this.ctx.taskboard.completePatrolRun({
        runId: run.id,
        result: latest.result === 'review_handoff'
          ? 'review_handoff'
          : latest.result === 'blocked' ? 'blocked' : 'failed',
        ...latest.error === null ? {} : { error: latest.error },
      })
      return
    }
    const issue = await this.ctx.taskboard.getIssue(latest.issueId)
    if (issue === undefined) {
      await this.ctx.taskboard.failPatrolRecovery({
        runId: run.id,
        attemptId: latest.id,
        error: `Patrol recovery cannot find Issue "${latest.issueId}"`,
        actor: PATROL_ACTOR,
      })
      return
    }
    const context = await this.ctx.taskboard.getPatrolDevelopmentContext(latest.issueId)
    if (context === undefined || latest.sessionId !== context.sessionId) {
      await this.ctx.taskboard.failPatrolRecovery({
        runId: run.id,
        attemptId: latest.id,
        error: context === undefined
          ? `Patrol recovery Issue "${issue.identifier}" has no persistent Development Context`
          : `Patrol recovery Attempt "${latest.id}" does not name the exact bound Session`,
        actor: PATROL_ACTOR,
      })
      return
    }
    const policy = await this.ctx.taskboard.getPatrolPolicy(run.workspaceId)
    if (policy === undefined) {
      await this.ctx.taskboard.failPatrolRecovery({
        runId: run.id,
        attemptId: latest.id,
        error: `Workspace "${run.workspaceId}" has no Taskboard Patrol Policy`,
        actor: PATROL_ACTOR,
      })
      return
    }
    const review = (await this.ctx.taskboard.listPatrolReviews(issue.id))
      .find(value => value.attemptId === latest.id)
    const telemetry = new PatrolTelemetryRecorder()
    try {
      await this.restoreRecoveryTelemetry(telemetry, latest, context.sessionId, review)
      const outcome = await this.executeAttempt(
        latest,
        issue,
        policy,
        telemetry,
        review === undefined ? {} : { review },
      )
      if (outcome.kind === 'permission_blocked') {
        await this.ctx.taskboard.completePatrolAttempt({
          attemptId: latest.id,
          result: 'permission_blocked',
          error: outcome.reason,
          ...telemetry.fields(),
          actor: PATROL_ACTOR,
        })
        await this.execute(run)
        return
      }
      await this.ctx.taskboard.completePatrolAttempt({
        attemptId: latest.id,
        result: 'review_handoff',
        resultCommit: outcome.commit,
        ...telemetry.fields(),
        actor: PATROL_ACTOR,
      })
      await this.ctx.taskboard.completePatrolRun({ runId: run.id, result: 'review_handoff' })
    } catch (error: unknown) {
      await this.ctx.taskboard.failPatrolRecovery({
        runId: run.id,
        attemptId: latest.id,
        error: errorText(error),
        ...telemetry.fields(),
        actor: PATROL_ACTOR,
      })
    }
  }

  /** Restore pre-crash Attempt accounting from its exact persisted Sessions. */
  private async restoreRecoveryTelemetry(
    telemetry: PatrolTelemetryRecorder,
    attempt: PatrolAttempt,
    implementationSessionId: SessionId,
    review: PatrolReview | undefined,
  ): Promise<void> {
    const startedAt = Date.parse(attempt.startedAt)
    const implementation = await this.ctx.sessionPersistence.load(implementationSessionId)
    telemetry.record(implementation.events.filter(event => event.time >= startedAt))
    if (review === undefined) return
    telemetry.record((await this.ctx.sessionPersistence.load(review.sessionId)).events)
  }

  /** Execute zero or more claims, continuing only after a permission-blocked Attempt. */
  private async execute(run: PatrolRun, preferred?: IssueReference): Promise<void> {
    const policy = await this.ctx.taskboard.getPatrolPolicy(run.workspaceId)
    if (policy === undefined) throw new Error(`Workspace "${run.workspaceId}" has no Taskboard Patrol Policy`)
    const attempts = await this.ctx.taskboard.listPatrolAttempts(run.id)
    let permissionBlocks = attempts.filter(value => value.result === 'permission_blocked').length
    let requested = preferred
    for (;;) {
      const candidate = await this.claimNext(run, policy, requested)
      requested = undefined
      if (candidate === undefined) {
        await this.ctx.taskboard.completePatrolRun({
          runId: run.id,
          result: permissionBlocks === 0 ? 'no_eligible_issue' : 'blocked',
          ...permissionBlocks === 0 ? {} : { error: `${permissionBlocks} Issue(s) were blocked by tool permission approval` },
        })
        return
      }
      let outcome: Awaited<ReturnType<PatrolCoordinator['executeAttempt']>>
      const telemetry = new PatrolTelemetryRecorder()
      try {
        outcome = await this.executeAttempt(candidate.attempt, candidate.issue, policy, telemetry)
      } catch (error: unknown) {
        await this.ctx.taskboard.completePatrolAttempt({
          attemptId: candidate.attempt.id,
          result: 'failed',
          error: errorText(error),
          ...telemetry.fields(),
          actor: PATROL_ACTOR,
        })
        throw error
      }
      if (outcome.kind === 'permission_blocked') {
        permissionBlocks += 1
        await this.ctx.taskboard.completePatrolAttempt({
          attemptId: candidate.attempt.id,
          result: 'permission_blocked',
          error: outcome.reason,
          ...telemetry.fields(),
          actor: PATROL_ACTOR,
        })
        continue
      }
      await this.ctx.taskboard.completePatrolAttempt({
        attemptId: candidate.attempt.id,
        result: 'review_handoff',
        resultCommit: outcome.commit,
        ...telemetry.fields(),
        actor: PATROL_ACTOR,
      })
      await this.ctx.taskboard.completePatrolRun({
        runId: run.id,
        result: 'review_handoff',
      })
      return
    }
  }

  /** Scan in manual order and atomically claim the first still-eligible Issue. */
  private async claimNext(
    run: PatrolRun,
    policy: PatrolPolicy,
    preferred?: IssueReference,
  ): Promise<{ issue: Issue; attempt: PatrolAttempt } | undefined> {
    const issues = preferred === undefined
      ? await this.ctx.taskboard.listIssues({ workspaceId: run.workspaceId, status: 'todo' })
      : await this.ctx.taskboard.getIssue(preferred).then(issue => issue === undefined ? [] : [issue])
    for (const issue of issues) {
      const eligible = await this.eligible(issue, run.workspaceId, policy)
      if (eligible === undefined) continue
      try {
        const attempt = await this.ctx.taskboard.claimPatrolIssue({
          runId: run.id,
          reference: issue.id,
          expectedVersion: issue.version,
          dependencyCommits: eligible.dependencyCommits,
          actor: PATROL_ACTOR,
        })
        const claimed = await this.ctx.taskboard.getIssue(issue.id)
        if (claimed === undefined) throw new Error(`claimed Issue "${issue.identifier}" disappeared`)
        return { issue: claimed, attempt }
      } catch (error: unknown) {
        if (error instanceof TaskboardError && (
          error.code === 'version_conflict'
          || error.code === 'patrol_issue_ineligible'
        )) continue
        throw error
      }
    }
    return undefined
  }

  /** Resolve structural, explicit-wait, and local dependency eligibility. */
  private async eligible(
    issue: Issue,
    workspaceId: WorkspaceId,
    policy: PatrolPolicy,
  ): Promise<EligibleIssue | undefined> {
    if (
      issue.workspaceId !== workspaceId
      || issue.status !== 'todo'
      || issue.archivedAt !== null
      || issue.assignee === 'user'
      || hasExplicitWait(`${issue.title}\n${issue.description}`)
    ) return undefined
    const comments = await this.ctx.taskboard.listComments(issue.id)
    if (hasExplicitWait(comments.at(-1)?.body ?? '')) return undefined
    const context = await this.ctx.taskboard.getPatrolDevelopmentContext(issue.id)
    const baseBranch = context?.baseBranch
      ?? policy.baseBranch
      ?? (await this.host.defaults(workspaceId)).baseBranch
    const dependencyCommits: Record<string, string> = {}
    const relations = await this.ctx.taskboard.listRelations(issue.id)
    for (const relation of relations) {
      if (relation.type !== 'blocked_by') continue
      const blocker = await this.ctx.taskboard.getIssue(relation.relatedIssueId)
      const blockerContext = await this.ctx.taskboard.getPatrolDevelopmentContext(relation.relatedIssueId)
      if (
        blocker?.status !== 'done'
        || blockerContext?.resultCommit === null
        || blockerContext?.resultCommit === undefined
        || !await this.host.isAncestor(workspaceId, blockerContext.resultCommit, baseBranch)
      ) return undefined
      dependencyCommits[String(blocker.id)] = blockerContext.resultCommit
    }
    return { issue, dependencyCommits }
  }

  /** Run implementation, independent review, and one correction turn in the exact Issue Session. */
  private async executeAttempt(
    attempt: PatrolAttempt,
    issue: Issue,
    policy: PatrolPolicy,
    telemetry: PatrolTelemetryRecorder,
    recovery?: { readonly review?: PatrolReview },
  ): Promise<{ kind: 'permission_blocked'; reason: string } | { kind: 'review_handoff'; commit: string }> {
    const lease = await this.host.prepare(attempt, issue, policy)
    try {
      let review = recovery?.review
      if (review === undefined) {
        await runAgentTurn(lease.agent, recovery === undefined
          ? implementationPrompt(issue)
          : recoveryPrompt(issue), telemetry)
        const firstApproval = permissionReason(lease.rejectedApprovals)
        if (firstApproval !== undefined) return { kind: 'permission_blocked', reason: firstApproval }
        const preliminary = await this.host.result(lease.context)
        requireCommittable(preliminary.clean, preliminary.changedFromBase, issue)
        const diff = await this.host.diff(lease.context, preliminary.head)
        const workspace = this.ctx.workspaceRegistry.get(issue.workspaceId)
        if (workspace === undefined) throw new Error(`Workspace "${issue.workspaceId}" is not registered`)
        const reviewed = await this.reviewer.review(
          attempt,
          issue,
          lease.context,
          lease.worktree,
          preliminary.head,
          diff,
          workspace,
          telemetry,
        )
        review = await this.ctx.taskboard.recordPatrolReview({
          attemptId: attempt.id,
          ...reviewed,
        })
      }
      await runAgentTurn(lease.agent, remediationPrompt(review), telemetry)
      const correctionApproval = permissionReason(lease.rejectedApprovals)
      if (correctionApproval !== undefined) return { kind: 'permission_blocked', reason: correctionApproval }
      const result = await this.host.result(lease.context)
      requireCommittable(result.clean, result.changedFromBase, issue)
      if (review.verdict === 'changes_requested' && result.head === review.reviewedCommit) {
        throw new Error(`Patrol Agent did not commit requested corrections for Issue "${issue.identifier}"`)
      }
      return { kind: 'review_handoff', commit: result.head }
    } finally {
      await lease.release()
    }
  }
}

/** Drive exactly one plugin-owned turn and require a normal durable close. */
async function runAgentTurn(
  agent: Agent,
  prompt: string,
  telemetry: PatrolTelemetryRecorder,
): Promise<void> {
  const firstEvent = agent.session.events.length
  const before = agent.session.events.filter(event => event.type === 'turn/end').length
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source: { kind: 'plugin', plugin: 'taskboard-patrol' },
  }))
  try {
    await agent.whenIdle()
  } finally {
    telemetry.record(agent.session.events.slice(firstEvent))
  }
  const ends = agent.session.events.filter(event => event.type === 'turn/end')
  const last = ends.at(-1)
  if (ends.length !== before + 1 || last?.type !== 'turn/end' || last.data.reason.kind !== 'completed') {
    if (last?.type === 'turn/end' && last.data.reason.kind === 'error') {
      throw new Error(last.data.reason.error.message)
    }
    throw new Error(`Patrol Agent Session "${agent.session.id}" did not complete its assigned turn`)
  }
}

/** Render every rejected approval without exposing mutable request objects. */
function permissionReason(approvals: readonly { readonly toolName: string; readonly reason?: string }[]): string | undefined {
  if (approvals.length === 0) return undefined
  return `Patrol skipped unattended approval: ${approvals.map(approval =>
    `${approval.toolName}${approval.reason === undefined ? '' : ` (${approval.reason})`}`).join(', ')}`
}

/** Require the Agent's local branch to contain committed work and no residue. */
function requireCommittable(clean: boolean, changedFromBase: boolean, issue: Issue): void {
  if (!clean) throw new Error(`Patrol Agent left Issue "${issue.identifier}" worktree uncommitted`)
  if (!changedFromBase) throw new Error(`Patrol Agent produced no committed change for Issue "${issue.identifier}"`)
}

/** Stable readable failure text for durable Run and Attempt history. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
