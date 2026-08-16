# Taskboard

English | [中文](taskboard.zh.md)

The Taskboard subsystem records durable work owned by a registered Workspace. [`@deepseek-ai/dsh-taskboard`](../../packages/taskboard/taskboard) declares `ctx.taskboard`; [`@deepseek-ai/dsh-taskboard-sqlite`](../../packages/taskboard/taskboard-sqlite) stores every Workspace partition in one Host-owned database outside user repositories. The [Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md) owns the product rationale and staged delivery.

## Values and identity

Each Workspace has one implicit `WorkspaceTaskboard`. Its unique prefix and monotonically allocated number form a stable `IssueIdentifier`; moving an Issue does not rewrite that identifier. `IssueId`, `TaskboardAttachmentId`, `CommentId`, `ActivityId`, `RelationId`, `PatrolRunId`, `PatrolAttemptId`, and `TaskboardActorId` are branded opaque identities.

Every Issue has exactly one status: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, or `canceled`. Priority is `none`, `urgent`, `high`, `medium`, or `low`; it is metadata and never changes manual board order. Active lists exclude archived Issues by default.

`blocks` and `blocked_by` are Issue-relative views of one directed dependency whose source blocks its target. A relation remains within one Workspace and cannot be a self-loop, duplicate, or part of a directed cycle.

## Mutation and history rules

Every competing Issue mutation compares `expectedVersion` and increments the committed version. Status changes prepend an Issue to the destination column unless a Consumer supplies an explicit `sortOrder`; explicit order, never priority, controls later Patrol scans. Returning `in_review`, `blocked`, or `done` to `todo` requires a non-empty reason and appends that reason as a Comment in the same transaction.

Issue archiving is reversible. The service has no permanent Issue, Comment, or Activity deletion operation. Comments and Activity use independent append sequences, distinguish User, Patrol Agent, Reviewer, and System actors, and record field-level before/after values. Removing a dependency deletes the live edge but retains its prior value in Activity. Moving an Issue with a live dependency rejects because the edge must remain within one Workspace.

Attachment upload accepts unrestricted file types up to 25 MB, advances the owning Issue version, and records Activity. Metadata lists omit bytes and storage paths; content reads require both the owning Issue and opaque attachment id. Attachment deletion is the only permanent Taskboard deletion in version one and rejects unless the caller explicitly confirms it with the current Issue version.

`TaskboardError.code` distinguishes missing records, version conflicts, frozen prefixes, invalid archive transitions, missing return reasons, and relation validation failures. Providers reject before commit and preserve the stable code.

## Patrol scheduling state

Each Taskboard creates one `PatrolPolicy` with fixed-interval scheduling disabled, `1h` selected, the Host default Agent and model choices, and the `workspace-write` Permission Preset. The supported interval vocabulary is exactly `5m`, `30m`, `1h`, `2h`, `6h`, `12h`, and `24h`. Enabling requires a local Base Branch. Enabling or changing the interval calculates `nextDueAt` from the save instant; disabling clears it without changing an active Run.

A scheduled trigger consumes its prior due instant and advances by fixed cadence to the first point after the current time. An overdue Host restart therefore produces one trigger rather than replaying every elapsed interval. A manual trigger does not enable the saved policy and may start while it is disabled.

Patrol Run reservation is Host-wide and durable. One active row excludes every other active row across Workspaces. Scheduled overlap persists a completed `skipped_global_busy` result and advances that Workspace's cadence without queueing; manual overlap rejects. Terminal Run results cannot be overwritten and no Run deletion operation exists.

Each terminal Attempt retains the Provider-reported usage collected across its implementation, independent review, correction, and recovery turns. Recovery rebuilds pre-crash accounting from the exact persisted implementation Session and any recorded Reviewer Session, excluding implementation events older than the Attempt. A Provider failure keeps its structured message, code, HTTP status, retry delay, and request id when supplied; non-Provider failures remain separate error text. Run completion aggregates all Attempt usage and retains the latest Provider error in permanent history.

Before scheduling any new due trigger, Host startup finds the active Run without relying on Workspace enumeration and appends recovery evidence by incrementing `recoveryCount` and saving `lastRecoveredAt`. A completed Attempt checkpoint is reconciled directly; a permission-blocked checkpoint resumes scanning under the same Run.

