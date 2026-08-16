# @deepseek-ai/dsh-taskboard-remote

[English](README.md) | 中文

Workspace 所属 Taskboard 能力的 Host Remote 消费方。它通过 Typert RPC 暴露 Taskboard Service，同时以 Host 的 Workspace 注册表为权威来源。

## Remote 方法

`taskboard` namespace 提供 Workspace 元数据、Issue 生命周期、评论、按 Issue 与 Workspace 读取的活动记录、附件、关系，以及五项 Patrol 操作：`patrol`、`updatePatrol`、`runPatrol`、`patrolIssue` 和 `removePatrolWorktree`。`todoCount` 会推导一个 Workspace 当前的 `todo` 数量而不返回 Issue 记录；`listWorkspaceActivities` 会先校验已注册 Workspace，再按从新到旧返回其活跃 Issue 的活动记录。

附件元数据与字节分开列出。上传和读取方法通过受控 Host namespace 传输规范 base64，在持久化前执行 25 MB 上限，并把每次读取限定到所属 Issue，且绝不返回受管文件系统路径。删除操作把显式确认与乐观版本校验委托给 Taskboard Service。

按 Workspace 划分的方法会在接触 Taskboard 状态前拒绝未知 Workspace id。需要隐式 Taskboard 的读取会根据当前已注册 Workspace 的标题确保其存在。移动 Issue 时也会校验并确保目标 Workspace 存在。

挂载该 Host 消费方期间，它会注册一项 Workspace 删除守卫。任何活动或已归档 Issue 都会返回带有确切保留数量的 `taskboard-issues` blocker；把全部 Issue 移到其他 Workspace 后，blocker 即消失。创建 Issue 和把 Issue 移入 Workspace 会使用注册表变更队列，因此并发删除会先看到已完成的写入，再运行守卫。该检查绝不删除或改写 Taskboard 数据。

每个方法都返回 `TaskboardRemoteResult<T>`。领域失败会保留为带有 `TaskboardError.code` 的稳定业务结果；格式错误的请求在生成的 Typert 载体中失败，基础设施故障则直接拒绝，不会被错误标记为领域错误。`getIssue` 使用显式可空值，因此 Issue 不存在与调用失败是两种不同结果。

`patrol` 会组合已保存策略、当前 Host 选项以及永久 Run／Attempt 历史。`updatePatrol` 把 Host 所属选项校验委托给 Patrol 消费方，`runPatrol` 启动一轮手工后台 Run。`patrolIssue` 会为详情栏返回永久 Development Context、当前物理 worktree 是否存在、结果 commit 相对 Base Branch 的受限 diff、独立 Reviewer 证据，以及每个未满足前置 Issue 的未完成或尚未集成原因。`removePatrolWorktree` 把显式确认和干净且已集成的检查委托给 Patrol 消费方，再返回保留的分支、路径和结果 commit 身份。

生成的 `./remote` 入口由 [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.md) 挂载给浏览器消费方。Web Host 会把本包与 Taskboard Service Definition 和 SQLite Provider 一起挂载。

## 模型体验

无，因为 Remote 负责传输 Taskboard 操作，不添加模型可见指令或工具。

#### KV Cache 影响

无直接影响。

## 已知限制与暂缓事项

- 浏览器 API 装配会转发 `taskboard/changed`，供当前 Workspace 缓存失效；该事件不携带 Issue 数据。
- Remote 是 Host 本地应用 API；它不会发布或同步 GitHub Issue。
