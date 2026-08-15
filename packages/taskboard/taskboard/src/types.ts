/** Public Taskboard value types. @module @deepseek-ai/dsh-taskboard/types */

import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ActivityId,
  TaskboardAttachmentId,
  CommentId,
  IssueId,
  IssueIdentifier,
  PatrolAttemptId,
  PatrolRunId,
  RelationId,
  TaskboardActorId,
} from './brand.ts'

export type {
  ActivityId,
  TaskboardAttachmentId,
  CommentId,
  IssueId,
  IssueIdentifier,
  PatrolAttemptId,
  PatrolRunId,
  RelationId,
  TaskboardActorId,
} from './brand.ts'

/** Closed Issue lifecycle used by every Taskboard Consumer. */
export type IssueStatus =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'blocked'
  | 'done'
  | 'canceled'

/** Closed Issue priority vocabulary inherited from Dashi Taskboard. */
export type IssuePriority = 'none' | 'urgent' | 'high' | 'medium' | 'low'

/** Closed first-release assignment choices. */
export type IssueAssignee = 'unassigned' | 'user' | 'patrol_agent'

/** Fixed intervals accepted by the first-release Patrol scheduler. */
export type PatrolInterval = '5m' | '30m' | '1h' | '2h' | '6h' | '12h' | '24h'

/** User-controlled durable schedule for one Workspace's Patrol Agent. */
export interface PatrolPolicy {
  /** Workspace whose Taskboard owns this policy. */
  readonly workspaceId: WorkspaceId
  /** Whether fixed-interval triggers are authorized. */
  readonly enabled: boolean
  /** Selected fixed interval. */
  readonly interval: PatrolInterval
  /** Local branch whose tip seeds later unbound Issues. */
  readonly baseBranch: string | null
  /** Agent composition selected for later unbound Issues, or the Host default. */
  readonly agentPreset: string | null
  /** Provider route selected for later unbound Issues, or the Host default. */
  readonly provider: string | null
  /** Model selected for later unbound Issues, or the Host default. */
  readonly model: string | null
  /** Adapter-owned reasoning effort, or the selected model default. */
  readonly reasoningEffort: string | null
  /** Permission Preset selected for later unbound Issues. */
  readonly permissionPreset: string
  /** Next scheduled trigger instant, or null while disabled. */
  readonly nextDueAt: string | null
  /** Monotonic optimistic-concurrency version. */
  readonly version: number
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-save instant. */
  readonly updatedAt: string
}

/** Origin of one durable Patrol Run. */
export type PatrolRunTrigger = 'scheduled' | 'manual'

/** Terminal result recorded by the scheduling layer. */
export type PatrolRunResult =
  | 'no_eligible_issue'
  | 'review_handoff'
  | 'blocked'
  | 'failed'
  | 'skipped_global_busy'

/** One durable scheduled or manually requested Patrol execution. */
export interface PatrolRun {
  /** Stable opaque trigger identity. */
  readonly id: PatrolRunId
  /** Workspace whose policy snapshot initiated this Run. */
  readonly workspaceId: WorkspaceId
  /** Scheduled or one-off origin. */
  readonly trigger: PatrolRunTrigger
  /** Due instant consumed by a scheduled trigger, otherwise null. */
  readonly scheduledFor: string | null
  /** Current persistence state. */
  readonly state: 'active' | 'completed'
  /** Terminal result, or null while active. */
  readonly result: PatrolRunResult | null
  /** Human-readable failure detail, or null when none was recorded. */
  readonly error: string | null
  /** Number of Host startup recovery attempts recorded for this Run. */
  readonly recoveryCount: number
  /** ISO-8601 instant of the latest startup recovery attempt, or null before recovery. */
  readonly lastRecoveredAt: string | null
  /** ISO-8601 trigger start instant. */
  readonly startedAt: string
  /** ISO-8601 terminal instant, or null while active. */
  readonly endedAt: string | null
}

/** Terminal result of one claimed Issue inside a Patrol Run. */
export type PatrolAttemptResult =
  | 'permission_blocked'
  | 'blocked'
  | 'review_handoff'
  | 'failed'

/** Independent Reviewer conclusion before the implementation Agent's final correction turn. */
export type PatrolReviewVerdict = 'approve' | 'changes_requested'