## Patrol claims and execution identity

A Run owns an ordered sequence of permanent `PatrolAttempt` records. An atomic claim verifies the active Run, exact Issue version, `todo` status, non-User assignment, and every blocking Issue's completed result commit before moving the Issue to `in_progress`. A Run may claim again only after its preceding Attempt ended as `permission_blocked`; every other terminal Attempt ends its claim allowance.

Each Patrol-owned Issue has at most one permanent `PatrolDevelopmentContext`. It fixes the exact Session id, Base Branch, dedicated local `dsh-task/<issue>` branch, persistent worktree, Agent Preset, model selection, reasoning effort, and Permission Preset across every later return to `todo`. The provider distinguishes a reserved Session id from a Session that has been persisted: failure before first persistence may retry the same id, while a started but missing Session cannot be replaced. Review handoff requires a result commit and moves the Issue to `in_review`; a permission block or other execution failure moves it to `blocked` and appends the reason.

One active Attempt accepts one permanent `PatrolReview` from a distinct Reviewer Session. It records the reviewed preliminary commit, verdict, findings, verification evidence, risks, and completion time before the implementation Session performs its correction turn. A second review for the same Attempt rejects.

`@deepseek-ai/dsh-taskboard-patrol` schedules enabled Policies from durable due instants and scans only `todo` Issues in manual order. It skips User assignments, explicit waits, and dependencies without a `done` result commit integrated into the Issue's fixed Base Branch. One reviewed handoff to `in_review` ends the Run; only an Attempt blocked by a rejected tool approval may continue scanning. Other failures block the claimed Issue and end the Run.

The Patrol Consumer uses the managed subprocess service for a fixed local-only Git command set, never runs fetch, pull, push, PR, merge, reset, branch deletion, or automatic worktree removal, and preserves the Workspace-relative Session directory inside the Issue worktree. A confirmed manual removal rejects unless the exact physical worktree is clean and its recorded result commit is integrated into Base Branch; it preserves the branch, Session binding, Development Context, and history. Patrol resumes the exact Session, mounts the saved Agent and Permission Presets, and rejects unattended approvals. The implementation Agent must leave a clean committed change. A separate persistent Reviewer Session receives the bounded committed diff, exposes only its structured submission tool, and uses fixed read-only sandboxing with approval policy `never`; the original Session receives its durable findings for one correction turn before human review.

An interrupted active Attempt can recover only through its stored Development Context. Recovery reopens the exact Session and worktree, reuses Reviewer evidence already stored for that Attempt, and otherwise asks the implementation Session to inspect its prior transcript and current branch before continuing. A missing or mismatched Context, Session, or worktree atomically ends the Attempt and Run as failed, moves the Issue to `blocked`, appends the reason, and never creates a replacement Session.

## Consumers and storage

Consumers depend on the Service Definition rather than the SQLite provider. The provider enables foreign keys, stores reusable Workspace Labels through ordered Issue-label rows, uses a fixed application id and monotonic schema version, and rejects an unversioned populated file, a foreign application id, or an unsupported version during initialization. Its write transactions keep Issue versions, order, labels, required Comments, relations, attachment metadata, and Activity consistent. Attachment bytes use opaque ids as owner-only filenames in an adjacent managed directory and never enter a Workspace repository.

`@deepseek-ai/dsh-taskboard-remote` exposes the Service under the Typert `taskboard` namespace and validates Workspace identities against `ctx.workspaceRegistry`. Its Workspace Activity read returns newest-first Activity for active Issues without reloading each Issue independently, and its sidebar projection derives the current `todo` count without returning Issue records. Human-review evidence includes the bounded committed diff from the fixed Base Branch to the result commit. It also registers the `taskboard-issues` Workspace deletion guard: active and archived Issues keep the registration unchanged until every Issue moves to another Workspace. Issue creation and movement into a Workspace share the registry mutation queue with deletion, so guards cannot miss a concurrent Taskboard write. Domain failures remain typed business results while carrier validation and infrastructure failures remain distinct. The browser API assembly mounts its generated Client contribution.

