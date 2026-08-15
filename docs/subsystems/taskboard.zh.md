# Taskboard

[English](taskboard.md) | 中文

Taskboard 子系统记录注册 Workspace 所属的持久工作。[`@deepseek-ai/dsh-taskboard`](../../packages/taskboard/taskboard) 声明 `ctx.taskboard`；[`@deepseek-ai/dsh-taskboard-sqlite`](../../packages/taskboard/taskboard-sqlite) 在用户仓库之外的一份 Host 所属数据库中存储所有 Workspace 分区。[Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md)负责产品理由和分阶段交付。

## 值与标识

每个 Workspace 拥有一个隐式 `WorkspaceTaskboard`。其唯一前缀与单调分配的编号组成稳定的 `IssueIdentifier`；移动 Issue 不会改写该标识。`IssueId`、`CommentId`、`ActivityId`、`RelationId` 和 `TaskboardActorId` 都是品牌化的不透明标识。

每个 Issue 恰有一种状态：`backlog`、`todo`、`in_progress`、`in_review`、`blocked`、`done` 或 `canceled`。优先级是 `none`、`urgent`、`high`、`medium` 或 `low`；它只是元数据，绝不改变手动看板顺序。活跃列表默认排除已归档 Issue。

`blocks` 与 `blocked_by` 是同一条有向依赖相对于 Issue 的两种视图，该边的来源阻塞目标。关系必须保留在一个 Workspace 内，且不能是自环、重复边或有向环的一部分。

## 变更与历史规则

每项可能竞争的 Issue 变更都会比较 `expectedVersion`，并递增提交后的版本。状态变更默认将 Issue 前置到目标列，除非消费方提供显式 `sortOrder`；显式顺序而非优先级决定后续 Patrol 扫描。将 `in_review`、`blocked` 或 `done` 退回 `todo` 时必须提供非空原因，并在同一事务中将原因追加为评论。

Issue 归档可逆。服务不提供永久删除 Issue、评论或活动记录的操作。评论与活动记录使用独立追加序列，区分用户、Patrol Agent、Reviewer 与系统操作者，并记录字段级 before/after 值。解除依赖会删除活动边，但会在活动记录中保留此前的值。带有当前依赖的 Issue 不能跨 Workspace 移动，因为依赖边必须保留在同一个 Workspace 内。

`TaskboardError.code` 可区分记录缺失、版本冲突、前缀冻结、无效归档转换、退回原因缺失和关系校验失败。提供方会在提交前拒绝操作并保留稳定错误码。

## 消费方与存储

消费方依赖 Service Definition，而非 SQLite 提供方。提供方启用外键，通过有序 Issue-label 行存储可复用的 Workspace 标签，使用固定 application id 和单调 schema 版本，并在初始化时拒绝存在内容但未标版本的文件、外来 application id 或不受支持的版本。其写事务使 Issue 版本、顺序、标签、必需评论、关系和活动记录保持一致。

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
