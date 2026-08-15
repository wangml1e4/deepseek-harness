/** React-free browser object layer for one active Workspace Taskboard. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  Activity,
  TaskboardAttachment,
  AddCommentInput,
  AddIssueRelationInput,
  Comment,
  CreateIssueInput,
  DeleteAttachmentInput,
  Issue,
  IssueReference,
  IssueRelation,
  IssueRelationMutation,
  ListIssuesInput,
  RemoveIssueRelationInput,
  TaskboardActor,
  UpdateIssueInput,
  UpdatePatrolPolicyInput,
  VersionedIssueInput,
  WorkspaceTaskboard,
} from '@deepseek-ai/dsh-taskboard/types'
import type {
  TaskboardActivityListValue,
  TaskboardAttachmentContentValue,
  TaskboardAttachmentListValue,
  TaskboardAttachmentReadInput,
  TaskboardAttachmentUploadInput,
  TaskboardCommentListValue,
  TaskboardIssueListValue,
  TaskboardIssueValue,
  TaskboardPatrolIssueValue,
  TaskboardPatrolTriggerInput,
  TaskboardPatrolValue,
  TaskboardRelationListValue,
  TaskboardRemoteResult,
} from '@deepseek-ai/dsh-taskboard-remote/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'

/** Browser preflight mirror of the Host-enforced Taskboard attachment protocol limit. */
export const MAX_TASKBOARD_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** Remote methods used by the Taskboard browser object layer. */
export interface TaskboardClientRemote {
  workspace: (workspaceId: WorkspaceId) => Promise<RemoteResult<TaskboardRemoteResult<WorkspaceTaskboard>>>
  listIssues: (input: ListIssuesInput) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardIssueListValue>>>
  getIssue: (reference: IssueReference) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardIssueValue>>>
  createIssue: (input: CreateIssueInput) => Promise<RemoteResult<TaskboardRemoteResult<Issue>>>
  updateIssue: (input: UpdateIssueInput) => Promise<RemoteResult<TaskboardRemoteResult<Issue>>>
  archiveIssue: (input: VersionedIssueInput) => Promise<RemoteResult<TaskboardRemoteResult<Issue>>>
  listComments: (reference: IssueReference) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardCommentListValue>>>
  addComment: (input: AddCommentInput) => Promise<RemoteResult<TaskboardRemoteResult<Comment>>>
  listAttachments: (
    reference: IssueReference,
  ) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardAttachmentListValue>>>
  addAttachment: (
    input: TaskboardAttachmentUploadInput,
  ) => Promise<RemoteResult<TaskboardRemoteResult<{ issue: Issue; attachment: TaskboardAttachment }>>>
  readAttachment: (
    input: TaskboardAttachmentReadInput,
  ) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardAttachmentContentValue>>>
  deleteAttachment: (
    input: DeleteAttachmentInput,
  ) => Promise<RemoteResult<TaskboardRemoteResult<Issue>>>
  listActivities: (reference: IssueReference) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardActivityListValue>>>
  listWorkspaceRelations: (
    workspaceId: WorkspaceId,
  ) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardRelationListValue>>>
  listRelations: (reference: IssueReference) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardRelationListValue>>>
  addRelation: (input: AddIssueRelationInput) => Promise<RemoteResult<TaskboardRemoteResult<IssueRelationMutation>>>
  removeRelation: (input: RemoveIssueRelationInput) => Promise<RemoteResult<TaskboardRemoteResult<Issue>>>
  patrol: (workspaceId: WorkspaceId) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardPatrolValue>>>
  updatePatrol: (input: UpdatePatrolPolicyInput) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardPatrolValue['policy']>>>
  runPatrol: (input: TaskboardPatrolTriggerInput) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardPatrolValue['runs'][number]['run']>>>
  patrolIssue: (reference: IssueReference) => Promise<RemoteResult<TaskboardRemoteResult<TaskboardPatrolIssueValue>>>
}

/** Load phase for the active Taskboard. */
export type TaskboardPhase = 'cold' | 'loading' | 'ready' | 'error'
/** Load phase for the selected Issue's secondary records. */
export type TaskboardDetailPhase = 'idle' | 'loading' | 'ready' | 'error'
/** Right sidebar content selected by the user. */
export type TaskboardDetailPanel = 'issue' | 'patrol' | null