`@deepseek-ai/dsh-taskctl` is a JSON CLI over that Remote. `@deepseek-ai/dsh-skill-manage-taskboard` registers a bundled model- and user-invocable workflow that requires Agents to read current Issue context, claim only `todo`, use optimistic versions, review and commit before moving work to `in_review`, and leave `done` to human acceptance. The standard Web Host mounts the Provider, Remote, and skill together.

The Web Consumer exposes bilingual Dashboard, Board, List, Gantt, Issue details, attachment upload, image preview, controlled download and confirmed deletion, Patrol settings and history, Development Context and review evidence, confirmed physical-worktree removal, and human acceptance or return actions. Each Workspace row shows its live `todo` count, a bound implementation Session returns to the ordinary conversation view, and human review displays the committed Base Branch diff. Dashboard derives completion, lifecycle counts, overdue work, work due within 14 days, and the five newest Workspace Activity entries, then links every summary to its filtered List. Gantt reads every Workspace dependency once in canonical `blocks` direction, keeps unscheduled Issues in the grid, and persists manual bar changes without shifting dependents. Patrol settings reuse the details column, discover local branches, Agent Presets, provider/model/reasoning choices, and Permission Presets from the Host, and show Run recovery evidence, aggregated token usage, and structured Provider diagnostics. Version one does not publish or synchronize GitHub Issues, including Issues in `deepseek-ai/deepseek-harness`.

## Post-version-one GitHub plan

Later work may add an explicit, opt-in repository binding; a user-owned publish action that creates one mapped GitHub Issue with durable provenance; conflict-aware import and metadata synchronization; and separately authorized Draft pull-request publication from a Patrol result commit. Each phase requires its own credential, permission, error, and audit design. None may auto-publish from Patrol or auto-merge code.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxtaskboard--taskboardservice-abstract-seam"></a>

### `ctx.taskboard` — `TaskboardService` (abstract seam)

Durable Workspace Taskboard service implemented by a configured Provider.

