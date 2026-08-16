# Taskboard

[English](taskboard.md) | 中文

Taskboard 子系统记录注册 Workspace 所属的持久工作。[`@deepseek-ai/dsh-taskboard`](../../packages/taskboard/taskboard) 声明 `ctx.taskboard`；[`@deepseek-ai/dsh-taskboard-sqlite`](../../packages/taskboard/taskboard-sqlite) 在用户仓库之外的一份 Host 所属数据库中存储所有 Workspace 分区。[Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md)负责产品理由和分阶段交付。

## 值与标识

每个 Workspace 拥有一个隐式 `WorkspaceTaskboard`。其唯一前缀与单调分配的编号组成稳定的 `IssueIdentifier`；移动 Issue 不会改写该标识。`IssueId`、`TaskboardAttachmentId`、`CommentId`、`ActivityId`、`RelationId`、`PatrolRunId`、`PatrolAttemptId` 和 `TaskboardActorId` 都是品牌化的不透明标识。

每个 Issue 恰有一种状态：`backlog`、`todo`、`in_progress`、`in_review`、`blocked`、`done` 或 `canceled`。优先级是 `none`、`urgent`、`high`、`medium` 或 `low`；它只是元数据，绝不改变手动看板顺序。活跃列表默认排除已归档 Issue。

`blocks` 与 `blocked_by` 是同一条有向依赖相对于 Issue 的两种视图，该边的来源阻塞目标。关系必须保留在一个 Workspace 内，且不能是自环、重复边或有向环的一部分。

## 变更与历史规则

每项可能竞争的 Issue 变更都会比较 `expectedVersion`，并递增提交后的版本。状态变更默认将 Issue 前置到目标列，除非消费方提供显式 `sortOrder`；显式顺序而非优先级决定后续 Patrol 扫描。将 `in_review`、`blocked` 或 `done` 退回 `todo` 时必须提供非空原因，并在同一事务中将原因追加为评论。

Issue 归档可逆。服务不提供永久删除 Issue、评论或活动记录的操作。评论与活动记录使用独立追加序列，区分用户、Patrol Agent、Reviewer 与系统操作者，并记录字段级 before/after 值。解除依赖会删除活动边，但会在活动记录中保留此前的值。带有当前依赖的 Issue 不能跨 Workspace 移动，因为依赖边必须保留在同一个 Workspace 内。

附件上传支持单个不超过 25 MB 的任意文件类型，会推进所属 Issue 版本并记录活动。元数据列表省略字节与存储路径；内容读取必须同时提供所属 Issue 和不透明附件 id。附件删除是版本一中唯一的永久 Taskboard 删除，调用方必须使用当前 Issue 版本显式确认，否则会被拒绝。

`TaskboardError.code` 可区分记录缺失、版本冲突、前缀冻结、无效归档转换、退回原因缺失和关系校验失败。提供方会在提交前拒绝操作并保留稳定错误码。

## 巡检调度状态

每个 Taskboard 会创建一项 `PatrolPolicy`，固定间隔调度默认关闭并选中 `1h`，Agent 与模型选择采用 Host 默认值，Permission Preset 为 `workspace-write`。支持的间隔词汇严格限定为 `5m`、`30m`、`1h`、`2h`、`6h`、`12h` 和 `24h`。启用时必须指定本地 Base Branch。启用或修改间隔会从保存时刻计算 `nextDueAt`；关闭则清除该时间，但不改变活跃 Run。

定时触发会消费此前的到期时刻，并按固定节拍推进至当前时间之后的首个节点。因此 Host 重启后只产生一次过期触发，不会重放所有错过的间隔。手动触发不会启用已保存 Policy，即使调度关闭也可以启动。

Patrol Run 预留在整个 Host 范围内持久化。一个活跃行会排除所有 Workspace 的其他活跃行。定时触发重叠会持久化已完成的 `skipped_global_busy` 结果，并推进该 Workspace 的节拍而不排队；手动触发重叠会被拒绝。Run 的终态结果不能覆写，也不存在删除 Run 的操作。

