/** Public Taskboard value types. @module @deepseek-ai/dsh-taskboard/types */

import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { ActivityId, CommentId, IssueId, IssueIdentifier, RelationId, TaskboardActorId } from './brand.ts'

export type { ActivityId, CommentId, IssueId, IssueIdentifier, RelationId, TaskboardActorId } from './brand.ts'

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
