/** Slot and injected-face contracts for the Taskboard UI registrations. */

import type { HostObservable, InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceId } from '@deepseek-ai/dsh-client-runtime/client'
import type { CreateIssueInput, Issue, IssueReference, IssueRelation, TaskboardAttachment, UpdateIssueInput, UpdatePatrolPolicyInput } from '@deepseek-ai/dsh-taskboard/types'
import type { TaskboardActionResult, TaskboardAttachmentReadResult, TaskboardSnapshot } from './controller.ts'
import type { createTaskboardViewStore } from './store.ts'

/** Shared data and operations injected into both Taskboard shell entries. */
export interface TaskboardInjected {
  hooks: { taskboard: HostObservable<TaskboardSnapshot> }
  activate: (workspaceId: WorkspaceId) => Promise<TaskboardActionResult>
  refresh: () => Promise<TaskboardActionResult>
  createIssue: (input: Omit<CreateIssueInput, 'workspaceId'>) => Promise<TaskboardActionResult>
  openIssue: (reference: IssueReference) => void
  openPatrol: () => void
  moveIssue: (
    issue: Issue,
    patch: Omit<UpdateIssueInput, 'reference' | 'expectedVersion' | 'actor'>,
  ) => Promise<TaskboardActionResult>
  updateIssue: (
    issue: Issue,
    patch: Omit<UpdateIssueInput, 'reference' | 'expectedVersion' | 'actor'>,
  ) => Promise<TaskboardActionResult>
  archiveIssue: (issue: Issue) => Promise<TaskboardActionResult>
  addComment: (body: string) => Promise<TaskboardActionResult>
  addAttachment: (file: File) => Promise<TaskboardActionResult>
  readAttachment: (attachment: TaskboardAttachment) => Promise<TaskboardAttachmentReadResult>
  deleteAttachment: (attachment: TaskboardAttachment, confirmed: boolean) => Promise<TaskboardActionResult>
  addRelation: (type: IssueRelation['type'], reference: IssueReference) => Promise<TaskboardActionResult>
  removeRelation: (relation: IssueRelation) => Promise<TaskboardActionResult>
  updatePatrol: (
    patch: Omit<UpdatePatrolPolicyInput, 'workspaceId' | 'expectedVersion'>,
  ) => Promise<TaskboardActionResult>
  runPatrol: (issue?: IssueReference) => Promise<TaskboardActionResult>
  close: () => void
}

/** Full props for the Taskboard center chain entry. */
export type TaskboardSurfaceProps =
  & PropsRuntime<'shell.center'>
  & { matched: WorkspaceId }
  & PropsStore<ReturnType<typeof createTaskboardViewStore>>
  & InjectFace<TaskboardInjected>
  & PropsLocale<'taskboard'>

/** Full props for the Taskboard details chain entry. */
export type TaskboardDetailsProps =
  & PropsRuntime<'shell.details'>
  & { matched: WorkspaceId }
  & PropsStore<ReturnType<typeof createTaskboardViewStore>>
  & InjectFace<TaskboardInjected>
  & PropsLocale<'taskboard'>