```ts cordis-catalog
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
 * List Activity for active Issues currently owned by one Workspace, newest first.
 * @param workspaceId - Workspace whose Dashboard consumes the activity.
 * @returns append-only Issue changes in reverse chronological order.
 */
abstract listWorkspaceActivities(workspaceId: WorkspaceId): Promise<readonly Activity[]>

/**
 * Store one attachment and its metadata while advancing the owning Issue version.
 * @param input - File bytes, metadata, optimistic version, and actor.
 * @returns the updated Issue and stored attachment metadata.
 */
abstract addAttachment(input: AddAttachmentInput): Promise<TaskboardAttachmentMutation>

/**
 * List one Issue's attachments in upload order.
 * @param reference - Stable Issue lookup.
 * @returns durable attachment metadata without file bytes.
 */
abstract listAttachments(reference: IssueReference): Promise<readonly TaskboardAttachment[]>

/**
 * Read one attachment through its owning Issue.
 * @param input - Issue and attachment identities.
 * @returns durable metadata and exact stored bytes.
 */
abstract readAttachment(input: ReadAttachmentInput): Promise<TaskboardAttachmentContent>

/**
 * Permanently delete one explicitly confirmed attachment while retaining Activity history.
 * @param input - attachment identity, optimistic Issue version, confirmation, and actor.
 * @returns the updated owning Issue.
 */
abstract deleteAttachment(input: DeleteAttachmentInput): Promise<Issue>

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

/**
 * Read one Workspace's durable Patrol Policy.
 * @param workspaceId - Workspace whose policy is requested.
 * @returns the policy created with the Taskboard, or undefined when the Taskboard is absent.
 */
abstract getPatrolPolicy( workspaceId: EnsureWorkspaceInput['workspaceId'], ): Promise<PatrolPolicy | undefined>

/**
 * Save Patrol enablement or interval and recalculate its next trigger.
 * @param input - Workspace, replacements, and caller-observed policy version.
 * @returns the updated durable policy.
 */
abstract updatePatrolPolicy(input: UpdatePatrolPolicyInput): Promise<PatrolPolicy>

/**
 * List enabled Patrol Policies whose next trigger has arrived.
 * @returns due policies ordered by due instant and Workspace id.
 */
abstract listDuePatrolPolicies(): Promise<readonly PatrolPolicy[]>

/**
 * Persist one trigger, atomically consuming a scheduled due instant and enforcing Host-wide exclusivity.
 * @param input - Workspace and trigger origin.
 * @returns an active Run, or a completed scheduled overlap record.
 */
abstract beginPatrolRun(input: BeginPatrolRunInput): Promise<PatrolRun>

/**
 * Complete one active Patrol Run exactly once.
 * @param input - Run identity and terminal result.
 * @returns the completed durable Run.
 */
abstract completePatrolRun(input: CompletePatrolRunInput): Promise<PatrolRun>

/**
 * List permanent Patrol Run history for one Workspace, newest first.
 * @param workspaceId - Workspace whose Run history is requested.
 * @returns every active and completed Run.
 */
abstract listPatrolRuns( workspaceId: EnsureWorkspaceInput['workspaceId'], ): Promise<readonly PatrolRun[]>

/**
 * Read the Host-wide unfinished Patrol Run, if one exists.
 * @returns the active Run independently of Workspace registration.
 */
abstract getActivePatrolRun(): Promise<PatrolRun | undefined>

/**
 * Append one startup recovery attempt to an active Run's audit fields.
 * @param runId - active Run being resumed.
 * @returns the active Run with its incremented recovery evidence.
 */
abstract recordPatrolRecovery(runId: PatrolRunId): Promise<PatrolRun>

/**
 * Atomically fail an unrecoverable Run and Attempt and move its Issue to blocked.
 * @param input - exact active identities, durable reason, and Patrol actor.
 * @returns the completed Run.
 */
abstract failPatrolRecovery(input: FailPatrolRecoveryInput): Promise<PatrolRun>

/**
 * Atomically claim one todo Issue for an active Run after matching dependency commit snapshots.
 * @param input - Run, Issue version, dependency evidence, and Patrol actor.
 * @returns the durable active Attempt.
 */
abstract claimPatrolIssue(input: ClaimPatrolIssueInput): Promise<PatrolAttempt>

/**
 * Bind a newly claimed Issue to the exact Session, branch, and worktree it will always resume.
 * @param input - Active Attempt and complete creation-time execution choices.
 * @returns the immutable Issue Development Context.
 */
abstract bindPatrolDevelopmentContext( input: BindPatrolDevelopmentContextInput, ): Promise<PatrolDevelopmentContext>

/**
 * Read one Issue's persistent Session and Git binding.
 * @param reference - Stable Issue lookup.
 * @returns its Development Context, or undefined before binding.
 */
abstract getPatrolDevelopmentContext( reference: IssueReference, ): Promise<PatrolDevelopmentContext | undefined>

/**
 * Record that one bound Session has been persisted and must only be resumed afterward.
 * @param attemptId - Active Attempt using the bound Session.
 * @returns the updated Development Context.
 */
abstract markPatrolSessionStarted(attemptId: PatrolAttempt['id']): Promise<PatrolDevelopmentContext>

/**
 * Complete one active Attempt and atomically move its Issue to blocked or in_review.
 * @param input - Attempt result, evidence, and responsible actor.
 * @returns the terminal durable Attempt.
 */
abstract completePatrolAttempt(input: CompletePatrolAttemptInput): Promise<PatrolAttempt>

/**
 * Persist one independent Reviewer result for an active Attempt.
 * @param input - Reviewer Session, preliminary commit, findings, verification, and risks.
 * @returns durable structured review evidence.
 */
abstract recordPatrolReview(input: RecordPatrolReviewInput): Promise<PatrolReview>

/**
 * List every independent review retained for one Issue.
 * @param reference - Issue whose review history is requested.
 * @returns review evidence in completion order.
 */
abstract listPatrolReviews(reference: IssueReference): Promise<readonly PatrolReview[]>

/**
 * List every Issue claim in one Run in claim order.
 * @param runId - Run whose Attempt history is requested.
 * @returns active and terminal Attempts in claim order.
 */
abstract listPatrolAttempts(runId: PatrolRunId): Promise<readonly PatrolAttempt[]>
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/taskboard/taskboard/src/index.ts:133`](../../packages/taskboard/taskboard/src/index.ts)

<a id="ctxtaskboardpatrol--taskboardpatrolservice"></a>