/** Durable structured evidence from one independent Reviewer Session. */
export interface PatrolReview {
  /** Attempt whose preliminary commit was reviewed. */
  readonly attemptId: PatrolAttemptId
  /** Issue whose branch supplied the reviewed diff. */
  readonly issueId: IssueId
  /** Separate persistent Reviewer Session. */
  readonly sessionId: SessionId
  /** Preliminary implementation commit supplied to the Reviewer. */
  readonly reviewedCommit: string
  /** Reviewer conclusion. */
  readonly verdict: PatrolReviewVerdict
  /** Concrete findings, including an explicit no-findings statement when approved. */
  readonly findings: string
  /** Verification commands or evidence the Reviewer inspected. */
  readonly verification: readonly string[]
  /** Remaining risks called out for human review. */
  readonly risks: readonly string[]
  /** ISO-8601 completion instant. */
  readonly createdAt: string
}

/** One durable claim of an Issue by a Patrol Run. */
export interface PatrolAttempt {
  /** Stable opaque claim identity. */
  readonly id: PatrolAttemptId
  /** Run that owns the claim. */
  readonly runId: PatrolRunId
  /** Claimed Issue. */
  readonly issueId: IssueId
  /** Session already bound to the Issue, or null while an unbound claim is being provisioned. */
  readonly sessionId: SessionId | null
  /** Current persistence state. */
  readonly state: 'active' | 'completed'
  /** Terminal claim result, or null while active. */
  readonly result: PatrolAttemptResult | null
  /** Human-readable terminal detail, or null when none was recorded. */
  readonly error: string | null
  /** ISO-8601 claim instant. */
  readonly startedAt: string
  /** ISO-8601 terminal instant, or null while active. */
  readonly endedAt: string | null
}

/** Persistent Git and Session identity reused whenever one Issue returns to todo. */
export interface PatrolDevelopmentContext {
  /** Issue that owns this binding. */
  readonly issueId: IssueId
  /** Exact durable Session resumed on every later execution. */
  readonly sessionId: SessionId
  /** ISO-8601 instant when the exact Session was first persisted, or null before creation succeeds. */
  readonly sessionStartedAt: string | null
  /** Local base branch fixed when the binding was created. */
  readonly baseBranch: string
  /** Dedicated local Issue branch. */
  readonly branch: string
  /** Dedicated persistent worktree path. */
  readonly worktreePath: string
  /** Concrete Agent composition resolved when the Session was created. */
  readonly agentPreset: string
  /** Provider route resolved when the Session was created. */
  readonly provider: string
  /** Model resolved when the Session was created. */
  readonly model: string
  /** Adapter-owned reasoning effort resolved at creation, or null. */
  readonly reasoningEffort: string | null
  /** Permission Preset resolved when the Session was created. */
  readonly permissionPreset: string
  /** Latest committed implementation result, or null before a handoff. */
  readonly resultCommit: string | null
  /** ISO-8601 binding instant. */
  readonly createdAt: string
  /** ISO-8601 last evidence update instant. */
  readonly updatedAt: string
}

/** Version-checked Patrol Policy save. */
export interface UpdatePatrolPolicyInput {
  /** Workspace whose policy changes. */
  readonly workspaceId: WorkspaceId
  /** Replacement enablement when supplied. */
  readonly enabled?: boolean
  /** Replacement fixed interval when supplied. */
  readonly interval?: PatrolInterval
  /** Replacement local base branch; null clears it while disabled. */
  readonly baseBranch?: string | null
  /** Replacement Agent Preset; null follows the Host default. */
  readonly agentPreset?: string | null
  /** Replacement provider route; null follows the Host default. */
  readonly provider?: string | null
  /** Replacement model; null follows the Host default. */
  readonly model?: string | null
  /** Replacement reasoning effort; null follows the model default. */
  readonly reasoningEffort?: string | null
  /** Replacement Permission Preset. */
  readonly permissionPreset?: string
  /** Policy version observed by the caller. */
  readonly expectedVersion: number
}

/** Atomically claim one structurally eligible todo Issue for an active Run. */
export interface ClaimPatrolIssueInput {
  /** Active Run that owns the claim. */
  readonly runId: PatrolRunId
  /** Exact Issue selected after external Git eligibility checks. */
  readonly reference: IssueReference
  /** Issue version observed by the scanner. */
  readonly expectedVersion: number
  /** Blocking Issue commit snapshots proven reachable from Base Branch. */
  readonly dependencyCommits: Readonly<Record<string, string>>
  /** Patrol actor recorded on the status and assignment mutation. */
  readonly actor: TaskboardActor
}

/** Bind a newly claimed Issue to its durable Session and Git isolation. */
export interface BindPatrolDevelopmentContextInput {
  /** Active Attempt whose Issue receives the binding. */
  readonly attemptId: PatrolAttemptId
  /** Complete immutable creation choices and filesystem identities. */
  readonly context: Omit<
    PatrolDevelopmentContext,
    'issueId' | 'sessionStartedAt' | 'resultCommit' | 'createdAt' | 'updatedAt'
  >
}