/** Immutable snapshot shared by the center and details Taskboard entries. */
export interface TaskboardSnapshot {
  readonly phase: TaskboardPhase
  readonly workspaceId: WorkspaceId | null
  readonly workspace: WorkspaceTaskboard | null
  readonly issues: readonly Issue[]
  readonly selectedIssue: Issue | null
  readonly detailPanel: TaskboardDetailPanel
  readonly detailPhase: TaskboardDetailPhase
  readonly comments: readonly Comment[]
  readonly attachments: readonly TaskboardAttachment[]
  readonly activities: readonly Activity[]
  readonly workspaceRelations: readonly IssueRelation[]
  readonly relations: readonly IssueRelation[]
  readonly patrol: TaskboardPatrolValue | null
  readonly patrolIssue: TaskboardPatrolIssueValue | null
  readonly error: string | null
  readonly detailError: string | null
  readonly actionError: string | null
}

/** Settled controller operation without exposing the Remote's nested envelope. */
export type TaskboardActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** Settled Issue-scoped attachment read for preview or download. */
export type TaskboardAttachmentReadResult =
  | { readonly ok: true; readonly value: TaskboardAttachmentContentValue }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

type ValueResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

const OK: TaskboardActionResult = Object.freeze({ ok: true })
const EMPTY: TaskboardSnapshot = Object.freeze({
  phase: 'cold',
  workspaceId: null,
  workspace: null,
  issues: Object.freeze([]),
  selectedIssue: null,
  detailPanel: null,
  detailPhase: 'idle',
  comments: Object.freeze([]),
  attachments: Object.freeze([]),
  activities: Object.freeze([]),
  workspaceRelations: Object.freeze([]),
  relations: Object.freeze([]),
  patrol: null,
  patrolIssue: null,
  error: null,
  detailError: null,
  actionError: null,
})

/** Remove the carrier and business envelopes from one Taskboard response. */
function unwrap<T>(result: RemoteResult<TaskboardRemoteResult<T>>): ValueResult<T> {
  if (!result.ok) {
    return { ok: false, error: { code: result.error.code, message: result.error.message } }
  }
  if (!result.value.ok) return { ok: false, error: result.value.error }
  return { ok: true, value: result.value.value }
}

