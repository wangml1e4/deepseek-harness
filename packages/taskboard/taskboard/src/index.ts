/** Workspace-owned Taskboard capability seam. @module @deepseek-ai/dsh-taskboard */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AddIssueRelationInput,
  Activity,
  AddCommentInput,
  Comment,
  CreateIssueInput,
  EnsureWorkspaceInput,
  Issue,
  IssueReference,
  IssueRelation,
  IssueRelationMutation,
  ListIssuesInput,
  MoveIssueInput,
  RemoveIssueRelationInput,
  SetWorkspacePrefixInput,
  UpdateIssueInput,
  VersionedIssueInput,
  WorkspaceTaskboard,
} from './types.ts'

export { ActivityId, CommentId, IssueId, IssueIdentifier, RelationId, TaskboardActorId } from './brand.ts'
export { TaskboardError } from './error.ts'
export type { TaskboardErrorCode } from './error.ts'
export type {
  AddIssueRelationInput,
  Activity,
  ActivityChange,
  ActivityValue,
  AddCommentInput,
  Comment,
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
  RemoveIssueRelationInput,
  SetWorkspacePrefixInput,
  TaskboardActor,
  UpdateIssueInput,
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
}

export default TaskboardService
