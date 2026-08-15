/** Workspace-owned Taskboard capability seam. @module @deepseek-ai/dsh-taskboard */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AddIssueRelationInput,
  Activity,
  AddCommentInput,
  BindPatrolDevelopmentContextInput,
  BeginPatrolRunInput,
  ClaimPatrolIssueInput,
  Comment,
  CompletePatrolAttemptInput,
  CompletePatrolRunInput,
  CreateIssueInput,
  EnsureWorkspaceInput,
  Issue,
  IssueReference,
  IssueRelation,
  IssueRelationMutation,
  ListIssuesInput,
  MoveIssueInput,
  PatrolAttempt,
  PatrolDevelopmentContext,
  PatrolPolicy,
  PatrolReview,
  RecordPatrolReviewInput,
  PatrolRun,
  PatrolRunId,
  RemoveIssueRelationInput,
  SetWorkspacePrefixInput,
  UpdateIssueInput,
  UpdatePatrolPolicyInput,
  VersionedIssueInput,
  WorkspaceTaskboard,
} from './types.ts'

export {
  ActivityId,
  CommentId,
  IssueId,
  IssueIdentifier,
  PatrolAttemptId,
  PatrolRunId,
  RelationId,
  TaskboardActorId,
} from './brand.ts'
export { TaskboardError } from './error.ts'
export type { TaskboardErrorCode } from './error.ts'
export {
  DEFAULT_PATROL_INTERVAL,
  PATROL_INTERVALS,
  nextPatrolCadence,
  nextPatrolDueAfterSave,
  patrolIntervalMilliseconds,
} from './patrol.ts'
export type {
  AddIssueRelationInput,
  Activity,
  ActivityChange,
  ActivityValue,
  AddCommentInput,
  BindPatrolDevelopmentContextInput,
  BeginPatrolRunInput,
  ClaimPatrolIssueInput,
  Comment,
  CompletePatrolAttemptInput,
  CompletePatrolRunInput,
  CreateIssueInput,
  EnsureWorkspaceInput,
  Issue,
  IssueAssignee,
  IssueId as IssueIdType,
  IssueIdentifier as IssueIdentifierType,
  IssuePriority,
  IssueReference,
  IssueRelation,
  IssueRelationMutation,
  IssueRelationType,
  IssueStatus,
  ListIssuesInput,
  MoveIssueInput,
  PatrolAttempt,
  PatrolAttemptId as PatrolAttemptIdType,
  PatrolAttemptResult,
  PatrolDevelopmentContext,
  PatrolInterval,
  PatrolPolicy,
  PatrolReview,
  PatrolReviewVerdict,
  RecordPatrolReviewInput,
  PatrolRun,
  PatrolRunId as PatrolRunIdType,
  PatrolRunResult,
  PatrolRunTrigger,
  RemoveIssueRelationInput,
  SetWorkspacePrefixInput,
  TaskboardActor,
  UpdateIssueInput,
  UpdatePatrolPolicyInput,
  VersionedIssueInput,
  WorkspaceTaskboard,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskboard: TaskboardService
  }
}

