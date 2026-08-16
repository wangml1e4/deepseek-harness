/** Host Remote Consumer for the Workspace-owned Taskboard capability. */

import type { Context } from '@deepseek-ai/cordis'
import {
  MAX_ATTACHMENT_BYTES,
  TaskboardError,
} from '@deepseek-ai/dsh-taskboard'
import type {
  AddCommentInput,
  AddIssueRelationInput,
  Comment,
  CreateIssueInput,
  DeleteAttachmentInput,
  Issue,
  IssueReference,
  IssueRelationMutation,
  ListIssuesInput,
  MoveIssueInput,
  PatrolPolicy,
  PatrolRun,
  RemoveIssueRelationInput,
  SetWorkspacePrefixInput,
  UpdatePatrolPolicyInput,
  UpdateIssueInput,
  VersionedIssueInput,
  WorkspaceTaskboard,
  TaskboardAttachmentMutation,
} from '@deepseek-ai/dsh-taskboard/types'
import type {} from '@deepseek-ai/dsh-taskboard-patrol'
import type {} from '@deepseek-ai/dsh-workspace'
import type { Workspace, WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TaskboardActivityListValue,
  TaskboardAttachmentContentValue,
  TaskboardAttachmentListValue,
  TaskboardAttachmentReadInput,
  TaskboardAttachmentUploadInput,
  TaskboardCommentListValue,
  TaskboardIssueListValue,
  TaskboardIssueValue,
  TaskboardTodoCountValue,
  TaskboardRelationListValue,
  TaskboardPatrolIssueValue,
  TaskboardPatrolTriggerInput,
  TaskboardPatrolValue,
  TaskboardPatrolWorktreeRemovalInput,
  TaskboardPatrolWorktreeRemovalValue,
  TaskboardRemoteResult,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskboardRemote: TaskboardRemote
  }
}

/** Host Remote adapter that keeps Workspace identity authoritative. */
export class TaskboardRemote extends TypertRemoteService {
  static inject = ['taskboard', 'taskboardPatrol', 'workspaceRegistry']

  constructor(ctx: Context) {
    super(ctx, 'taskboardRemote', { namespace: 'taskboard' })
    ctx.effect(() => ctx.workspaceRegistry.registerDeleteGuard(async (workspace) => {
      const issues = await ctx.taskboard.listIssues({ workspaceId: workspace.id, archived: 'include' })
      if (issues.length === 0) return undefined
      const noun = issues.length === 1 ? 'Issue' : 'Issues'
      return {
        code: 'taskboard-issues',
        message: `Move all ${String(issues.length)} active or archived Taskboard ${noun} to another Workspace before deleting this Workspace.`,
      }
    }), 'taskboardRemote.workspaceDeleteGuard')
  }

