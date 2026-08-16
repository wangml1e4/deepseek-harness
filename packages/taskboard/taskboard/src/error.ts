/** Stable Taskboard service failures. */

/** Error codes returned by current Taskboard mutations. */
export type TaskboardErrorCode =
  | 'workspace_not_found'
  | 'issue_not_found'
  | 'issue_not_archived'
  | 'issue_archived'
  | 'attachment_not_found'
  | 'attachment_too_large'
  | 'attachment_invalid'
  | 'attachment_confirmation_required'
  | 'attachment_storage_unavailable'
  | 'relation_self'
  | 'relation_exists'
  | 'relation_cross_workspace'
  | 'relation_cycle'
  | 'relation_not_found'
  | 'reason_required'
  | 'version_conflict'
  | 'prefix_frozen'
  | 'invalid_prefix'
  | 'prefix_exists'
  | 'patrol_busy'
  | 'patrol_not_due'
  | 'patrol_run_not_active'
  | 'patrol_attempt_not_active'
  | 'patrol_issue_ineligible'
  | 'patrol_context_exists'
  | 'patrol_context_missing'
  | 'patrol_worktree_confirmation_required'
  | 'patrol_worktree_missing'
  | 'patrol_worktree_not_clean'
  | 'patrol_worktree_not_integrated'
  | 'patrol_review_exists'
  | 'patrol_policy_invalid'

/** Taskboard failure with a machine-readable code. */
export class TaskboardError extends Error {
  /**
   * @param code - Stable failure category.
   * @param message - Human-readable explanation.
   */
  constructor(readonly code: TaskboardErrorCode, message: string) {
    super(message)
    this.name = 'TaskboardError'
  }
}
