/** Client-safe result vocabulary for the Taskboard Host Remote. */

import type {
  Activity,
  Comment,
  Issue,
  IssueReference,
  IssueRelation,
  PatrolAttempt,
  PatrolDevelopmentContext,
  PatrolPolicy,
  PatrolReview,
  PatrolRun,
} from '@deepseek-ai/dsh-taskboard/types'
import type { TaskboardErrorCode } from '@deepseek-ai/dsh-taskboard'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

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

/** Current Host default values shown when a nullable Patrol choice follows the Host. */
export interface TaskboardPatrolDefaultsValue {
  readonly baseBranch: string
  readonly agentPreset: string
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string | null
  readonly permissionPreset: string
}

/** One selectable Agent Preset. */
export interface TaskboardPatrolAgentPresetOption {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** One selectable reasoning effort. */
export interface TaskboardPatrolReasoningOption {
  readonly id: string
  readonly name: string
}

/** One selectable model. */
export interface TaskboardPatrolModelOption {
  readonly id: string
  readonly name: string
  readonly reasoning: readonly TaskboardPatrolReasoningOption[]
}

/** One selectable provider route. */
export interface TaskboardPatrolProviderOption {
  readonly id: string
  readonly name: string
  readonly models: readonly TaskboardPatrolModelOption[]
}

/** One selectable Permission Preset. */
export interface TaskboardPatrolPermissionOption {
  readonly id: string
  readonly name: string
  readonly description?: string
}

/** One Run with its durable claim history. */
export interface TaskboardPatrolRunValue {
  readonly run: PatrolRun
  readonly attempts: readonly PatrolAttempt[]
}

/** Complete Patrol settings and permanent Workspace Run history. */
export interface TaskboardPatrolValue {
  readonly policy: PatrolPolicy
  readonly defaults: TaskboardPatrolDefaultsValue
  readonly branches: readonly string[]
  readonly agentPresets: readonly TaskboardPatrolAgentPresetOption[]
  readonly providers: readonly TaskboardPatrolProviderOption[]
  readonly permissionPresets: readonly TaskboardPatrolPermissionOption[]
  readonly runs: readonly TaskboardPatrolRunValue[]
}

/** Manual Patrol trigger with an optional exact todo Issue. */
export interface TaskboardPatrolTriggerInput {
  readonly workspaceId: WorkspaceId
  readonly issue?: IssueReference
}

/** Persistent Session/Git binding and independent review evidence for one Issue. */
export interface TaskboardPatrolIssueValue {
  readonly context: PatrolDevelopmentContext | null
  readonly reviews: readonly PatrolReview[]
}