### `ctx.taskboardPatrol` — `TaskboardPatrolService`

Host Consumer that binds Patrol claims to local Git isolation and ordinary persistent Agents.

```ts cordis-catalog
/**
 * Resolve the current new-Session defaults and checked-out local branch for a Workspace.
 * @param workspaceId - Registered Workspace whose checkout supplies the branch.
 * @returns concrete values suitable for a Patrol Policy save.
 */
async defaults(workspaceId: WorkspaceId): Promise<PatrolPolicyDefaults>

/**
 * Discover all choices needed by the Patrol settings sidebar.
 * @param workspaceId - registered Workspace whose local branches are listed.
 * @returns current defaults and selectable Host configuration.
 */
async configuration(workspaceId: WorkspaceId): Promise<PatrolConfiguration>

/**
 * Validate Host-owned choices before saving one version-checked policy.
 * @param input - replacement policy fields.
 * @returns updated durable policy.
 */
async updatePolicy(input: UpdatePatrolPolicyInput): Promise<PatrolPolicy>

/**
 * List branches local to one registered Workspace repository.
 * @param workspaceId - Workspace whose repository is inspected.
 * @returns local branch names.
 */
localBranches(workspaceId: WorkspaceId): Promise<readonly string[]>

/**
 * Check dependency integration against an exact local Base Branch.
 * @param workspaceId - Workspace whose repository is inspected.
 * @param commit - predecessor result commit.
 * @param baseBranch - local branch the successor will start from.
 * @returns whether the commit is an ancestor of the branch.
 */
isAncestor(workspaceId: WorkspaceId, commit: string, baseBranch: string): Promise<boolean>

/**
 * Create or reuse one claim's permanent Development Context, worktree, and exact Session.
 * @param attempt - active durable claim.
 * @param issue - claimed Issue snapshot.
 * @param policy - saved Workspace Patrol choices for an unbound Issue.
 * @returns a live guarded Agent lease.
 */
async prepare( attempt: PatrolAttempt, issue: Issue, policy: PatrolPolicy, ): Promise<PatrolAgentLease>

/**
 * Read commit, cleanliness, and Base Branch diff evidence from a bound Issue worktree.
 * @param context - persistent Development Context.
 * @returns current local Git evidence.
 */
result(context: PatrolDevelopmentContext): Promise<PatrolGitResult>

/**
 * Read one exact committed diff for an independent Reviewer.
 * @param context - persistent Development Context.
 * @param commit - exact preliminary implementation commit.
 * @returns bounded patch and summary.
 */
diff(context: PatrolDevelopmentContext, commit: string): Promise<PatrolGitDiff>

/**
 * Read whether one recorded physical Issue worktree is currently present.
 * @param context - persistent Development Context.
 * @returns true only for the exact physical directory.
 */
worktreePresent(context: PatrolDevelopmentContext): Promise<boolean>

/**
 * Remove one exact physical Issue worktree while preserving its branch and durable binding.
 * @param input - Workspace, Issue lookup, and explicit confirmation.
 * @returns preserved branch, path, and result-commit identities; rejects unless the worktree is
 * clean and its result commit is integrated.
 */
async removeWorktree(input: RemovePatrolWorktreeInput): Promise<PatrolWorktreeRemoval>

/**
 * Start one manual background Run under Host-wide exclusivity.
 * @param input - Workspace and optional exact todo Issue.
 * @returns active durable Run accepted by the Taskboard Provider.
 */
trigger(input: TriggerPatrolRunInput): Promise<PatrolRun>
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/taskboard/taskboard-patrol/src/index.ts:190`](../../packages/taskboard/taskboard-patrol/src/index.ts)

<a id="ctxtaskboardremote--taskboardremote"></a>

### `ctx.taskboardRemote` — `TaskboardRemote`

Host Remote adapter that keeps Workspace identity authoritative.

