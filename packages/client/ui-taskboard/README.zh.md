# @deepseek-ai/dsh-client-ui-taskboard

[English](README.md) | 中文

每个 Workspace 固有 Taskboard 的浏览器消费方。每个真实 Workspace 行都有一个紧凑操作，可把 Taskboard 作为替代中间界面打开；选择 Issue 后，其可编辑记录会显示在现有右侧详情栏中。返回 Session 时会恢复普通对话界面。

中间界面基于同一个 `TaskboardController` 快照提供 Dashboard、Board 和 List 视图。Dashboard 从当前 Issue 列表推导完成率、活动中、逾期、状态、优先级和最近工作摘要。Board 渲染七个生命周期列，并通过 Issue 乐观版本持久化拖拽移动。List 按生命周期状态分组展示同一批 Issue。搜索以及状态、优先级和标签筛选会一致应用于全部视图，所选视图与筛选条件以 `dsh.taskboard.view.v1` 为键保存在浏览器存储中。

详情界面可编辑标题、Markdown 描述、状态、优先级、负责人、标签和按天记录的日期。它会列出仅追加的评论与活动记录、管理有向依赖关系，并在不提供永久删除的前提下归档 Issue。把 `in_review`、`blocked` 或 `done` Issue 退回 `todo` 时，提交前会显示必填的原因字段。

该包注册到 `sidebar.workspace.action`、`shell.center` 和 `shell.details`。`ui-layout` 持有通用替代界面选择，`ui-workspace` 提供 Workspace 行的 owner 数据。生成的 `taskboard` Remote 命名空间以 `remote.taskboard` 形式显式声明为依赖，因此该插件只会在对应描述符挂载后激活。Host 的 `taskboard/changed` 事件会刷新当前 Workspace；代际围栏则阻止较早的 Workspace 或 Issue 响应覆盖较新的选择。

Web 无密钥 fixture 会暴露与正式环境相同的生成端点名，以及供浏览器装配快照使用的确定性 Issue 数据。包测试负责控制器竞态、持久化、注册和组件行为，装配快照负责验证从 Workspace 入口到详情栏的构建产物产品路径。

## 模型体验

无。该包只在浏览器界面中渲染和变更 Host 持有的 Taskboard 记录；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **本层尚未注册甘特图**：日期已经可以编辑并持久化，但时间轴与依赖连线会在下一层 stack PR 中加入。
- **尚无 Patrol 与审查控件**：调度、Development Context、Session 执行、Reviewer 证据和人工审查操作属于后续 stack 层。
- **附件尚无浏览器界面**：当前详情栏只覆盖 Issue 字段、评论、活动记录和关系。
- **归档后 Issue 会被隐藏**：Host 支持恢复，但该包尚未提供归档浏览器或恢复操作。
