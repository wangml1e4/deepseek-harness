# @deepseek-ai/dsh-taskboard-patrol

[English](README.md) | 中文

Workspace Taskboard Patrol 的 Host 执行支持。`ctx.taskboardPatrol` 将已经持久化的 `PatrolAttempt` 转换为一份永久 Development Context 和一个普通、可见的 Harness Session。

- 从未绑定的 Issue 会固定所选本地 Base Branch、Agent Preset、provider、model、reasoning effort 和 Permission Preset。退回的 Issue 复用这些值，不读取后续 Policy 变更。
- 每个 Issue 拥有一个 `dsh-task/<issue-identifier>` 分支和一个由 Host 管理且永久保留的 worktree。Workspace 位于仓库根目录下层时，Session cwd 会保留其相对目录。
- Git 适配器只使用参数数组执行本地命令：仓库／ref 检查、`worktree add`、祖先检查、status、diff 和 commit 读取。它不包含 fetch、pull、push、merge、reset、分支删除、worktree 移除或 PR 操作。
- 首次持久化前配置失败时，可以继续创建已经预留 id 的 Session。首次持久化一旦记录，冷 Session 只恢复该确切 id，Session 缺失时会失败且不创建替代对象。已存活的绑定 Session 仅在 idle 且 cwd 与 Agent Preset 仍匹配时借用。
- 新 Session 在发布前加入所选 Agent Preset，记录 Permission Preset；恢复时保留日志中的模型选择；随后挂接到所属 Workspace，并在执行前 flush。
- 每个执行 lease 会以 `rejected` 回答全部工具审批请求，记录请求工具及原因，并取消该轮。Patrol 协调器负责随后写回 Attempt 和 Issue。

本包不调度定时器，不扫描或领取 Issue，不提示 Agent，不运行独立 Reviewer，也不改变人工审查状态。这些编排操作由后续 Consumer 基于持久 Taskboard 与本服务完成。

## 模型体验

后续 Patrol 协调器会通过本包准备的 Agent Session 间接影响模型。本包自身不增加模型可见内容。

#### KV Cache 影响

不影响模型请求，因为 Session 与 Git 准备不会改变请求前缀。

## 已知限制与延后工作

- 本包尚不负责 timer、Issue 资格扫描、Agent prompt、独立 Reviewer 或人工审查控件。
- 本包只支持本地 Git 仓库和永久本地 worktree；特意不提供远程 fetch、push、PR、merge 或清理操作。