/** Complete one active Attempt and apply its owned Issue lifecycle transition. */
export interface CompletePatrolAttemptInput {
  /** Active Attempt to finish. */
  readonly attemptId: PatrolAttemptId
  /** Terminal claim result. */
  readonly result: PatrolAttemptResult
  /** Human-readable blocker or failure detail. */
  readonly error?: string
  /** Result commit required for review handoff. */
  readonly resultCommit?: string
  /** Actor recorded on the lifecycle transition and optional blocker comment. */
  readonly actor: TaskboardActor
}

/** Persist one independent Reviewer result before implementation correction. */
export interface RecordPatrolReviewInput {
  /** Active Attempt whose preliminary commit was reviewed. */
  readonly attemptId: PatrolAttemptId
  /** Separate persistent Reviewer Session. */
  readonly sessionId: SessionId
  /** Preliminary implementation commit supplied to the Reviewer. */
  readonly reviewedCommit: string
  /** Reviewer conclusion. */
  readonly verdict: PatrolReviewVerdict
  /** Concrete review findings. */
  readonly findings: string
  /** Verification commands or evidence inspected. */
  readonly verification: readonly string[]
  /** Remaining risks for human review. */
  readonly risks: readonly string[]
}

/** Input that persists one scheduled or manual trigger. */
export interface BeginPatrolRunInput {
  /** Workspace whose saved policy is used. */
  readonly workspaceId: WorkspaceId
  /** Scheduled or one-off trigger origin. */
  readonly trigger: PatrolRunTrigger
}

/** Input that completes one active Patrol Run. */
export interface CompletePatrolRunInput {
  /** Active Run to complete. */
  readonly runId: PatrolRunId
  /** Terminal execution result. */
  readonly result: Exclude<PatrolRunResult, 'skipped_global_busy'>
  /** Human-readable failure detail, when any. */
  readonly error?: string
}

/** Atomically terminate an active Run and Attempt that cannot resume after Host startup. */
export interface FailPatrolRecoveryInput {
  /** Active Run being recovered. */
  readonly runId: PatrolRunId
  /** Active Attempt whose exact Session or worktree could not resume. */
  readonly attemptId: PatrolAttemptId
  /** Durable human-readable recovery failure. */
  readonly error: string
  /** Patrol actor recorded on the Issue lifecycle mutation and Comment. */
  readonly actor: TaskboardActor
}

