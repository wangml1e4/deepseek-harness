# Taskboard

English | [中文](taskboard.zh.md)

The Taskboard subsystem records durable work owned by a registered Workspace. [`@deepseek-ai/dsh-taskboard`](../../packages/taskboard/taskboard) declares `ctx.taskboard`; [`@deepseek-ai/dsh-taskboard-sqlite`](../../packages/taskboard/taskboard-sqlite) stores every Workspace partition in one Host-owned database outside user repositories. The [Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md) owns the product rationale and staged delivery.

## Values and identity

Each Workspace has one implicit `WorkspaceTaskboard`. Its unique prefix and monotonically allocated number form a stable `IssueIdentifier`; moving an Issue does not rewrite that identifier. `IssueId`, `CommentId`, `ActivityId`, `RelationId`, `PatrolRunId`, and `TaskboardActorId` are branded opaque identities.

Every Issue has exactly one status: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, or `canceled`. Priority is `none`, `urgent`, `high`, `medium`, or `low`; it is metadata and never changes manual board order. Active lists exclude archived Issues by default.

`blocks` and `blocked_by` are Issue-relative views of one directed dependency whose source blocks its target. A relation remains within one Workspace and cannot be a self-loop, duplicate, or part of a directed cycle.

## Mutation and history rules

Every competing Issue mutation compares `expectedVersion` and increments the committed version. Status changes prepend an Issue to the destination column unless a Consumer supplies an explicit `sortOrder`; explicit order, never priority, controls later Patrol scans. Returning `in_review`, `blocked`, or `done` to `todo` requires a non-empty reason and appends that reason as a Comment in the same transaction.

Issue archiving is reversible. The service has no permanent Issue, Comment, or Activity deletion operation. Comments and Activity use independent append sequences, distinguish User, Patrol Agent, Reviewer, and System actors, and record field-level before/after values. Removing a dependency deletes the live edge but retains its prior value in Activity. Moving an Issue with a live dependency rejects because the edge must remain within one Workspace.

`TaskboardError.code` distinguishes missing records, version conflicts, frozen prefixes, invalid archive transitions, missing return reasons, and relation validation failures. Providers reject before commit and preserve the stable code.

## Patrol scheduling state

Each Taskboard creates one `PatrolPolicy` with fixed-interval scheduling disabled and `1h` selected. The supported interval vocabulary is exactly `5m`, `30m`, `1h`, `2h`, `6h`, `12h`, and `24h`. Enabling or changing the interval calculates `nextDueAt` from the save instant; disabling clears it without changing an active Run.

A scheduled trigger consumes its prior due instant and advances by fixed cadence to the first point after the current time. An overdue Host restart therefore produces one trigger rather than replaying every elapsed interval. A manual trigger does not enable the saved policy and may start while it is disabled.

Patrol Run reservation is Host-wide and durable. One active row excludes every other active row across Workspaces. Scheduled overlap persists a completed `skipped_global_busy` result and advances that Workspace's cadence without queueing; manual overlap rejects. Terminal Run results cannot be overwritten and no Run deletion operation exists.

## Consumers and storage

Consumers depend on the Service Definition rather than the SQLite provider. The provider enables foreign keys, stores reusable Workspace Labels through ordered Issue-label rows, uses a fixed application id and monotonic schema version, and rejects an unversioned populated file, a foreign application id, or an unsupported version during initialization. Its write transactions keep Issue versions, order, labels, required Comments, relations, and Activity consistent.

`@deepseek-ai/dsh-taskboard-remote` exposes the Service under the Typert `taskboard` namespace and validates Workspace identities against `ctx.workspaceRegistry`. Domain failures remain typed business results while carrier validation and infrastructure failures remain distinct. The browser API assembly mounts its generated Client contribution.

`@deepseek-ai/dsh-taskctl` is a JSON CLI over that Remote. `@deepseek-ai/dsh-skill-manage-taskboard` registers a bundled model- and user-invocable workflow that requires Agents to read current Issue context, claim only `todo`, use optimistic versions, review and commit before moving work to `in_review`, and leave `done` to human acceptance. The standard Web Host mounts the Provider, Remote, and skill together.

The current Consumer layer exposes bilingual Web Dashboard, Board, List, Gantt, and Issue-detail surfaces and forwards `taskboard/changed` invalidations to the active Workspace. Gantt reads every Workspace dependency once in canonical `blocks` direction, keeps unscheduled Issues in the grid, and persists manual bar changes without shifting dependents. The Service and SQLite Provider now own Patrol scheduling state and permanent trigger history; the Host timer, execution Consumer, development-context bindings, and review evidence remain later layers of the ordered Taskboard PR stack. Version one does not publish or synchronize GitHub Issues.

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
```

Source: [`packages/taskboard/taskboard/src/index.ts:92`](../../packages/taskboard/taskboard/src/index.ts)

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
 * List one Issue's append-only Activity.
 * @param reference - Opaque id or human-readable identifier.
 * @returns ordered Activity or a stable business failure.
 */
@Remote('listActivities') listActivities(reference: IssueReference): Promise<TaskboardRemoteResult<TaskboardActivityListValue>>

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
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/taskboard/taskboard-remote/src/index.ts:44`](../../packages/taskboard/taskboard-remote/src/index.ts)

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

Source: [`packages/taskboard/taskboard/src/types.ts:403`](../../packages/taskboard/taskboard/src/types.ts)
<!-- END GENERATED cordis-surface -->
