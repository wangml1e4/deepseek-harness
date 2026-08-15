# Taskboard

English | [中文](taskboard.zh.md)

The Taskboard subsystem records durable work owned by a registered Workspace. [`@deepseek-ai/dsh-taskboard`](../../packages/taskboard/taskboard) declares `ctx.taskboard`; [`@deepseek-ai/dsh-taskboard-sqlite`](../../packages/taskboard/taskboard-sqlite) stores every Workspace partition in one Host-owned database outside user repositories. The [Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md) owns the product rationale and staged delivery.

## Values and identity

Each Workspace has one implicit `WorkspaceTaskboard`. Its unique prefix and monotonically allocated number form a stable `IssueIdentifier`; moving an Issue does not rewrite that identifier. `IssueId`, `CommentId`, `ActivityId`, `RelationId`, and `TaskboardActorId` are branded opaque identities.

Every Issue has exactly one status: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, or `canceled`. Priority is `none`, `urgent`, `high`, `medium`, or `low`; it is metadata and never changes manual board order. Active lists exclude archived Issues by default.

`blocks` and `blocked_by` are Issue-relative views of one directed dependency whose source blocks its target. A relation remains within one Workspace and cannot be a self-loop, duplicate, or part of a directed cycle.

## Mutation and history rules

Every competing Issue mutation compares `expectedVersion` and increments the committed version. Status changes prepend an Issue to the destination column unless a Consumer supplies an explicit `sortOrder`; explicit order, never priority, controls later Patrol scans. Returning `in_review`, `blocked`, or `done` to `todo` requires a non-empty reason and appends that reason as a Comment in the same transaction.

Issue archiving is reversible. The service has no permanent Issue, Comment, or Activity deletion operation. Comments and Activity use independent append sequences, distinguish User, Patrol Agent, Reviewer, and System actors, and record field-level before/after values. Removing a dependency deletes the live edge but retains its prior value in Activity. Moving an Issue with a live dependency rejects because the edge must remain within one Workspace.

`TaskboardError.code` distinguishes missing records, version conflicts, frozen prefixes, invalid archive transitions, missing return reasons, and relation validation failures. Providers reject before commit and preserve the stable code.

## Consumers and storage

Consumers depend on the Service Definition rather than the SQLite provider. The provider enables foreign keys, stores reusable Workspace Labels through ordered Issue-label rows, uses a fixed application id and monotonic schema version, and rejects an unversioned populated file, a foreign application id, or an unsupported version during initialization. Its write transactions keep Issue versions, order, labels, required Comments, relations, and Activity consistent.

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
```

Source: [`packages/taskboard/taskboard/src/index.ts:63`](../../packages/taskboard/taskboard/src/index.ts)
<!-- END GENERATED cordis-surface -->