/** Durable Workspace Taskboard service implemented by a configured Provider. */
export abstract class TaskboardService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'taskboard')
  }

  /**
   * Ensure one Workspace's implicit Taskboard exists.
   * @param input - Workspace identity and current title.
   * @returns the existing or newly durable Taskboard metadata.
   */
  abstract ensureWorkspace(input: EnsureWorkspaceInput): Promise<WorkspaceTaskboard>

  /**
   * Look up one Workspace's implicit Taskboard.
   * @param workspaceId - Workspace identity.
   * @returns the Taskboard metadata, or undefined when it has not been ensured.
   */
  abstract getWorkspace(workspaceId: EnsureWorkspaceInput['workspaceId']): Promise<WorkspaceTaskboard | undefined>

  /**
   * Change a Taskboard prefix before its first Issue is created.
   * @param input - Workspace, new prefix, and caller-observed version.
   * @returns the updated Taskboard metadata.
   */
  abstract setWorkspacePrefix(input: SetWorkspacePrefixInput): Promise<WorkspaceTaskboard>

  /**
   * Create one Issue in a Workspace Taskboard.
   * @param input - Workspace and Issue title.
   * @returns the durable Issue with defaults resolved.
   */
  abstract createIssue(input: CreateIssueInput): Promise<Issue>

  /**
   * List active Issues in their user-controlled order.
   * @param input - Workspace and optional status filter.
   * @returns matching Issues ordered within their status columns.
   */
  abstract listIssues(input: ListIssuesInput): Promise<readonly Issue[]>

  /**
   * Update one Issue when the caller still holds its current version.
   * @param input - Issue lookup, replacement status, and caller-observed version.
   * @returns the updated Issue.
   */
  abstract updateIssue(input: UpdateIssueInput): Promise<Issue>

  /**
   * Hide one Issue from active views without deleting it.
   * @param input - Issue lookup and caller-observed version.
   * @returns the archived Issue.
   */
  abstract archiveIssue(input: VersionedIssueInput): Promise<Issue>

  /**
   * Restore one archived Issue to active views.
   * @param input - Issue lookup and caller-observed version.
   * @returns the restored Issue.
   */
  abstract restoreIssue(input: VersionedIssueInput): Promise<Issue>

  /**
   * Transfer one Issue to another Workspace without changing its identity; the current Workspace is a no-op.
   * @param input - Issue lookup, destination Workspace, and caller-observed version.
   * @returns the moved Issue.
   */
  abstract moveIssue(input: MoveIssueInput): Promise<Issue>

  /**
   * Append one attributed Comment to an Issue.
   * @param input - Issue lookup, body, and author.
   * @returns the durable Comment.
   */
  abstract addComment(input: AddCommentInput): Promise<Comment>

  /**
   * List one Issue's Comments in append order.
   * @param reference - Stable Issue lookup.
   * @returns append-only Comments in chronological order.
   */
  abstract listComments(reference: IssueReference): Promise<readonly Comment[]>

  /**
   * List one Issue's Activity entries in append order.
   * @param reference - Stable Issue lookup.
   * @returns append-only field changes in chronological order.
   */
  abstract listActivities(reference: IssueReference): Promise<readonly Activity[]>

  /**
   * List every directed dependency in one Workspace from its blocking Issue's perspective.
   * @param workspaceId - Workspace whose canonical dependency records are listed.
   * @returns relation views in append order with type `blocks`.
   */
  abstract listWorkspaceRelations(workspaceId: EnsureWorkspaceInput['workspaceId']): Promise<readonly IssueRelation[]>

  /**
   * Add one directed dependency between two Issues.
   * @param input - Anchor, direction, related Issue, version, and actor.
   * @returns the updated anchor Issue and relation view.
   */
  abstract addRelation(input: AddIssueRelationInput): Promise<IssueRelationMutation>

  /**
   * List dependency relations from one Issue's perspective.
   * @param reference - Stable Issue lookup.
   * @returns relation views in append order.
   */
  abstract listRelations(reference: IssueReference): Promise<readonly IssueRelation[]>

  /**
   * Remove one dependency while retaining its Activity history.
   * @param input - Anchor Issue, relation id, version, and actor.
   * @returns the updated anchor Issue.
   */
  abstract removeRelation(input: RemoveIssueRelationInput): Promise<Issue>

  /**
   * Look up one Issue by opaque id or human-readable identifier.
   * @param reference - Stable Issue reference.
   * @returns the Issue, or undefined when absent.
   */
  abstract getIssue(reference: IssueReference): Promise<Issue | undefined>

  /**
   * Read one Workspace's durable Patrol Policy.
   * @param workspaceId - Workspace whose policy is requested.
   * @returns the policy created with the Taskboard, or undefined when the Taskboard is absent.
   */
  abstract getPatrolPolicy(
    workspaceId: EnsureWorkspaceInput['workspaceId'],
  ): Promise<PatrolPolicy | undefined>

  /**
   * Save Patrol enablement or interval and recalculate its next trigger.
   * @param input - Workspace, replacements, and caller-observed policy version.
   * @returns the updated durable policy.
   */
  abstract updatePatrolPolicy(input: UpdatePatrolPolicyInput): Promise<PatrolPolicy>

  /**
   * List enabled Patrol Policies whose next trigger has arrived.
   * @returns due policies ordered by due instant and Workspace id.
   */
  abstract listDuePatrolPolicies(): Promise<readonly PatrolPolicy[]>

  /**
   * Persist one trigger, atomically consuming a scheduled due instant and enforcing Host-wide exclusivity.
   * @param input - Workspace and trigger origin.
   * @returns an active Run, or a completed scheduled overlap record.
   */
  abstract beginPatrolRun(input: BeginPatrolRunInput): Promise<PatrolRun>

  /**
   * Complete one active Patrol Run exactly once.
   * @param input - Run identity and terminal result.
   * @returns the completed durable Run.
   */
  abstract completePatrolRun(input: CompletePatrolRunInput): Promise<PatrolRun>

  /**
   * List permanent Patrol Run history for one Workspace, newest first.
   * @param workspaceId - Workspace whose Run history is requested.
   * @returns every active and completed Run.
   */
  abstract listPatrolRuns(
    workspaceId: EnsureWorkspaceInput['workspaceId'],
  ): Promise<readonly PatrolRun[]>

  /**
   * Atomically claim one todo Issue for an active Run after matching dependency commit snapshots.
   * @param input - Run, Issue version, dependency evidence, and Patrol actor.
   * @returns the durable active Attempt.
   */
  abstract claimPatrolIssue(input: ClaimPatrolIssueInput): Promise<PatrolAttempt>

  /**
   * Bind a newly claimed Issue to the exact Session, branch, and worktree it will always resume.
   * @param input - Active Attempt and complete creation-time execution choices.
   * @returns the immutable Issue Development Context.
   */
  abstract bindPatrolDevelopmentContext(
    input: BindPatrolDevelopmentContextInput,
  ): Promise<PatrolDevelopmentContext>

  /**
   * Read one Issue's persistent Session and Git binding.
   * @param reference - Stable Issue lookup.
   * @returns its Development Context, or undefined before binding.
   */
  abstract getPatrolDevelopmentContext(
    reference: IssueReference,
  ): Promise<PatrolDevelopmentContext | undefined>

  /**
   * Record that one bound Session has been persisted and must only be resumed afterward.
   * @param attemptId - Active Attempt using the bound Session.
   * @returns the updated Development Context.
   */
  abstract markPatrolSessionStarted(attemptId: PatrolAttempt['id']): Promise<PatrolDevelopmentContext>

  /**
   * Complete one active Attempt and atomically move its Issue to blocked or in_review.
   * @param input - Attempt result, evidence, and responsible actor.
   * @returns the terminal durable Attempt.
   */
  abstract completePatrolAttempt(input: CompletePatrolAttemptInput): Promise<PatrolAttempt>

  /**
   * Persist one independent Reviewer result for an active Attempt.
   * @param input - Reviewer Session, preliminary commit, findings, verification, and risks.
   * @returns durable structured review evidence.
   */
  abstract recordPatrolReview(input: RecordPatrolReviewInput): Promise<PatrolReview>

  /**
   * List every independent review retained for one Issue.
   * @param reference - Issue whose review history is requested.
   * @returns review evidence in completion order.
   */
  abstract listPatrolReviews(reference: IssueReference): Promise<readonly PatrolReview[]>

  /**
   * List every Issue claim in one Run in claim order.
   * @param runId - Run whose Attempt history is requested.
   * @returns active and terminal Attempts in claim order.
   */
  abstract listPatrolAttempts(runId: PatrolRunId): Promise<readonly PatrolAttempt[]>
}

export default TaskboardService