/** Convert an unexpected rejected assembly call into presentation-safe text. */
function rejected(error: unknown): ValueResult<never> {
  return {
    ok: false,
    error: {
      code: 'unexpected',
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

/** Stable status ordering used when a mutation changes an Issue's column. */
const STATUS_ORDER: Record<Issue['status'], number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  in_review: 3,
  blocked: 4,
  done: 5,
  canceled: 6,
}

/** Return Issues in board-column then manual-order sequence. */
function ordered(issues: readonly Issue[]): readonly Issue[] {
  return [...issues].sort((a, b) => (
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || a.sortOrder - b.sortOrder
    || a.identifier.localeCompare(b.identifier)
  ))
}

/** Normalize either endpoint's relation view into the stored blocker-to-blocked direction. */
function canonicalRelation(relation: IssueRelation): IssueRelation {
  if (relation.type === 'blocks') return relation
  return {
    ...relation,
    type: 'blocks',
    issueId: relation.relatedIssueId,
    relatedIssueId: relation.issueId,
  }
}

/** Browser object layer for the active Workspace's durable Taskboard. */
export class TaskboardController implements HostObservable<TaskboardSnapshot> {
  private snapshot = EMPTY
  private readonly listeners = new Set<() => void>()
  private activation = 0
  private detailLoad = 0
  private disposed = false

  /** @param remote - generated Taskboard Remote namespace. */
  constructor(private readonly remote: TaskboardClientRemote) {}

  /** @returns the current immutable Taskboard snapshot. */
  getSnapshot = (): TaskboardSnapshot => this.snapshot

  /**
   * Subscribe to snapshot replacements.
   * @param listener - callback invoked after publication.
   * @returns subscription disposer.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Select and load one Workspace Taskboard; older responses cannot replace a newer selection.
   * @param workspaceId - Workspace selected by the shell surface.
   * @returns settled load result.
   */
  async activate(workspaceId: WorkspaceId): Promise<TaskboardActionResult> {
    const generation = ++this.activation
    ++this.detailLoad
    this.publish({
      ...EMPTY,
      phase: 'loading',
      workspaceId,
    })
    const result = await this.readWorkspace(workspaceId)
    if (this.disposed || generation !== this.activation) return result.ok ? OK : result
    if (!result.ok) {
      this.publish({ ...this.snapshot, phase: 'error', error: result.error.message })
      return result
    }
    this.publish({
      ...EMPTY,
      phase: 'ready',
      workspaceId,
      workspace: result.value[0],
      issues: ordered(result.value[1].items),
      workspaceRelations: result.value[2].items,
      patrol: result.value[3],
    })
    return OK
  }

  /**
   * Re-read the current Workspace after a pushed invalidation.
   * @returns settled load result, or a no-op when no Workspace is active.
   */
  async refresh(): Promise<TaskboardActionResult> {
    const workspaceId = this.snapshot.workspaceId
    if (workspaceId === null) return OK
    const selectedId = this.snapshot.selectedIssue?.id
    const detailPanel = this.snapshot.detailPanel
    const generation = ++this.activation
    ++this.detailLoad
    const result = await this.readWorkspace(workspaceId)
    if (this.disposed || generation !== this.activation) return result.ok ? OK : result
    if (!result.ok) {
      this.publish({ ...this.snapshot, error: result.error.message })
      return result
    }
    const issues = ordered(result.value[1].items)
    const selected = selectedId === undefined ? null : issues.find(issue => issue.id === selectedId) ?? null
    this.publish({
      ...this.snapshot,
      phase: 'ready',
      workspace: result.value[0],
      issues,
      workspaceRelations: result.value[2].items,
      patrol: result.value[3],
      selectedIssue: selected,
      detailPanel: selected === null ? detailPanel === 'patrol' ? 'patrol' : null : 'issue',
      detailPhase: selected === null ? 'idle' : 'loading',
      comments: selected === null ? [] : this.snapshot.comments,
      attachments: selected === null ? [] : this.snapshot.attachments,
      activities: selected === null ? [] : this.snapshot.activities,
      relations: selected === null ? [] : this.snapshot.relations,
      patrolIssue: selected === null ? null : this.snapshot.patrolIssue,
      error: null,
    })
    if (selected !== null) return await this.selectIssue(selected.id)
    return OK
  }

  /**
   * Select one Issue and load its comments, activity, and dependency views together.
   * @param reference - Issue id or identifier.
   * @returns settled detail-load result.
   */
  async selectIssue(reference: IssueReference): Promise<TaskboardActionResult> {
    const generation = ++this.detailLoad
    const immediate = this.snapshot.issues.find(issue => issue.id === reference || issue.identifier === reference) ?? null
    this.publish({
      ...this.snapshot,
      selectedIssue: immediate,
      detailPanel: 'issue',
      detailPhase: 'loading',
      comments: [],
      attachments: [],
      activities: [],
      relations: [],
      patrolIssue: null,
      detailError: null,
      actionError: null,
    })
    const result = await this.readIssueDetails(reference)
    if (this.disposed || generation !== this.detailLoad) return result.ok ? OK : result
    if (!result.ok) {
      this.publish({ ...this.snapshot, detailPhase: 'error', detailError: result.error.message })
      return result
    }
    const selectedIssue = result.value[0].issue
    if (selectedIssue === null) {
      const missing = { ok: false as const, error: { code: 'issue_not_found', message: `Issue '${reference}' does not exist` } }
      this.publish({ ...this.snapshot, selectedIssue: null, detailPhase: 'error', detailError: missing.error.message })
      return missing
    }
    this.publish({
      ...this.snapshot,
      selectedIssue,
      detailPhase: 'ready',
      comments: result.value[1].items,
      attachments: result.value[2].items,
      activities: result.value[3].items,
      relations: result.value[4].items,
      patrolIssue: result.value[5],
      detailError: null,
    })
    return OK
  }

  /** Clear the selected Issue and its secondary records. */
  clearSelection(): void {
    ++this.detailLoad
    this.publish({
      ...this.snapshot,
      selectedIssue: null,
      detailPanel: null,
      detailPhase: 'idle',
      comments: [],
      attachments: [],
      activities: [],
      relations: [],
      patrolIssue: null,
      detailError: null,
      actionError: null,
    })
  }

  /** Select the Workspace Patrol settings/history panel without loading an Issue. */
  openPatrol(): void {
    ++this.detailLoad
    this.publish({
      ...this.snapshot,
      selectedIssue: null,
      detailPanel: 'patrol',
      detailPhase: 'idle',
      comments: [],
      attachments: [],
      activities: [],
      relations: [],
      patrolIssue: null,
      detailError: null,
      actionError: null,
    })
  }

  /**
   * Save Patrol fields using the currently rendered policy version.
   * @param patch - policy replacements excluding Workspace identity and version.
   * @returns settled mutation result.
   */
  async updatePatrol(
    patch: Omit<UpdatePatrolPolicyInput, 'workspaceId' | 'expectedVersion'>,
  ): Promise<TaskboardActionResult> {
    const context = this.patrolMutationContext()
    if (context === null) {
      return this.fail('workspace_not_found', 'No Workspace Patrol Policy is active')
    }
    const { patrol, workspaceId, generation } = context
    return await this.mutate(
      () => this.remote.updatePatrol({
        ...patch,
        workspaceId,
        expectedVersion: patrol.policy.version,
      }),
      () => this.isActiveWorkspace(generation, workspaceId),
      (policy) => {
        this.publish({ ...this.snapshot, patrol: { ...patrol, policy }, actionError: null })
      },
    )
  }

  /**
   * Start one manual Run and add its active record until pushed invalidation refreshes history.
   * @param issue - optional exact todo Issue.
   * @returns settled mutation result.
   */
  async runPatrol(issue?: IssueReference): Promise<TaskboardActionResult> {
    const context = this.patrolMutationContext()
    if (context === null) {
      return this.fail('workspace_not_found', 'No Workspace Patrol Policy is active')
    }
    const { workspaceId, generation } = context
    return await this.mutate(
      () => this.remote.runPatrol({ workspaceId, ...issue === undefined ? {} : { issue } }),
      () => this.isActiveWorkspace(generation, workspaceId),
      (run) => {
        /* v8 ignore next -- the active-Workspace guard retains the Patrol snapshot captured above. */
        if (this.snapshot.patrol === null) return
        this.publish({
          ...this.snapshot,
          patrol: {
            ...this.snapshot.patrol,
            runs: [{ run, attempts: [] }, ...this.snapshot.patrol.runs.filter(value => value.run.id !== run.id)],
          },
          actionError: null,
        })
      },
    )
  }

  /**
   * Create an Issue in the active Workspace and add its authoritative value to the view.
   * @param input - create fields excluding the active Workspace identity.
   * @returns settled mutation result.
   */
  async createIssue(input: Omit<CreateIssueInput, 'workspaceId'>): Promise<TaskboardActionResult> {
    const workspaceId = this.snapshot.workspaceId
    if (workspaceId === null) return this.fail('workspace_not_found', 'No Workspace Taskboard is active')
    const generation = this.activation
    return await this.mutate(
      () => this.remote.createIssue({ ...input, workspaceId }),
      () => this.isActiveWorkspace(generation, workspaceId),
      (issue) => { this.publish({ ...this.snapshot, issues: ordered([...this.snapshot.issues, issue]), actionError: null }) },
    )
  }

  /**
   * Update an Issue using the version currently rendered by the caller.
   * @param issue - authoritative Issue value observed by the caller.
   * @param patch - replacement fields.
   * @param actor - mutation attribution.
   * @returns settled mutation result.
   */
  async updateIssue(
    issue: Issue,
    patch: Omit<UpdateIssueInput, 'reference' | 'expectedVersion' | 'actor'>,
    actor: TaskboardActor,
  ): Promise<TaskboardActionResult> {
    const generation = this.activation
    return await this.mutate(
      () => this.remote.updateIssue({
        ...patch,
        reference: issue.id,
        expectedVersion: issue.version,
        actor,
      }),
      () => this.isActiveWorkspace(generation, issue.workspaceId),
      (updated) => { this.replaceIssue(updated) },
    )
  }

  /**
   * Archive an Issue and remove it from active views without deleting it.
   * @param issue - authoritative Issue value observed by the caller.
   * @param actor - mutation attribution.
   * @returns settled mutation result.
   */
  async archiveIssue(issue: Issue, actor: TaskboardActor): Promise<TaskboardActionResult> {
    const generation = this.activation
    return await this.mutate(
      () => this.remote.archiveIssue({
        reference: issue.id,
        expectedVersion: issue.version,
        actor,
      }),
      () => this.isActiveWorkspace(generation, issue.workspaceId),
      (archived) => {
        ++this.detailLoad
        const closesSelection = this.snapshot.selectedIssue?.id === archived.id
        this.publish({
          ...this.snapshot,
          issues: this.snapshot.issues.filter(candidate => candidate.id !== archived.id),
          selectedIssue: closesSelection ? null : this.snapshot.selectedIssue,
          detailPanel: closesSelection ? null : this.snapshot.detailPanel,
          detailPhase: closesSelection ? 'idle' : this.snapshot.detailPhase,
          comments: closesSelection ? [] : this.snapshot.comments,
          attachments: closesSelection ? [] : this.snapshot.attachments,
          activities: closesSelection ? [] : this.snapshot.activities,
          relations: closesSelection ? [] : this.snapshot.relations,
          patrolIssue: closesSelection ? null : this.snapshot.patrolIssue,
          actionError: null,
        })
      },
    )
  }

  /**
   * Append a Comment to the selected Issue.
   * @param body - nonblank comment body.
   * @param actor - comment attribution.
   * @returns settled mutation result.
   */
  async addComment(body: string, actor: TaskboardActor): Promise<TaskboardActionResult> {
    const selected = this.snapshot.selectedIssue
    if (selected === null) return this.fail('issue_not_found', 'No Issue is selected')
    const generation = this.detailLoad
    return await this.mutate(
      () => this.remote.addComment({ reference: selected.id, body, actor }),
      () => this.isSelectedIssue(generation),
      (comment) => { this.publish({ ...this.snapshot, comments: [...this.snapshot.comments, comment], actionError: null }) },
    )
  }

  /**
   * Upload one browser file to the selected Issue and advance its rendered version.
   * @param file - browser-owned file selected by the user.
   * @param actor - upload attribution.
   * @returns settled mutation result.
   */
  async addAttachment(file: File, actor: TaskboardActor): Promise<TaskboardActionResult> {
    const selected = this.snapshot.selectedIssue
    if (selected === null) return this.fail('issue_not_found', 'No Issue is selected')
    if (file.size > MAX_TASKBOARD_ATTACHMENT_BYTES) {
      return this.fail(
        'attachment_too_large',
        `Attachment '${file.name}' is ${file.size} bytes; maximum is ${MAX_TASKBOARD_ATTACHMENT_BYTES}`,
      )
    }
    const generation = this.detailLoad
    let data: string
    try {
      data = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    } catch (error: unknown) {
      return this.fail('attachment_invalid', error instanceof Error ? error.message : String(error))
    }
    return await this.mutate(
      () => this.remote.addAttachment({
        reference: selected.id,
        expectedVersion: selected.version,
        name: file.name,
        mediaType: file.type || 'application/octet-stream',
        data,
        actor,
      }),
      () => this.isSelectedIssue(generation),
      (result) => {
        this.replaceIssue(result.issue)
        this.publish({
          ...this.snapshot,
          attachments: [...this.snapshot.attachments, result.attachment],
          actionError: null,
        })
      },
    )
  }

  /**
   * Read selected attachment bytes through the controlled Remote operation.
   * @param attachment - metadata observed in the selected details view.
   * @returns metadata and canonical base64 bytes, or a normalized failure.
   */
  async readAttachment(attachment: TaskboardAttachment): Promise<TaskboardAttachmentReadResult> {
    const selected = this.snapshot.selectedIssue
    if (selected === null || attachment.issueId !== selected.id) {
      return { ok: false, error: { code: 'attachment_not_found', message: 'Attachment is not in the selected Issue' } }
    }
    return await this.call(() => this.remote.readAttachment({
      reference: selected.id,
      attachmentId: attachment.id,
    }))
  }

  /**
   * Permanently delete one attachment after the UI records explicit confirmation.
   * @param attachment - metadata observed in the selected details view.
   * @param confirmed - explicit user confirmation.
   * @param actor - deletion attribution.
   * @returns settled mutation result.
   */
  async deleteAttachment(
    attachment: TaskboardAttachment,
    confirmed: boolean,
    actor: TaskboardActor,
  ): Promise<TaskboardActionResult> {
    const selected = this.snapshot.selectedIssue
    if (selected === null || attachment.issueId !== selected.id) {
      return this.fail('attachment_not_found', 'Attachment is not in the selected Issue')
    }
    const generation = this.detailLoad
    return await this.mutate(
      () => this.remote.deleteAttachment({
        reference: selected.id,
        attachmentId: attachment.id,
        expectedVersion: selected.version,
        confirmed,
        actor,
      }),
      () => this.isSelectedIssue(generation),
      (issue) => {
        this.replaceIssue(issue)
        this.publish({
          ...this.snapshot,
          attachments: this.snapshot.attachments.filter(candidate => candidate.id !== attachment.id),
          actionError: null,
        })
      },
    )
  }

  /**
   * Add a dependency to the selected Issue.
   * @param type - dependency direction from the selected Issue.
   * @param relatedReference - Issue at the other end.
   * @param actor - mutation attribution.
   * @returns settled mutation result.
   */
  async addRelation(
    type: IssueRelation['type'],
    relatedReference: IssueReference,
    actor: TaskboardActor,
  ): Promise<TaskboardActionResult> {
    const selected = this.snapshot.selectedIssue
    if (selected === null) return this.fail('issue_not_found', 'No Issue is selected')
    const generation = this.detailLoad
    return await this.mutate(
      () => this.remote.addRelation({
        reference: selected.id,
        expectedVersion: selected.version,
        type,
        relatedReference,
        actor,
      }),
      () => this.isSelectedIssue(generation),
      (result) => {
        this.replaceIssue(
          result.issue,
          [...this.snapshot.relations, result.relation],
          [...this.snapshot.workspaceRelations, canonicalRelation(result.relation)],
        )
      },
    )
  }

  /**
   * Remove one selected Issue dependency while keeping its activity history.
   * @param relation - relation visible from the selected Issue.
   * @param actor - mutation attribution.
   * @returns settled mutation result.
   */
  async removeRelation(relation: IssueRelation, actor: TaskboardActor): Promise<TaskboardActionResult> {
    const selected = this.snapshot.selectedIssue
    if (selected === null) return this.fail('issue_not_found', 'No Issue is selected')
    const generation = this.detailLoad
    return await this.mutate(
      () => this.remote.removeRelation({
        reference: selected.id,
        expectedVersion: selected.version,
        relationId: relation.id,
        actor,
      }),
      () => this.isSelectedIssue(generation),
      (updated) => {
        this.replaceIssue(
          updated,
          this.snapshot.relations.filter(candidate => candidate.id !== relation.id),
          this.snapshot.workspaceRelations.filter(candidate => candidate.id !== relation.id),
        )
      },
    )
  }

  /** Stop publishing and invalidate pending reads. */
  dispose(): void {
    this.disposed = true
    ++this.activation
    ++this.detailLoad
    this.listeners.clear()
  }

  /** Read one Workspace Taskboard and its active Issue list as a single view. */
  private async readWorkspace(workspaceId: WorkspaceId): Promise<ValueResult<readonly [
    WorkspaceTaskboard,
    TaskboardIssueListValue,
    TaskboardRelationListValue,
    TaskboardPatrolValue,
  ]>> {
    try {
      const [workspaceResponse, issueResponse, relationResponse, patrolResponse] = await Promise.all([
        this.remote.workspace(workspaceId),
        this.remote.listIssues({ workspaceId }),
        this.remote.listWorkspaceRelations(workspaceId),
        this.remote.patrol(workspaceId),
      ])
      const workspace = unwrap(workspaceResponse)
      if (!workspace.ok) return workspace
      const issues = unwrap(issueResponse)
      if (!issues.ok) return issues
      const relations = unwrap(relationResponse)
      if (!relations.ok) return relations
      const patrol = unwrap(patrolResponse)
      return patrol.ok
        ? { ok: true, value: [workspace.value, issues.value, relations.value, patrol.value] }
        : patrol
    } catch (error: unknown) {
      return rejected(error)
    }
  }

  /** Read one Issue and all detail-side records as a single view. */
  private async readIssueDetails(reference: IssueReference): Promise<ValueResult<readonly [
    TaskboardIssueValue,
    TaskboardCommentListValue,
    TaskboardAttachmentListValue,
    TaskboardActivityListValue,
    TaskboardRelationListValue,
    TaskboardPatrolIssueValue,
  ]>> {
    try {
      const responses = await Promise.all([
        this.remote.getIssue(reference),
        this.remote.listComments(reference),
        this.remote.listAttachments(reference),
        this.remote.listActivities(reference),
        this.remote.listRelations(reference),
        this.remote.patrolIssue(reference),
      ])
      const selected = unwrap(responses[0])
      if (!selected.ok) return selected
      const comments = unwrap(responses[1])
      if (!comments.ok) return comments
      const attachments = unwrap(responses[2])
      if (!attachments.ok) return attachments
      const activities = unwrap(responses[3])
      if (!activities.ok) return activities
      const relations = unwrap(responses[4])
      if (!relations.ok) return relations
      const patrol = unwrap(responses[5])
      return patrol.ok
        ? { ok: true, value: [selected.value, comments.value, attachments.value, activities.value, relations.value, patrol.value] }
        : patrol
    } catch (error: unknown) {
      return rejected(error)
    }
  }

  /** Execute one Remote call and normalize unexpected rejection. */
  private async call<T>(operation: () => Promise<RemoteResult<TaskboardRemoteResult<T>>>): Promise<ValueResult<T>> {
    try {
      return unwrap(await operation())
    } catch (error: unknown) {
      return rejected(error)
    }
  }

  /** Apply one mutation only while its originating view is still current. */
  private async mutate<T>(
    operation: () => Promise<RemoteResult<TaskboardRemoteResult<T>>>,
    current: () => boolean,
    commit: (value: T) => void,
  ): Promise<TaskboardActionResult> {
    const result = await this.call(operation)
    if (!current()) return result.ok ? OK : result
    if (!result.ok) return this.publishFailure(result)
    commit(result.value)
    return OK
  }

  /** Publish one action failure and return its public result. */
  private publishFailure(result: Extract<ValueResult<never>, { ok: false }>): TaskboardActionResult {
    this.publish({ ...this.snapshot, actionError: result.error.message })
    return result
  }

  /** Create and publish one local precondition failure. */
  private fail(code: string, message: string): TaskboardActionResult {
    const result = { ok: false as const, error: { code, message } }
    return this.publishFailure(result)
  }

  /** Replace one Issue in both list and selected-detail projections. */
  private replaceIssue(
    issue: Issue,
    relations = this.snapshot.relations,
    workspaceRelations = this.snapshot.workspaceRelations,
  ): void {
    const issues = this.snapshot.issues.map(candidate => candidate.id === issue.id ? issue : candidate)
    this.publish({
      ...this.snapshot,
      issues: ordered(issues),
      selectedIssue: this.snapshot.selectedIssue?.id === issue.id ? issue : this.snapshot.selectedIssue,
      relations,
      workspaceRelations,
      actionError: null,
    })
  }

  /** Capture the Patrol records required by one Workspace-scoped mutation. */
  private patrolMutationContext(): {
    readonly patrol: TaskboardPatrolValue
    readonly workspaceId: WorkspaceId
    readonly generation: number
  } | null {
    const patrol = this.snapshot.patrol
    const workspaceId = this.snapshot.workspaceId
    return patrol === null || workspaceId === null
      ? null
      : { patrol, workspaceId, generation: this.activation }
  }

  /** Whether an operation still belongs to the Workspace snapshot that started it. */
  private isActiveWorkspace(generation: number, workspaceId: WorkspaceId): boolean {
    return !this.disposed && generation === this.activation && this.snapshot.workspaceId === workspaceId
  }

  /** Whether a detail operation still belongs to the selected Issue that started it. */
  private isSelectedIssue(generation: number): boolean {
    return !this.disposed && generation === this.detailLoad
  }

  /** Replace the cached snapshot and notify subscribers synchronously. */
  private publish(snapshot: TaskboardSnapshot): void {
    if (this.disposed) return
    this.snapshot = Object.freeze(snapshot)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        console.error('[ui-taskboard] snapshot listener threw:', error)
      }
    }
  }
}

/** Encode browser bytes without overflowing the JavaScript call stack. */
function bytesToBase64(data: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}
