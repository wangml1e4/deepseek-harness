# @deepseek-ai/dsh-taskboard

[English](README.md) | 中文

Workspace 所属 Taskboard 的 Service Definition。`ctx.taskboard` 暴露持久 Taskboard 元数据、Issue、评论、活动记录和依赖关系，不暴露提供方的存储格式。

## 服务语义

- `ensureWorkspace` 为每个 `WorkspaceId` 创建一个隐式 Taskboard；派生出的唯一前缀只能在首个 Issue 创建前修改，之后保持冻结。
- Issue 在 Workspace 间移动时保持标识不变，移动到当前 Workspace 是无操作。新 Issue 默认进入 `backlog`；显式创建到或移动到 `todo` 会授权后续 Patrol 消费方执行。
- 活跃 Issue 列表遵循持久看板顺序。优先级只用于展示和筛选，绝不改变执行顺序。
- 可能竞争的 Issue 变更要求 `expectedVersion`。将 `in_review`、`blocked` 或 `done` 工作退回 `todo` 还必须提供原因，该原因会成为仅追加的评论。
- 未改变任何字段的更新是无操作。归档可逆，重复归档会被拒绝，服务不提供永久删除 Issue 的操作。评论和活动记录仅可追加。
- 活动记录和评论的操作者会区分用户、Patrol Agent、Reviewer 与系统责任来源。
- 一项依赖是同一条有向边：从来源查看为 `blocks`，从目标查看为 `blocked_by`。自环、重复、跨 Workspace 和成环依赖都会在不写入的情况下被拒绝。
- `listWorkspaceRelations` 会把每条 Workspace 依赖以规范 `blocks` 视图返回一次，供时间轴消费方使用；`listRelations` 为详情界面保留相对于所请求 Issue 的方向。

稳定失败使用 `TaskboardError.code`；提供方保留本包声明的错误码。[Taskboard 子系统参考](../../../docs/subsystems/taskboard.md)负责公开值与服务参考。

## 模型体验

间接影响：由 Taskboard 消费方选择进入模型上下文的记录。

#### KV Cache 影响

与模型请求无关，因为本包绝不改变请求内容。

## 已知限制与暂缓事项

- 首个领域层尚不暴露附件、Session 或 Git 绑定、Patrol 策略、Patrol Run 和审查证据；后续 Taskboard 包会通过同一服务增加这些记录。
- Taskboard 创建是隐式的，但 Workspace 删除保护由后续 Workspace 消费方安装；本包自身无法拦截 Workspace 移除。
