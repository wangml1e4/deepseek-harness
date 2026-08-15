# Taskboard

[English](taskboard.md) | 中文

Taskboard 子系统记录注册 Workspace 所属的持久工作。[`@deepseek-ai/dsh-taskboard`](../../packages/taskboard/taskboard) 声明 `ctx.taskboard`；[`@deepseek-ai/dsh-taskboard-sqlite`](../../packages/taskboard/taskboard-sqlite) 在用户仓库之外的一份 Host 所属数据库中存储所有 Workspace 分区。[Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md)负责产品理由和分阶段交付。

## 值与标识

每个 Workspace 拥有一个隐式 `WorkspaceTaskboard`。其唯一前缀与单调分配的编号组成稳定的 `IssueIdentifier`；移动 Issue 不会改写该标识。`IssueId`、`CommentId`、`ActivityId`、`RelationId`、`PatrolRunId` 和 `TaskboardActorId` 都是品牌化的不透明标识。

每个 Issue 恰有一种状态：`backlog`、`todo`、`in_progress`、`in_review`、`blocked`、`done` 或 `canceled`。优先级是 `none`、`urgent`、`high`、`medium` 或 `low`；它只是元数据，绝不改变手动看板顺序。活跃列表默认排除已归档 Issue。

`blocks` 与 `blocked_by` 是同一条有向依赖相对于 Issue 的两种视图，该边的来源阻塞目标。关系必须保留在一个 Workspace 内，且不能是自环、重复边或有向环的一部分。

## 变更与历史规则

每项可能竞争的 Issue 变更都会比较 `expectedVersion`，并递增提交后的版本。状态变更默认将 Issue 前置到目标列，除非消费方提供显式 `sortOrder`；显式顺序而非优先级决定后续 Patrol 扫描。将 `in_review`、`blocked` 或 `done` 退回 `todo` 时必须提供非空原因，并在同一事务中将原因追加为评论。

Issue 归档可逆。服务不提供永久删除 Issue、评论或活动记录的操作。评论与活动记录使用独立追加序列，区分用户、Patrol Agent、Reviewer 与系统操作者，并记录字段级 before/after 值。解除依赖会删除活动边，但会在活动记录中保留此前的值。带有当前依赖的 Issue 不能跨 Workspace 移动，因为依赖边必须保留在同一个 Workspace 内。

`TaskboardError.code` 可区分记录缺失、版本冲突、前缀冻结、无效归档转换、退回原因缺失和关系校验失败。提供方会在提交前拒绝操作并保留稳定错误码。

## 巡检调度状态

每个 Taskboard 会创建一项 `PatrolPolicy`，固定间隔调度默认关闭并选中 `1h`。支持的间隔词汇严格限定为 `5m`、`30m`、`1h`、`2h`、`6h`、`12h` 和 `24h`。启用或修改间隔会从保存时刻计算 `nextDueAt`；关闭则清除该时间，但不改变活跃 Run。

定时触发会消费此前的到期时刻，并按固定节拍推进至当前时间之后的首个节点。因此 Host 重启后只产生一次过期触发，不会重放所有错过的间隔。手动触发不会启用已保存 Policy，即使调度关闭也可以启动。

Patrol Run 预留在整个 Host 范围内持久化。一个活跃行会排除所有 Workspace 的其他活跃行。定时触发重叠会持久化已完成的 `skipped_global_busy` 结果，并推进该 Workspace 的节拍而不排队；手动触发重叠会被拒绝。Run 的终态结果不能覆写，也不存在删除 Run 的操作。

## 消费方与存储

消费方依赖 Service Definition，而非 SQLite 提供方。提供方启用外键，通过有序 Issue-label 行存储可复用的 Workspace 标签，使用固定 application id 和单调 schema 版本，并在初始化时拒绝存在内容但未标版本的文件、外来 application id 或不受支持的版本。其写事务使 Issue 版本、顺序、标签、必需评论、关系和活动记录保持一致。

`@deepseek-ai/dsh-taskboard-remote` 在 Typert `taskboard` namespace 下暴露 Service，并针对 `ctx.workspaceRegistry` 校验 Workspace 身份。领域失败会保留为类型化业务结果，载体校验与基础设施失败仍保持独立。浏览器 API 组合会挂载它生成的 Client 贡献。

`@deepseek-ai/dsh-taskctl` 是该 Remote 之上的 JSON CLI。`@deepseek-ai/dsh-skill-manage-taskboard` 注册内置且允许模型与用户调用的工作流，要求 Agent 读取当前 Issue 上下文、只认领 `todo`、使用乐观版本、在把工作移至 `in_review` 前完成审查与 commit，并把 `done` 留给人工验收。标准 Web Host 会把 Provider、Remote 和 skill 一起挂载。

当前消费层提供双语 Web 仪表盘、看板、列表、甘特图和 Issue 详情界面，并把 `taskboard/changed` 失效通知转发给当前 Workspace。甘特图会以规范 `blocks` 方向一次读取全部 Workspace 依赖，在表格中保留未排期 Issue，并持久化手工条形变更而不移动依赖项。Service 与 SQLite Provider 现已持有巡检调度状态和永久触发历史；Host timer、执行消费方、开发上下文绑定和审查证据仍属于按顺序交付的 Taskboard PR stack 后续层。版本一不会发布或同步 GitHub Issue。

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
