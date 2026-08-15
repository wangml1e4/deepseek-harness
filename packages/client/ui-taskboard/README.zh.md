# @deepseek-ai/dsh-client-ui-taskboard

[English](README.md) | 中文

每个 Workspace 固有 Taskboard 的浏览器消费方。每个真实 Workspace 行都有一个紧凑操作，可把 Taskboard 作为替代中间界面打开；选择 Issue 后，其可编辑记录会显示在现有右侧详情栏中。返回 Session 时会恢复普通对话界面。

中间界面基于同一个 `TaskboardController` 快照提供 Dashboard、Board、List 和 Gantt 视图。Dashboard 从当前 Issue 列表推导完成率、活动中、逾期、状态、优先级和最近工作摘要。Board 渲染七个生命周期列，并通过 Issue 乐观版本持久化拖拽移动。List 按生命周期状态分组展示同一批 Issue。Gantt 会在表格中保留未排期 Issue，只在开始和截止日期都存在时绘制条形，并在已排期 Issue 之间绘制 `blocks` 连线。拖动或调整一个条形只会更新该 Issue 的含首尾日期，不会移动依赖项。搜索以及状态、优先级和标签筛选会一致应用于全部视图，所选视图、甘特图时间刻度与筛选条件以 `dsh.taskboard.view.v1` 为键保存在浏览器存储中。

详情界面可编辑标题、Markdown 描述、状态、优先级、负责人、标签和按天记录的日期。它会列出仅追加的评论与活动记录、管理有向依赖关系，并在不提供永久删除的前提下归档 Issue。附件支持单个不超过 25 MB 的任意文件类型；界面会列出元数据、预览图片、通过受控 Host Remote 下载字节，并且只会在浏览器确认后调用永久附件删除。把 `in_review`、`blocked` 或 `done` Issue 退回 `todo` 时，提交前会显示必填的原因字段。

Taskboard 顶栏会在现有右侧详情栏中打开 Patrol 设置。开关默认关闭；面板可保存 `5m`、`30m`、`1h`、`2h`、`6h`、`12h` 或 `24h` 固定间隔，以及 Base Branch、Agent Preset、provider、model、reasoning effort 和 Permission Preset 选项。它会显示下次到期时间、活跃状态、永久 Run／Attempt 历史和手工 `Run now` 操作。合格的 `todo` Issue 也提供定向运行操作。Issue 详情会显示已绑定 Session、分支、Base Branch、结果 commit 和独立 Reviewer 结论。人工审查可把 `in_review` 移至 `done`，或在提供必填原因后退回 `todo`；它绝不合并代码。

该包注册到 `sidebar.workspace.action`、`shell.center` 和 `shell.details`。`ui-layout` 持有通用替代界面选择，`ui-workspace` 提供 Workspace 行的 owner 数据。生成的 `taskboard` Remote 命名空间以 `remote.taskboard` 形式显式声明为依赖，因此该插件只会在对应描述符挂载后激活。一次 Workspace 级关系读取会提供规范方向的依赖连线，避免逐 Issue RPC 调用。Host 的 `taskboard/changed` 事件会刷新当前 Workspace；代际围栏则阻止较早的 Workspace 或 Issue 响应覆盖较新的选择。

甘特图包装器使用 MIT 许可的 `dhtmlx-gantt` 10 Community Edition。其 React 生命周期与手工排期交互改造自 Dashi Taskboard 的 Apache-2.0 `GanttView`；修改后的源码带有归属声明，发布包的 `LICENSE` 同时包含 Harness 的 MIT 条款与 Dashi 的 Apache 许可证。

Web 无密钥 fixture 会暴露与正式环境相同的生成端点名，以及供浏览器装配快照使用的确定性 Issue 数据。包测试负责控制器竞态、日期转换、依赖投影、图表生命周期、持久化、注册和组件行为，装配快照负责验证从 Workspace 入口到详情栏的构建产物产品路径。

## 模型体验

无。该包只在浏览器界面中渲染和变更 Host 持有的 Taskboard 记录；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **归档后 Issue 会被隐藏**：Host 支持恢复，但该包尚未提供归档浏览器或恢复操作。
