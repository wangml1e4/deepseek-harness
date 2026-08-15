/** Taskboard-owned opaque identifiers. @module @deepseek-ai/dsh-taskboard/brand */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable opaque identity of one Issue. */
export type IssueId = Branded<'IssueId'>

/** Stable human-readable Issue reference such as `HARNESS-12`. */
export type IssueIdentifier = Branded<'IssueIdentifier'>

/** Stable opaque identity of one append-only Comment. */
export type CommentId = Branded<'CommentId'>

/** Stable opaque identity of a Taskboard mutation actor. */
export type TaskboardActorId = Branded<'TaskboardActorId'>

/** Stable opaque identity of one append-only Activity entry. */
export type ActivityId = Branded<'ActivityId'>

/** Stable opaque identity of one Issue dependency relation. */
export type RelationId = Branded<'RelationId'>

/** Stable opaque identity of one durable Patrol trigger. */
export type PatrolRunId = Branded<'PatrolRunId'>

/** Stable opaque identity of one Issue claim inside a Patrol Run. */
export type PatrolAttemptId = Branded<'PatrolAttemptId'>

/**
 * Brand a string as an {@link IssueId}.
 * @param value - Raw opaque identity.
 * @returns the same string with the Issue id brand.
 */
export function IssueId(value: string): IssueId {
  return value as IssueId
}

/**
 * Brand a string as an {@link IssueIdentifier}.
 * @param value - Raw human-readable identifier.
 * @returns the same string with the Issue identifier brand.
 */
export function IssueIdentifier(value: string): IssueIdentifier {
  return value as IssueIdentifier
}

/**
 * Brand a string as a {@link CommentId}.
 * @param value - Raw opaque identity.
 * @returns the same string with the Comment id brand.
 */
export function CommentId(value: string): CommentId {
  return value as CommentId
}

/**
 * Brand a string as a {@link TaskboardActorId}.
 * @param value - Raw actor identity.
 * @returns the same string with the Taskboard actor id brand.
 */
export function TaskboardActorId(value: string): TaskboardActorId {
  return value as TaskboardActorId
}

/**
 * Brand a string as an {@link ActivityId}.
 * @param value - Raw opaque identity.
 * @returns the same string with the Activity id brand.
 */
export function ActivityId(value: string): ActivityId {
  return value as ActivityId
}

/**
 * Brand a string as a {@link RelationId}.
 * @param value - Raw opaque identity.
 * @returns the same string with the relation id brand.
 */
export function RelationId(value: string): RelationId {
  return value as RelationId
}

/**
 * Brand a string as a {@link PatrolRunId}.
 * @param value - Raw opaque identity.
 * @returns the same string with the Patrol Run id brand.
 */
export function PatrolRunId(value: string): PatrolRunId {
  return value as PatrolRunId
}

/**
 * Brand a string as a {@link PatrolAttemptId}.
 * @param value - Raw opaque identity.
 * @returns the same string with the Patrol Attempt id brand.
 */
export function PatrolAttemptId(value: string): PatrolAttemptId {
  return value as PatrolAttemptId
}
