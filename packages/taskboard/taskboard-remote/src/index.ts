/** Host Remote Consumer for the Workspace-owned Taskboard capability. */

import type { Context } from '@deepseek-ai/cordis'
import {
  TaskboardError,
} from '@deepseek-ai/dsh-taskboard'
import type {
  AddCommentInput,
  AddIssueRelationInput,
  Comment,
  CreateIssueInput,
  Issue,
  IssueReference,
  IssueRelationMutation,
  ListIssuesInput,
  MoveIssueInput,
  RemoveIssueRelationInput,
  SetWorkspacePrefixInput,
  UpdateIssueInput,
  VersionedIssueInput,
  WorkspaceTaskboard,
} from '@deepseek-ai/dsh-taskboard/types'
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  TaskboardActivityListValue,
  TaskboardCommentListValue,
  TaskboardIssueListValue,
  TaskboardIssueValue,
  TaskboardRelationListValue,
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
  static inject = ['taskboard', 'workspaceRegistry']

  constructor(ctx: Context) {
    super(ctx, 'taskboardRemote', { namespace: 'taskboard' })
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
    return this.result(async () => {
      const workspace = this.requireWorkspace(input.workspaceId)
      await this.ctx.taskboard.ensureWorkspace({ workspaceId: workspace.id, title: workspace.title })
      return await this.ctx.taskboard.createIssue(input)
    })
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
    return this.result(async () => {
      const workspace = this.requireWorkspace(input.targetWorkspaceId)
      await this.ctx.taskboard.ensureWorkspace({ workspaceId: workspace.id, title: workspace.title })
      return await this.ctx.taskboard.moveIssue(input)
    })
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
   * List one Issue's append-only Activity.
   * @param reference - Opaque id or human-readable identifier.
   * @returns ordered Activity or a stable business failure.
   */
  @Remote('listActivities')
  listActivities(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardActivityListValue>> {
    return this.result(async () => ({ items: await this.ctx.taskboard.listActivities(reference) }))
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

  /** Resolve one registered Workspace or return the shared Taskboard failure. */
  private requireWorkspace(workspaceId: WorkspaceId) {
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) {
      throw new TaskboardError('workspace_not_found', `Workspace '${workspaceId}' does not exist`)
    }
    return workspace
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

export default TaskboardRemote
