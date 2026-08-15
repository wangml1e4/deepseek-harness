# @deepseek-ai/dsh-taskboard-remote

[English](README.md) | 中文

Workspace 所属 Taskboard 能力的 Host Remote 消费方。它通过 Typert RPC 暴露 Taskboard Service，同时以 Host 的 Workspace 注册表为权威来源。

## Remote 方法

`taskboard` namespace 提供 `workspace`、`setPrefix`、`listIssues`、`getIssue`、`createIssue`、`updateIssue`、`moveIssue`、`archiveIssue`、`restoreIssue`、`listComments`、`addComment`、`listActivities`、`listWorkspaceRelations`、`listRelations`、`addRelation` 和 `removeRelation`。

按 Workspace 划分的方法会在接触 Taskboard 状态前拒绝未知 Workspace id。需要隐式 Taskboard 的读取会根据当前已注册 Workspace 的标题确保其存在。移动 Issue 时也会校验并确保目标 Workspace 存在。

每个方法都返回 `TaskboardRemoteResult<T>`。领域失败会保留为带有 `TaskboardError.code` 的稳定业务结果；格式错误的请求在生成的 Typert 载体中失败，基础设施故障则直接拒绝，不会被错误标记为领域错误。`getIssue` 使用显式可空值，因此 Issue 不存在与调用失败是两种不同结果。

生成的 `./remote` 入口由 [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.md) 挂载给浏览器消费方。Web Host 会把本包与 Taskboard Service Definition 和 SQLite Provider 一起挂载。

## 模型体验

无，因为 Remote 负责传输 Taskboard 操作，不添加模型可见指令或工具。

#### KV Cache 影响

无直接影响。

## 已知限制与暂缓事项

- 浏览器 API 装配会转发 `taskboard/changed`，供当前 Workspace 缓存失效；该事件不携带 Issue 数据。
- 附件、Session 与 Git 绑定、Patrol policy 与 Run 历史以及审查证据尚未进入本协议层。
- Remote 是 Host 本地应用 API；它不会发布或同步 GitHub Issue。