  /**
   * Ensure and read the implicit Taskboard for one registered Workspace.
   * @param workspaceId - Authoritative Workspace identity.
   * @returns Taskboard metadata or a stable business failure.
   */
  @Remote('workspace')
  workspace(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<WorkspaceTaskboard>> {
    return this.result(async () => {
      const workspace = this.requireWorkspace(workspaceId)
      return await this.ctx.taskboard.ensureWorkspace({ workspaceId, title: workspace.title })
    })
  }

  /**
   * Change a Taskboard prefix before its first Issue.
   * @param input - Prefix mutation with optimistic version.
   * @returns updated Taskboard metadata or a stable business failure.
   */
  @Remote('setPrefix')
  setPrefix(input: SetWorkspacePrefixInput): Promise<TaskboardRemoteResult<WorkspaceTaskboard>> {
    return this.result(async () => {
      this.requireWorkspace(input.workspaceId)
      return await this.ctx.taskboard.setWorkspacePrefix(input)
    })
  }

  /**
   * List Issues in one registered Workspace.
   * @param input - Workspace and filters.
   * @returns ordered Issues or a stable business failure.
   */
  @Remote('listIssues')
  listIssues(input: ListIssuesInput): Promise<TaskboardRemoteResult<TaskboardIssueListValue>> {
    return this.result(async () => {
      const workspace = this.requireWorkspace(input.workspaceId)
      await this.ctx.taskboard.ensureWorkspace({ workspaceId: workspace.id, title: workspace.title })
      return { items: await this.ctx.taskboard.listIssues(input) }
    })
  }

  /**
   * Count current todo Issues for one registered Workspace sidebar row.
   * @param workspaceId - Workspace whose manual Patrol queue is summarized.
   * @returns current derived count or a stable business failure.
   */
  @Remote('todoCount')
  todoCount(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<TaskboardTodoCountValue>> {
    return this.result(async () => {
      const workspace = this.requireWorkspace(workspaceId)
      await this.ctx.taskboard.ensureWorkspace({ workspaceId, title: workspace.title })
      return { count: (await this.ctx.taskboard.listIssues({ workspaceId, status: 'todo' })).length }
    })
  }

  /**
   * Look up one Issue.
   * @param reference - Opaque id or human-readable identifier.
   * @returns explicit nullable Issue result.
   */
  @Remote('getIssue')
  getIssue(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardIssueValue>> {
    return this.result(async () => ({ issue: await this.ctx.taskboard.getIssue(reference) ?? null }))
  }

  /**
   * Create an Issue in one registered Workspace.
   * @param input - Issue fields.
   * @returns created Issue or a stable business failure.
   */
  @Remote('createIssue')
  createIssue(input: CreateIssueInput): Promise<TaskboardRemoteResult<Issue>> {
    return this.result(() => this.withRegisteredWorkspace(input.workspaceId, async (workspace) => {
      await this.ctx.taskboard.ensureWorkspace({ workspaceId: workspace.id, title: workspace.title })
      return await this.ctx.taskboard.createIssue(input)
    }))
  }

  /**
   * Update or reorder an Issue using optimistic concurrency.
   * @param input - Issue mutation.
   * @returns updated Issue or a stable business failure.
   */
  @Remote('updateIssue')
  updateIssue(input: UpdateIssueInput): Promise<TaskboardRemoteResult<Issue>> {
    return this.result(() => this.ctx.taskboard.updateIssue(input))
  }

  /**
   * Move an Issue to another registered Workspace.
   * @param input - destination and optimistic version.
   * @returns moved Issue or a stable business failure.
   */
  @Remote('moveIssue')
  moveIssue(input: MoveIssueInput): Promise<TaskboardRemoteResult<Issue>> {
    return this.result(() => this.withRegisteredWorkspace(input.targetWorkspaceId, async (workspace) => {
      await this.ctx.taskboard.ensureWorkspace({ workspaceId: workspace.id, title: workspace.title })
      return await this.ctx.taskboard.moveIssue(input)
    }))
  }

  /**
   * Archive an Issue without deleting it.
   * @param input - Issue reference, observed version, and actor.
   * @returns archived Issue or a stable business failure.
   */
  @Remote('archiveIssue')
  archiveIssue(input: VersionedIssueInput): Promise<TaskboardRemoteResult<Issue>> {
    return this.result(() => this.ctx.taskboard.archiveIssue(input))
  }

  /**
   * Restore one archived Issue.
   * @param input - Issue reference, observed version, and actor.
   * @returns restored Issue or a stable business failure.
   */
  @Remote('restoreIssue')
  restoreIssue(input: VersionedIssueInput): Promise<TaskboardRemoteResult<Issue>> {
    return this.result(() => this.ctx.taskboard.restoreIssue(input))
  }

  /**
   * List one Issue's Comments.
   * @param reference - Opaque id or human-readable identifier.
   * @returns ordered Comments or a stable business failure.
   */
  @Remote('listComments')
  listComments(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardCommentListValue>> {
    return this.result(async () => ({ items: await this.ctx.taskboard.listComments(reference) }))
  }

  /**
   * Append one attributed Comment.
   * @param input - Issue reference, body, and author.
   * @returns appended Comment or a stable business failure.
   */
  @Remote('addComment')
  addComment(input: AddCommentInput): Promise<TaskboardRemoteResult<Comment>> {
    return this.result(() => this.ctx.taskboard.addComment(input))
  }

  /**
   * List one Issue's attachment metadata without exposing Host paths.
   * @param reference - opaque id or human-readable identifier.
   * @returns ordered metadata or a stable business failure.
   */
  @Remote('listAttachments')
  listAttachments(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardAttachmentListValue>> {
    return this.result(async () => ({ items: await this.ctx.taskboard.listAttachments(reference) }))
  }

  /**
   * Decode and store one browser attachment through the Taskboard Service.
   * @param input - metadata, canonical base64 bytes, optimistic version, and actor.
   * @returns updated Issue and attachment metadata or a stable business failure.
   */
  @Remote('addAttachment')
  addAttachment(input: TaskboardAttachmentUploadInput): Promise<TaskboardRemoteResult<TaskboardAttachmentMutation>> {
    return this.result(() => this.ctx.taskboard.addAttachment({
      ...input,
      data: decodeAttachment(input.data),
    }))
  }

  /**
   * Read one Issue-scoped attachment without exposing its Host storage path.
   * @param input - owning Issue and attachment identities.
   * @returns metadata and canonical base64 bytes or a stable business failure.
   */
  @Remote('readAttachment')
  readAttachment(input: TaskboardAttachmentReadInput): Promise<TaskboardRemoteResult<TaskboardAttachmentContentValue>> {
    return this.result(async () => {
      const content = await this.ctx.taskboard.readAttachment(input)
      return { attachment: content.attachment, data: Buffer.from(content.data).toString('base64') }
    })
  }

  /**
   * Permanently remove one attachment only after explicit confirmation.
   * @param input - attachment identity, confirmation, optimistic version, and actor.
   * @returns updated owning Issue or a stable business failure.
   */
  @Remote('deleteAttachment')
  deleteAttachment(input: DeleteAttachmentInput): Promise<TaskboardRemoteResult<Issue>> {
    return this.result(() => this.ctx.taskboard.deleteAttachment(input))
  }

  /**
   * List one Issue's append-only Activity.
   * @param reference - Opaque id or human-readable identifier.
   * @returns ordered Activity or a stable business failure.
   */
  @Remote('listActivities')
  listActivities(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardActivityListValue>> {
    return this.result(async () => ({ items: await this.ctx.taskboard.listActivities(reference) }))
  }

  /**
   * List recent Activity for active Issues in one registered Workspace.
   * @param workspaceId - Workspace whose Dashboard consumes the Activity.
   * @returns newest-first Activity or a stable business failure.
   */
  @Remote('listWorkspaceActivities')
  listWorkspaceActivities(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<TaskboardActivityListValue>> {
    return this.result(async () => {
      this.requireWorkspace(workspaceId)
      return { items: await this.ctx.taskboard.listWorkspaceActivities(workspaceId) }
    })
  }

  /**
   * List one registered Workspace's canonical dependency records.
   * @param workspaceId - Authoritative Workspace identity.
   * @returns ordered `blocks` relation views or a stable business failure.
   */
  @Remote('listWorkspaceRelations')
  listWorkspaceRelations(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<TaskboardRelationListValue>> {
    return this.result(async () => {
      this.requireWorkspace(workspaceId)
      return { items: await this.ctx.taskboard.listWorkspaceRelations(workspaceId) }
    })
  }

  /**
   * List one Issue's dependency views.
   * @param reference - Opaque id or human-readable identifier.
   * @returns ordered relation views or a stable business failure.
   */
  @Remote('listRelations')
  listRelations(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardRelationListValue>> {
    return this.result(async () => ({ items: await this.ctx.taskboard.listRelations(reference) }))
  }

  /**
   * Add one directed Issue dependency.
   * @param input - Anchor, related Issue, direction, version, and actor.
   * @returns relation mutation or a stable business failure.
   */
  @Remote('addRelation')
  addRelation(input: AddIssueRelationInput): Promise<TaskboardRemoteResult<IssueRelationMutation>> {
    return this.result(() => this.ctx.taskboard.addRelation(input))
  }

  /**
   * Remove one Issue dependency without deleting its Activity.
   * @param input - Anchor, relation id, observed version, and actor.
   * @returns updated Issue or a stable business failure.
   */
  @Remote('removeRelation')
  removeRelation(input: RemoveIssueRelationInput): Promise<TaskboardRemoteResult<Issue>> {
    return this.result(() => this.ctx.taskboard.removeRelation(input))
  }

  /**
   * Read Patrol settings choices and permanent Run history for one Workspace.
   * @param workspaceId - authoritative Workspace identity.
   * @returns current policy, Host choices, and Run/Attempt history.
   */
  @Remote('patrol')
  patrol(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<TaskboardPatrolValue>> {
    return this.result(async () => {
      const workspace = this.requireWorkspace(workspaceId)
      await this.ctx.taskboard.ensureWorkspace({ workspaceId, title: workspace.title })
      const [policy, configuration, runs] = await Promise.all([
        this.ctx.taskboard.getPatrolPolicy(workspaceId),
        this.ctx.taskboardPatrol.configuration(workspaceId),
        this.ctx.taskboard.listPatrolRuns(workspaceId),
      ])
      if (policy === undefined) {
        throw new TaskboardError('workspace_not_found', `Workspace '${workspaceId}' has no Taskboard Patrol Policy`)
      }
      const { selection, ...defaults } = configuration.defaults
      return {
        policy,
        ...configuration,
        defaults: {
          ...defaults,
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort ?? null,
        },
        runs: await Promise.all(runs.map(async run => ({
          run,
          attempts: await this.ctx.taskboard.listPatrolAttempts(run.id),
        }))),
      }
    })
  }

  /**
   * Validate and save one Patrol Policy version.
   * @param input - Workspace policy replacements and optimistic version.
   * @returns updated durable policy.
   */
  @Remote('updatePatrol')
  updatePatrol(input: UpdatePatrolPolicyInput): Promise<TaskboardRemoteResult<PatrolPolicy>> {
    return this.result(() => this.ctx.taskboardPatrol.updatePolicy(input))
  }

  /**
   * Start one manual background Patrol Run.
   * @param input - Workspace and optional exact todo Issue.
   * @returns accepted active Run.
   */
  @Remote('runPatrol')
  runPatrol(input: TaskboardPatrolTriggerInput): Promise<TaskboardRemoteResult<PatrolRun>> {
    return this.result(() => this.ctx.taskboardPatrol.trigger(input))
  }

  /**
   * Read one Issue's persistent implementation binding and Reviewer evidence.
   * @param reference - opaque id or human-readable identifier.
   * @returns explicit nullable binding and append-only reviews.
   */
  @Remote('patrolIssue')
  patrolIssue(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardPatrolIssueValue>> {
    return this.result(async () => {
      const context = await this.ctx.taskboard.getPatrolDevelopmentContext(reference) ?? null
      return {
        context,
        worktreePresent: context === null ? false : await this.ctx.taskboardPatrol.worktreePresent(context),
        diff: context === null || context.resultCommit === null
          ? null
          : await this.ctx.taskboardPatrol.diff(context, context.resultCommit),
        reviews: await this.ctx.taskboard.listPatrolReviews(reference),
      }
    })
  }

  /**
   * Remove one explicitly confirmed, clean, integrated Issue worktree.
   * @param input - Workspace, Issue lookup, and confirmation.
   * @returns preserved Development Context identities.
   */
  @Remote('removePatrolWorktree')
  removePatrolWorktree(
    input: TaskboardPatrolWorktreeRemovalInput,
  ): Promise<TaskboardRemoteResult<TaskboardPatrolWorktreeRemovalValue>> {
    return this.result(() => this.ctx.taskboardPatrol.removeWorktree(input))
  }

  /** Resolve one registered Workspace or return the shared Taskboard failure. */
  private requireWorkspace(workspaceId: WorkspaceId) {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) {
      throw new TaskboardError('workspace_not_found', `Workspace '${workspaceId}' does not exist`)
    }
    return workspace
  }

  /** Serialize data creation against deletion of the owning registration. */
  private withRegisteredWorkspace<T>(
    workspaceId: WorkspaceId,
    operation: (workspace: Workspace) => Promise<T>,
  ): Promise<T> {
    return this.ctx.workspaceRegistry.withRegistration(workspaceId, async (workspace) => {
      if (workspace === undefined) {
        throw new TaskboardError('workspace_not_found', `Workspace '${workspaceId}' does not exist`)
      }
      return await operation(workspace)
    })
  }

  /** Preserve stable domain errors while allowing infrastructure faults to reject. */
  private async result<T>(operation: () => Promise<T>): Promise<TaskboardRemoteResult<T>> {
    try {
      return { ok: true, value: await operation() }
    } catch (error) {
      if (error instanceof TaskboardError) {
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      throw error
    }
  }
}

/** Decode canonical base64 without allowing a carrier to bypass the 25 MB limit. */
function decodeAttachment(data: string): Uint8Array {
  const maximumEncodedLength = Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4
  if (data.length > maximumEncodedLength) {
    throw new TaskboardError('attachment_too_large', `attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte maximum`)
  }
  if (data.length % 4 !== 0) {
    throw new TaskboardError('attachment_invalid', 'attachment data must be canonical base64')
  }
  const decoded = Buffer.from(data, 'base64')
  if (decoded.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new TaskboardError('attachment_too_large', `attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte maximum`)
  }
  if (decoded.toString('base64') !== data) {
    throw new TaskboardError('attachment_invalid', 'attachment data must be canonical base64')
  }
  return new Uint8Array(decoded)
}

export default TaskboardRemote
