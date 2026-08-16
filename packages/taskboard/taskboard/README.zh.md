# @deepseek-ai/dsh-taskboard

[English](README.md) | 中文

Workspace 所属 Taskboard 的 Service Definition。`ctx.taskboard` 暴露持久 Taskboard 元数据、Issue、评论、活动记录、附件、依赖关系、Patrol Policy 和 Patrol Run，不暴露提供方的存储格式。

## 服务语义

- `ensureWorkspace` 为每个 `WorkspaceId` 创建一个隐式 Taskboard；派生出的唯一前缀只能在首个 Issue 创建前修改，之后保持冻结。
- Issue 在 Workspace 间移动时保持标识不变，移动到当前 Workspace 是无操作。新 Issue 默认进入 `backlog`；显式创建到或移动到 `todo` 会授权后续 Patrol 消费方执行。
- 活跃 Issue 列表遵循持久看板顺序。优先级只用于展示和筛选，绝不改变执行顺序。
- 可能竞争的 Issue 变更要求 `expectedVersion`。将 `in_review`、`blocked` 或 `done` 工作退回 `todo` 还必须提供原因，该原因会成为仅追加的评论。
- 未改变任何字段的更新是无操作。归档可逆，重复归档会被拒绝，服务不提供永久删除 Issue 的操作。评论和活动记录仅可追加。
- 活动记录和评论的操作者会区分用户、Patrol Agent、Reviewer 与系统责任来源。
- `listWorkspaceActivities` 会按从新到旧返回一个 Workspace 中当前活跃 Issue 的活动记录。已归档 Issue 的活动记录仍保留在其历史中，但不会进入活跃 Dashboard 投影。
- 附件支持任意文件类型，单个文件上限为 25 MB。元数据读取绝不暴露 Provider 路径；内容读取必须同时提供所属 Issue 与不透明附件 id。上传和显式确认后的删除会推进 Issue 版本并追加活动记录，而其他 Issue、评论、活动记录与 Patrol 记录仍遵循禁止删除规则。
- 一项依赖是同一条有向边：从来源查看为 `blocks`，从目标查看为 `blocked_by`。自环、重复、跨 Workspace 和成环依赖都会在不写入的情况下被拒绝。
- `listWorkspaceRelations` 会把每条 Workspace 依赖以规范 `blocks` 视图返回一次，供时间轴消费方使用；`listRelations` 为详情界面保留相对于所请求 Issue 的方向。
- 每个 Taskboard 的 Patrol 默认关闭、选中 `1h`、使用 `workspace-write` 权限，并将新 Session 选项保持为空。Policy 更新只接受 `5m`、`30m`、`1h`、`2h`、`6h`、`12h` 或 `24h`；启用时必须提供本地 Base Branch，启用或修改间隔会从保存时刻重新排期，关闭则清除 `nextDueAt`，但不终止活跃 Run。
- 定时触发会消费一个到期时刻，并从原有固定节拍推进至当前时间之后，因此 Host 停机不会形成补跑队列。即使 Policy 已关闭，仍可手动触发一次 Run。
- 整个 Host 最多保留一个活跃 Patrol Run。定时触发重叠会形成永久的 `skipped_global_busy` 历史记录；手动触发重叠则以繁忙拒绝。Run 完成后不能覆写其终态结果。
- 启动恢复会在不依赖 Workspace 注册状态的情况下定位该 Host 范围活跃 Run。每次恢复都会递增 `recoveryCount` 并保存 `lastRecoveredAt`；无法恢复的活跃 Attempt 会与所属 Run 原子地结束为失败，同时 Issue 移至 `blocked` 并保留带操作者信息的原因。
- 一个 Run 拥有按顺序排列的 `PatrolAttempt` claim。领取操作会原子校验 `todo`、指派、Run 归属、乐观版本、前置 Issue 的 `done` 状态及其确切 commit 快照，再把 Issue 移到 `in_progress`。只有前一个 Attempt 为 `permission_blocked` 时，同一 Run 才能继续领取。
- 每个由 Patrol 执行的 Issue 最多拥有一份 `PatrolDevelopmentContext`。其中确切的 Session id、Base Branch、分支、worktree、Agent Preset、模型选择和 Permission Preset 会在以后每次退回 `todo` 时继续保留；首次 Session 持久化会与 id 预留分别记录，进入 review handoff 时会记录结果 commit。绑定和 Attempt 历史都没有删除操作。
- 每个活跃 Attempt 可接受一条来自独立 Reviewer Session 的持久 `PatrolReview`。该记录会固定被审查的初步 commit、结论、发现、验证证据、风险和完成时间；同一 Attempt 的第二条审查会被拒绝，审查历史也没有删除操作。

稳定失败使用 `TaskboardError.code`；提供方保留本包声明的错误码。[Taskboard 子系统参考](../../../docs/subsystems/taskboard.md)负责公开值与服务参考。

## 模型体验

间接影响：由 Taskboard 消费方选择进入模型上下文的记录。

#### KV Cache 影响

与模型请求无关，因为本包绝不改变请求内容。

## 已知限制与暂缓事项

- 本包持有持久调度、领取、绑定、审查和生命周期操作，但不会自行启动工作；Patrol 消费方负责定时与 Agent 编排。
- Taskboard 创建是隐式的，但 Workspace 删除保护由后续 Workspace 消费方安装；本包自身无法拦截 Workspace 移除。
- 版本一只在本地存储 Issue，绝不会向 `deepseek-ai/deepseek-harness` GitHub Issues 发布或同步。