Host 启动时会在调度任何新的到期触发前，不依赖 Workspace 枚举地找到活跃 Run，并通过递增 `recoveryCount` 与保存 `lastRecoveredAt` 追加恢复证据。已经完成的 Attempt 检查点会被直接对账；权限阻塞检查点则在同一 Run 下继续扫描。

## 巡检认领与执行身份

一个 Run 拥有按顺序排列且永久保留的 `PatrolAttempt` 记录。原子认领会校验活跃 Run、准确 Issue 版本、`todo` 状态、非用户分配，以及所有阻塞 Issue 已完成的结果 commit，随后才把 Issue 移至 `in_progress`。只有前一个 Attempt 以 `permission_blocked` 结束时，同一 Run 才能继续认领；其他任何终态 Attempt 都会耗尽该轮的认领名额。

每个由 Patrol 执行的 Issue 最多拥有一个永久 `PatrolDevelopmentContext`。它会在 Issue 每次退回 `todo` 后继续固定准确 Session id、Base Branch、专属本地 `dsh-task/<issue>` 分支、持久 worktree、Agent Preset、模型选择、reasoning effort 和 Permission Preset。Provider 会区分已预留的 Session id 与已经持久化的 Session：首次持久化之前失败时可以重试同一个 id，已经启动但丢失的 Session 不能被替换。Review handoff 必须带有结果 commit 并把 Issue 移至 `in_review`；权限阻塞或其他执行失败会把 Issue 移至 `blocked` 并追加原因。

一个活跃 Attempt 可接受一条来自独立 Reviewer Session 的永久 `PatrolReview`。它会在实现 Session 执行修正轮次前，记录被审查的初步 commit、结论、发现、验证证据、风险和完成时间。同一 Attempt 的第二条审查会被拒绝。

`@deepseek-ai/dsh-taskboard-patrol` 会根据持久到期时间调度已启用策略，并只按手工顺序扫描 `todo` Issue。它会跳过用户指派、明确等待，以及缺少已集成到该 Issue 固定 Base Branch 的 `done` 结果 commit 的依赖。一个已审查 Issue 交接到 `in_review` 后会结束 Run；只有因工具审批被拒而阻塞的 Attempt 才能继续扫描。其他故障会阻塞已领取 Issue 并结束 Run。

Patrol 消费方通过受管理 subprocess 服务执行固定的纯本地 Git 命令集合，绝不执行 fetch、pull、push、PR、merge、reset、删除分支或移除 worktree，并在 Issue worktree 内保留 Workspace 相对 Session 目录。它会恢复准确 Session，挂载已保存的 Agent 与 Permission Preset，并拒绝无人值守审批。实现 Agent 必须留下干净且已提交的变更。独立的持久 Reviewer Session 会接收受限的已提交 diff，只暴露结构化提交工具，并固定使用只读沙箱和 `never` 审批策略；原 Session 随后接收其持久结论，执行一轮修正，再进入人工审查。

被中断的活跃 Attempt 只能通过已存储的 Development Context 恢复。恢复会重新打开准确 Session 与 worktree，复用已为该 Attempt 落库的 Reviewer 证据；否则要求实现 Session 先检查此前 transcript 与当前分支再继续。Context、Session 或 worktree 缺失或不匹配时，Attempt 与 Run 会原子地结束为失败，Issue 移至 `blocked`，原因被追加记录，并且绝不会创建替代 Session。

## 消费方与存储

消费方依赖 Service Definition，而非 SQLite 提供方。提供方启用外键，通过有序 Issue-label 行存储可复用的 Workspace 标签，使用固定 application id 和单调 schema 版本，并在初始化时拒绝存在内容但未标版本的文件、外来 application id 或不受支持的版本。其写事务使 Issue 版本、顺序、标签、必需评论、关系、附件元数据和活动记录保持一致。附件字节以不透明 id 作为仅所有者可访问的文件名，存放在相邻受管目录中，绝不进入 Workspace 仓库。