/** Workspace-owned metadata for its implicit Taskboard. */
export interface WorkspaceTaskboard {
  /** Workspace that owns this Taskboard. */
  readonly workspaceId: WorkspaceId
  /** Workspace title captured when the Taskboard is first ensured. */
  readonly title: string
  /** Unique human-readable prefix frozen when the first Issue is created. */
  readonly prefix: string
  /** Monotonic record version. */
  readonly version: number
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** Durable Issue returned by the Taskboard service. */
export interface Issue {
  /** Stable opaque identity. */
  readonly id: IssueId
  /** Stable human-readable reference. */
  readonly identifier: IssueIdentifier
  /** Current owning Workspace. */
  readonly workspaceId: WorkspaceId
  /** User-facing title. */
  readonly title: string
  /** Markdown description. */
  readonly description: string
  /** Current lifecycle status. */
  readonly status: IssueStatus
  /** User-selected priority metadata. */
  readonly priority: IssuePriority
  /** User-selected label names in stable order. */
  readonly labels: readonly string[]
  /** Current owner category. */
  readonly assignee: IssueAssignee
  /** Optional local calendar start date in YYYY-MM-DD form. */
  readonly startDate: string | null
  /** Optional local calendar due date in YYYY-MM-DD form. */
  readonly dueDate: string | null
  /** Manual order within the current status column. */
  readonly sortOrder: number
  /** Monotonic optimistic-concurrency version. */
  readonly version: number
  /** ISO-8601 archive instant, or null while active. */
  readonly archivedAt: string | null
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 last-mutation instant. */
  readonly updatedAt: string
}

/** User, Patrol Agent, Reviewer, or System responsible for one Taskboard append or mutation. */
export interface TaskboardActor {
  /** Actor category displayed in Issue history. */
  readonly type: 'user' | 'patrol_agent' | 'reviewer' | 'system'
  /** Stable actor identity. */
  readonly id: TaskboardActorId
  /** User-facing actor name captured with the entry. */
  readonly name: string
  /** Optional user-facing avatar URL captured with the entry. */
  readonly avatarUrl?: string
}

/** Append-only Issue comment. */
export interface Comment {
  /** Stable opaque identity. */
  readonly id: CommentId
  /** Issue that owns this Comment. */
  readonly issueId: IssueId
  /** Markdown comment body. */
  readonly body: string
  /** Author captured when the Comment was appended. */
  readonly actor: TaskboardActor
  /** ISO-8601 append instant. */
  readonly createdAt: string
}

/** Metadata for one file attached to an Issue. */
export interface TaskboardAttachment {
  /** Stable opaque attachment identity. */
  readonly id: TaskboardAttachmentId
  /** Issue that owns the attachment. */
  readonly issueId: IssueId
  /** Original user-visible filename. */
  readonly name: string
  /** Browser-supplied media type, or `application/octet-stream` when absent. */
  readonly mediaType: string
  /** Exact byte length stored by the Host. */
  readonly size: number
  /** Actor that uploaded the attachment. */
  readonly actor: TaskboardActor
  /** ISO-8601 upload instant. */
  readonly createdAt: string
}

/** Attachment metadata and bytes returned through an authorized Host read. */
export interface TaskboardAttachmentContent {
  /** Durable attachment metadata. */
  readonly attachment: TaskboardAttachment
  /** Exact stored file bytes. */
  readonly data: Uint8Array
}

/** Result of storing an attachment and advancing its owning Issue. */
export interface TaskboardAttachmentMutation {
  /** Updated owning Issue. */
  readonly issue: Issue
  /** Stored attachment metadata. */
  readonly attachment: TaskboardAttachment
}

/** Input that stores one unrestricted file on an Issue. */
export interface AddAttachmentInput extends VersionedIssueInput {
  /** Original user-visible filename. */
  readonly name: string
  /** Browser-supplied media type; blank values resolve to `application/octet-stream`. */
  readonly mediaType: string
  /** File bytes, limited to 25 MiB by the Service. */
  readonly data: Uint8Array
}

/** Input that reads one attachment only through its owning Issue. */
export interface ReadAttachmentInput {
  /** Stable owning Issue lookup. */
  readonly reference: IssueReference
  /** Stable attachment identity. */
  readonly attachmentId: TaskboardAttachmentId
}

/** Input that explicitly confirms permanent attachment deletion. */
export interface DeleteAttachmentInput extends VersionedIssueInput {
  /** Stable attachment identity. */
  readonly attachmentId: TaskboardAttachmentId
  /** Explicit user confirmation; false is rejected without mutation. */
  readonly confirmed: boolean
}

/** JSON-compatible value captured before or after an Issue mutation. */
export type ActivityValue =
  | null
  | boolean
  | number
  | string
  | readonly ActivityValue[]
  | { readonly [key: string]: ActivityValue }

/** One field-level change in an Activity entry. */
export interface ActivityChange {
  /** Public Issue field that changed. */
  readonly field: string
  /** Value before the mutation. */
  readonly before: ActivityValue
  /** Value after the mutation. */
  readonly after: ActivityValue
}

/** Append-only record of one Issue mutation. */
export interface Activity {
  /** Stable opaque identity. */
  readonly id: ActivityId
  /** Issue whose fields changed. */
  readonly issueId: IssueId
  /** Actor responsible for the mutation. */
  readonly actor: TaskboardActor
  /** Field changes committed atomically with the mutation. */
  readonly changes: readonly ActivityChange[]
  /** ISO-8601 mutation instant. */
  readonly createdAt: string
}

/** Direction of one dependency relation relative to the requested Issue. */
export type IssueRelationType = 'blocks' | 'blocked_by'

/** One view of a durable directed Issue dependency. */
export interface IssueRelation {
  /** Stable identity shared by both relation views. */
  readonly id: RelationId
  /** Direction relative to issueId. */
  readonly type: IssueRelationType
  /** Issue from whose perspective this value was listed. */
  readonly issueId: IssueId
  /** Issue at the other end of the dependency. */
  readonly relatedIssueId: IssueId
  /** ISO-8601 creation instant. */
  readonly createdAt: string
}

/** Input that creates one directed Issue dependency. */
export interface AddIssueRelationInput extends VersionedIssueInput {
  /** Direction relative to reference. */
  readonly type: IssueRelationType
  /** Issue at the other end of the dependency. */
  readonly relatedReference: IssueReference
}

/** Result of a relation mutation and its Issue version update. */
export interface IssueRelationMutation {
  /** Updated anchor Issue. */
  readonly issue: Issue
  /** Relation from the anchor Issue's perspective. */
  readonly relation: IssueRelation
}

/** Input that removes one dependency from an Issue. */
export interface RemoveIssueRelationInput extends VersionedIssueInput {
  /** Stable relation identity visible from either endpoint. */
  readonly relationId: RelationId
}

/** Input that appends one Comment to an Issue. */
export interface AddCommentInput {
  /** Stable Issue lookup. */
  readonly reference: IssueReference
  /** Markdown comment body. */
  readonly body: string
  /** Comment author. */
  readonly actor: TaskboardActor
}

/** Input that ensures a Workspace's implicit Taskboard exists. */
export interface EnsureWorkspaceInput {
  /** Workspace that owns the Taskboard. */
  readonly workspaceId: WorkspaceId
  /** Workspace title used to derive the initial prefix. */
  readonly title: string
}

/** Input that changes a Workspace prefix before its first Issue exists. */
export interface SetWorkspacePrefixInput {
  /** Workspace whose Taskboard prefix changes. */
  readonly workspaceId: WorkspaceId
  /** Unique uppercase prefix used by later Issue identifiers. */
  readonly prefix: string
  /** Taskboard version observed by the caller. */
  readonly expectedVersion: number
}

/** Input that creates one Issue with version-one defaults for omitted fields. */
export interface CreateIssueInput {
  /** Workspace whose Taskboard receives the Issue. */
  readonly workspaceId: WorkspaceId
  /** User-facing Issue title. */
  readonly title: string
  /** Markdown description; defaults to empty. */
  readonly description?: string
  /** Initial lifecycle status; defaults to backlog. */
  readonly status?: IssueStatus
  /** Initial priority metadata; defaults to none. */
  readonly priority?: IssuePriority
  /** Initial label names; defaults to empty. */
  readonly labels?: readonly string[]
  /** Initial owner category; defaults to unassigned. */
  readonly assignee?: IssueAssignee
  /** Optional local calendar start date. */
  readonly startDate?: string
  /** Optional local calendar due date. */
  readonly dueDate?: string
}

/** Input that lists active Issues in manual order. */
export interface ListIssuesInput {
  /** Workspace whose Issues are listed. */
  readonly workspaceId: WorkspaceId
  /** Optional lifecycle status filter. */
  readonly status?: IssueStatus
  /** Optional priority filter. */
  readonly priority?: IssuePriority
  /** Optional exact label filter. */
  readonly label?: string
  /** Optional owner-category filter. */
  readonly assignee?: IssueAssignee
  /** Optional exact start-date filter. */
  readonly startDate?: string
  /** Optional exact due-date filter. */
  readonly dueDate?: string
  /** Case-insensitive substring search over identifier, title, and description. */
  readonly query?: string
  /** Archive scope; defaults to excluding archived Issues. */
  readonly archived?: 'exclude' | 'only' | 'include'
}

/** Input that updates one Issue from a caller-observed version. */
export interface UpdateIssueInput {
  /** Stable Issue lookup. */
  readonly reference: IssueReference
  /** Replacement title. */
  readonly title?: string
  /** Replacement Markdown description. */
  readonly description?: string
  /** Replacement lifecycle status. */
  readonly status?: IssueStatus
  /** Replacement priority metadata. */
  readonly priority?: IssuePriority
  /** Replacement label names. */
  readonly labels?: readonly string[]
  /** Replacement owner category. */
  readonly assignee?: IssueAssignee
  /** Replacement start date; null clears it. */
  readonly startDate?: string | null
  /** Replacement due date; null clears it. */
  readonly dueDate?: string | null
  /** Explicit manual board position, when reordering. */
  readonly sortOrder?: number
  /** Issue version observed by the caller. */
  readonly expectedVersion: number
  /** Required review or blocker feedback when returning work to todo. */
  readonly reason?: string
  /** Actor responsible for this mutation. */
  readonly actor: TaskboardActor
}

/** Input for a version-checked Issue mutation without replacement fields. */
export interface VersionedIssueInput {
  /** Stable Issue lookup. */
  readonly reference: IssueReference
  /** Issue version observed by the caller. */
  readonly expectedVersion: number
  /** Actor responsible for this mutation. */
  readonly actor: TaskboardActor
}

/** Input that transfers one Issue to another Workspace. */
export interface MoveIssueInput extends VersionedIssueInput {
  /** Destination Workspace. */
  readonly targetWorkspaceId: WorkspaceId
}

/** Opaque or human-readable lookup accepted by the Taskboard Service. */
export type IssueReference = IssueId | IssueIdentifier

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A durable Taskboard mutation committed for one Workspace. Observer
     * failures are contained and cannot veto the committed mutation.
     * @mode emit
     * @param workspaceId - Workspace whose Taskboard projection changed.
     */
    'taskboard/changed'(workspaceId: WorkspaceId): void
  }
}
