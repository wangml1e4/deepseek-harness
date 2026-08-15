/** Client-safe result vocabulary for the Taskboard Host Remote. */

import type {
  Activity,
  Comment,
  Issue,
  IssueRelation,
} from '@deepseek-ai/dsh-taskboard/types'
import type { TaskboardErrorCode } from '@deepseek-ai/dsh-taskboard'

/** Stable business failure returned without collapsing it into a carrier error. */
export interface TaskboardRemoteFailure {
  readonly code: TaskboardErrorCode
  readonly message: string
}

/** Successful Taskboard Remote call. */
export interface TaskboardRemoteSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Rejected Taskboard Remote call. */
export interface TaskboardRemoteRejected {
  readonly ok: false
  readonly error: TaskboardRemoteFailure
}

/** Business result shared by Taskboard Remote operations. */
export type TaskboardRemoteResult<T> = TaskboardRemoteSuccess<T> | TaskboardRemoteRejected

/** Explicit Issue lookup result. */
export interface TaskboardIssueValue {
  readonly issue: Issue | null
}

/** Ordered Issue list result. */
export interface TaskboardIssueListValue {
  readonly items: readonly Issue[]
}

/** Ordered Comment list result. */
export interface TaskboardCommentListValue {
  readonly items: readonly Comment[]
}

/** Ordered Activity list result. */
export interface TaskboardActivityListValue {
  readonly items: readonly Activity[]
}

/** Ordered relation list result. */
export interface TaskboardRelationListValue {
  readonly items: readonly IssueRelation[]
}