```ts cordis-catalog
/**
 * Ensure and read the implicit Taskboard for one registered Workspace.
 * @param workspaceId - Authoritative Workspace identity.
 * @returns Taskboard metadata or a stable business failure.
 */
@Remote('workspace') workspace(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<WorkspaceTaskboard>>

/**
 * Change a Taskboard prefix before its first Issue.
 * @param input - Prefix mutation with optimistic version.
 * @returns updated Taskboard metadata or a stable business failure.
 */
@Remote('setPrefix') setPrefix(input: SetWorkspacePrefixInput): Promise<TaskboardRemoteResult<WorkspaceTaskboard>>

/**
 * List Issues in one registered Workspace.
 * @param input - Workspace and filters.
 * @returns ordered Issues or a stable business failure.
 */
@Remote('listIssues') listIssues(input: ListIssuesInput): Promise<TaskboardRemoteResult<TaskboardIssueListValue>>

/**
 * Count current todo Issues for one registered Workspace sidebar row.
 * @param workspaceId - Workspace whose manual Patrol queue is summarized.
 * @returns current derived count or a stable business failure.
 */
@Remote('todoCount') todoCount(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<TaskboardTodoCountValue>>

/**
 * Look up one Issue.
 * @param reference - Opaque id or human-readable identifier.
 * @returns explicit nullable Issue result.
 */
@Remote('getIssue') getIssue(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardIssueValue>>

/**
 * Create an Issue in one registered Workspace.
 * @param input - Issue fields.
 * @returns created Issue or a stable business failure.
 */
@Remote('createIssue') createIssue(input: CreateIssueInput): Promise<TaskboardRemoteResult<Issue>>

/**
 * Update or reorder an Issue using optimistic concurrency.
 * @param input - Issue mutation.
 * @returns updated Issue or a stable business failure.
 */
@Remote('updateIssue') updateIssue(input: UpdateIssueInput): Promise<TaskboardRemoteResult<Issue>>

/**
 * Move an Issue to another registered Workspace.
 * @param input - destination and optimistic version.
 * @returns moved Issue or a stable business failure.
 */
@Remote('moveIssue') moveIssue(input: MoveIssueInput): Promise<TaskboardRemoteResult<Issue>>

/**
 * Archive an Issue without deleting it.
 * @param input - Issue reference, observed version, and actor.
 * @returns archived Issue or a stable business failure.
 */
@Remote('archiveIssue') archiveIssue(input: VersionedIssueInput): Promise<TaskboardRemoteResult<Issue>>

/**
 * Restore one archived Issue.
 * @param input - Issue reference, observed version, and actor.
 * @returns restored Issue or a stable business failure.
 */
@Remote('restoreIssue') restoreIssue(input: VersionedIssueInput): Promise<TaskboardRemoteResult<Issue>>

/**
 * List one Issue's Comments.
 * @param reference - Opaque id or human-readable identifier.
 * @returns ordered Comments or a stable business failure.
 */
@Remote('listComments') listComments(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardCommentListValue>>

/**
 * Append one attributed Comment.
 * @param input - Issue reference, body, and author.
 * @returns appended Comment or a stable business failure.
 */
@Remote('addComment') addComment(input: AddCommentInput): Promise<TaskboardRemoteResult<Comment>>

/**
 * List one Issue's attachment metadata without exposing Host paths.
 * @param reference - opaque id or human-readable identifier.
 * @returns ordered metadata or a stable business failure.
 */
@Remote('listAttachments') listAttachments(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardAttachmentListValue>>

/**
 * Decode and store one browser attachment through the Taskboard Service.
 * @param input - metadata, canonical base64 bytes, optimistic version, and actor.
 * @returns updated Issue and attachment metadata or a stable business failure.
 */
@Remote('addAttachment') addAttachment(input: TaskboardAttachmentUploadInput): Promise<TaskboardRemoteResult<TaskboardAttachmentMutation>>

/**
 * Read one Issue-scoped attachment without exposing its Host storage path.
 * @param input - owning Issue and attachment identities.
 * @returns metadata and canonical base64 bytes or a stable business failure.
 */
@Remote('readAttachment') readAttachment(input: TaskboardAttachmentReadInput): Promise<TaskboardRemoteResult<TaskboardAttachmentContentValue>>

/**
 * Permanently remove one attachment only after explicit confirmation.
 * @param input - attachment identity, confirmation, optimistic version, and actor.
 * @returns updated owning Issue or a stable business failure.
 */
@Remote('deleteAttachment') deleteAttachment(input: DeleteAttachmentInput): Promise<TaskboardRemoteResult<Issue>>

/**
 * List one Issue's append-only Activity.
 * @param reference - Opaque id or human-readable identifier.
 * @returns ordered Activity or a stable business failure.
 */
@Remote('listActivities') listActivities(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardActivityListValue>>

/**
 * List recent Activity for active Issues in one registered Workspace.
 * @param workspaceId - Workspace whose Dashboard consumes the Activity.
 * @returns newest-first Activity or a stable business failure.
 */
@Remote('listWorkspaceActivities') listWorkspaceActivities(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<TaskboardActivityListValue>>

/**
 * List one registered Workspace's canonical dependency records.
 * @param workspaceId - Authoritative Workspace identity.
 * @returns ordered `blocks` relation views or a stable business failure.
 */
@Remote('listWorkspaceRelations') listWorkspaceRelations(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<TaskboardRelationListValue>>

/**
 * List one Issue's dependency views.
 * @param reference - Opaque id or human-readable identifier.
 * @returns ordered relation views or a stable business failure.
 */
@Remote('listRelations') listRelations(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardRelationListValue>>

/**
 * Add one directed Issue dependency.
 * @param input - Anchor, related Issue, direction, version, and actor.
 * @returns relation mutation or a stable business failure.
 */
@Remote('addRelation') addRelation(input: AddIssueRelationInput): Promise<TaskboardRemoteResult<IssueRelationMutation>>

/**
 * Remove one Issue dependency without deleting its Activity.
 * @param input - Anchor, relation id, observed version, and actor.
 * @returns updated Issue or a stable business failure.
 */
@Remote('removeRelation') removeRelation(input: RemoveIssueRelationInput): Promise<TaskboardRemoteResult<Issue>>

/**
 * Read Patrol settings choices and permanent Run history for one Workspace.
 * @param workspaceId - authoritative Workspace identity.
 * @returns current policy, Host choices, and Run/Attempt history.
 */
@Remote('patrol') patrol(workspaceId: WorkspaceId): Promise<TaskboardRemoteResult<TaskboardPatrolValue>>

/**
 * Validate and save one Patrol Policy version.
 * @param input - Workspace policy replacements and optimistic version.
 * @returns updated durable policy.
 */
@Remote('updatePatrol') updatePatrol(input: UpdatePatrolPolicyInput): Promise<TaskboardRemoteResult<PatrolPolicy>>

/**
 * Start one manual background Patrol Run.
 * @param input - Workspace and optional exact todo Issue.
 * @returns accepted active Run.
 */
@Remote('runPatrol') runPatrol(input: TaskboardPatrolTriggerInput): Promise<TaskboardRemoteResult<PatrolRun>>

/**
 * Read one Issue's persistent implementation binding and Reviewer evidence.
 * @param reference - opaque id or human-readable identifier.
 * @returns explicit nullable binding and append-only reviews.
 */
@Remote('patrolIssue') patrolIssue(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardPatrolIssueValue>>

/**
 * Remove one explicitly confirmed, clean, integrated Issue worktree.
 * @param input - Workspace, Issue lookup, and confirmation.
 * @returns preserved Development Context identities.
 */
@Remote('removePatrolWorktree') removePatrolWorktree( input: TaskboardPatrolWorktreeRemovalInput, ): Promise<TaskboardRemoteResult<TaskboardPatrolWorktreeRemovalValue>>
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/taskboard/taskboard-remote/src/index.ts:61`](../../packages/taskboard/taskboard-remote/src/index.ts)

<a id="taskboard-events"></a>

### `taskboard/*` events

<a id="taskboardchanged--emit"></a>

#### `taskboard/changed` — emit

A durable Taskboard mutation committed for one Workspace. Observer failures are contained and cannot veto the committed mutation.

```ts cordis-catalog
/**
 * A durable Taskboard mutation committed for one Workspace. Observer
 * failures are contained and cannot veto the committed mutation.
 * @mode emit
 * @param workspaceId - Workspace whose Taskboard projection changed.
 */
'taskboard/changed'(workspaceId: WorkspaceId): void
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/taskboard/taskboard/src/types.ts:674`](../../packages/taskboard/taskboard/src/types.ts)
<!-- END GENERATED cordis-surface -->