`@deepseek-ai/dsh-taskboard-remote` 在 Typert `taskboard` namespace 下暴露 Service，并针对 `ctx.workspaceRegistry` 校验 Workspace 身份。其 Workspace 活动记录读取会按从新到旧返回活跃 Issue 的活动记录，无需分别重新加载每个 Issue；侧边栏投影则会推导当前 `todo` 数量，而不返回 Issue 记录。人工审查证据包含从固定 Base Branch 到结果 commit 的受限已提交 diff。它还会注册 `taskboard-issues` Workspace 删除守卫：活动和已归档 Issue 会保持注册记录不变，直到全部 Issue 移到另一个 Workspace。创建 Issue 和把 Issue 移入 Workspace 会与删除共享注册表变更队列，因此守卫不会漏掉并发 Taskboard 写入。领域失败会保留为类型化业务结果，载体校验与基础设施故障仍保持独立。浏览器 API 组合会挂载它生成的 Client 贡献。

`@deepseek-ai/dsh-taskctl` 是该 Remote 之上的 JSON CLI。`@deepseek-ai/dsh-skill-manage-taskboard` 注册内置且允许模型与用户调用的工作流，要求 Agent 读取当前 Issue 上下文、只认领 `todo`、使用乐观版本、在把工作移至 `in_review` 前完成审查与 commit，并把 `done` 留给人工验收。标准 Web Host 会把 Provider、Remote 和 skill 一起挂载。

Web 消费方提供双语仪表盘、看板、列表、甘特图、Issue 详情、附件上传、图片预览、受控下载与确认删除、Patrol 设置与历史、Development Context 与审查证据，以及人工接受或退回操作。每个 Workspace 行会显示实时 `todo` 数量；点击已绑定的实现 Session 会返回普通对话视图；人工审查会显示已提交的 Base Branch diff。Dashboard 会推导完成率、生命周期数量、逾期工作、14 天内到期工作和最新五条 Workspace 活动记录，并把每项摘要链接到对应的筛选 List。甘特图会以规范 `blocks` 方向一次读取全部 Workspace 依赖，在表格中保留未排期 Issue，并持久化手工条形变更而不移动依赖项。Patrol 设置复用详情栏，从 Host 发现本地分支、Agent Preset、provider／model／reasoning 选项和 Permission Preset，并显示 Run 恢复次数与时间。版本一不会发布或同步任何 GitHub Issue，包括 `deepseek-ai/deepseek-harness` 中的 Issue。

## 版本一之后的 GitHub 计划

后续可以依次增加显式选择加入的仓库绑定；由用户发起、创建一条带持久来源映射的 GitHub Issue 发布操作；具备冲突处理的导入与元数据同步；以及从 Patrol 结果 commit 出发、单独授权的 Draft PR 发布。每个阶段都必须独立设计凭据、权限、错误与审计。任何阶段都不得由 Patrol 自动发布 Issue 或自动合并代码。

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

Source: [`packages/taskboard/taskboard/src/index.ts:130`](../../packages/taskboard/taskboard/src/index.ts)

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
 * Start one manual background Run under Host-wide exclusivity.
 * @param input - Workspace and optional exact todo Issue.
 * @returns active durable Run accepted by the Taskboard Provider.
 */
trigger(input: TriggerPatrolRunInput): Promise<PatrolRun>
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/taskboard/taskboard-patrol/src/index.ts:169`](../../packages/taskboard/taskboard-patrol/src/index.ts)

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
```

Types: [WorkspaceId](workspace.md)

Source: [`packages/taskboard/taskboard-remote/src/index.ts:59`](../../packages/taskboard/taskboard-remote/src/index.ts)

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

Source: [`packages/taskboard/taskboard/src/types.ts:651`](../../packages/taskboard/taskboard/src/types.ts)
<!-- END GENERATED cordis-surface -->
