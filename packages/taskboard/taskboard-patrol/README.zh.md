# @deepseek-ai/dsh-taskboard-patrol

[English](README.md) | 中文

Workspace Taskboard Patrol 的 Host 执行支持。`ctx.taskboardPatrol` 将已经持久化的 `PatrolAttempt` 转换为一份永久 Development Context 和一个普通、可见的 Harness Session。

- 从未绑定的 Issue 会固定所选本地 Base Branch、Agent Preset、provider、model、reasoning effort 和 Permission Preset。退回的 Issue 复用这些值，不读取后续 Policy 变更。
- 每个 Issue 拥有一个 `dsh-task/<issue-identifier>` 分支和一个由 Host 管理的持久 worktree 绑定。Patrol 恢复该 Issue 时，会在原路径创建或还原物理 worktree。Workspace 位于仓库根目录下层时，Session cwd 会保留其相对目录。
- Git 适配器只使用参数数组执行本地命令：仓库／ref 检查、`worktree add`、受保护的 `worktree remove`、祖先检查、status、diff 和 commit 读取。它不包含 fetch、pull、push、merge、reset、分支删除、自动移除 worktree 或 PR 操作。
- 首次持久化前配置失败时，可以继续创建已经预留 id 的 Session。首次持久化一旦记录，冷 Session 只恢复该确切 id，Session 缺失时会失败且不创建替代对象。已存活的绑定 Session 仅在 idle 且 cwd 与 Agent Preset 仍匹配时借用。
- 新 Session 在发布前加入所选 Agent Preset，记录 Permission Preset；恢复时保留日志中的模型选择；随后挂接到所属 Workspace，并在执行前 flush。
- 每个执行 lease 会以 `rejected` 回答全部工具审批请求，记录请求工具及原因，并取消该轮。Patrol 协调器负责随后写回 Attempt 和 Issue。
- 协调器根据持久化的 `nextDueAt` 调度已启用策略，只按手工顺序扫描 `todo` Issue，并跳过用户指派、明确等待、尚未完成的依赖，以及其 `done` 结果 commit 尚未集成到该 Issue 固定 Base Branch 的依赖项。同一项检查既为原子认领提供 commit 证据，也为读取投影提供不同的 `predecessor_not_done` 或 `waiting_for_integration` 原因。
- 一轮 Run 会在一个已审查 Issue 进入 `in_review` 后结束。只有因工具审批受阻的 Attempt 才能继续领取下一个合格 `todo`；其他任何故障都会阻塞已领取 Issue 并结束 Run。
- 启动时，协调器会先恢复唯一的持久活跃 Run，再调度新的到期触发。活跃 Attempt 只能恢复其准确绑定 Session 和 worktree。已有 Reviewer 证据会被复用；否则恢复后的实现 Session 会先收到一轮恢复任务，再进入审查。恢复会先从准确持久化的实现 Session 和已记录的 Reviewer Session 重建 Attempt 统计，再追加恢复轮次。绑定缺失或不匹配时，Run 与 Attempt 会以失败结束，Issue 移至 `blocked`，并且绝不会创建替代 Session。
- 实现 Agent 必须留下干净且已提交的 Base Branch diff。独立的持久 Reviewer Session 会接收该已提交 diff，继承已保存的模型组合，只暴露结构化审查提交工具，并固定使用只读沙箱与 `never` 审批策略。实现 Session 随后接收持久审查结论，执行一轮修正与验证，再交给人工审查。
- 实现、Reviewer、修正和恢复轮次会从规范 Session 事件收集 Provider 报告的用量，且不会重复计算原始记录与组装记录。模型流的终态 `finish` 故障会与编排错误分别保留，Taskboard Provider 会把已完成 Attempt 的用量聚合到永久 Run 历史中。
- `configuration()` 会发现本地分支、可挂载 Agent Preset、在线 provider／model／reasoning 选项和现有 Permission Preset。`updatePolicy()` 在乐观版本保存前校验这些 Host 所属选项。`trigger()` 可在不启用固定调度的情况下启动手工 Run。
- `removeWorktree()` 要求显式确认、干净的物理 worktree，以及已集成到固定 Base Branch 的已记录结果 commit。它只移除物理目录；Issue 分支、Session 绑定、Development Context 和 Patrol 历史都会保留，之后退回的 Issue 可以恢复同一路径。

调度器在 Host 进程内运行，Host 停止期间不能执行。Taskboard Policy 会保留固定节拍；启动时会先完成活跃 Run 恢复，再最多消费一次已到期触发。

## 模型体验

### 实现任务

#### 模型所见

实现 Agent 会收到由插件生成的用户消息，其中包含 `Issue.identifier`、标题、描述、生命周期要求、本地 Git 限制和审查交接要求。

#### Token 影响

一条持久用户消息会在现有实现 Session 中增加 Issue 内容与固定执行指令。

#### KV Cache 影响

仅追加到实现 Session 的可复用前缀之后。

### 独立审查任务

#### 模型所见

Reviewer 会收到准确的初步 commit 及其受限 Base Branch diff，再通过唯一工具 `patrol_review_submit` 返回结构化结论。

#### Token 影响

一条持久用户消息会在独立 Reviewer Session 中增加 Issue、commit、diff 统计和有界补丁。

#### KV Cache 影响

仅追加到 Reviewer Session 的可复用前缀之后。

### 修正任务

#### 模型所见

实现 Session 会收到持久 verdict、findings、verification 和 risks，以及修正、验证并提交结果的指令。

#### Token 影响

一条持久用户消息会把结构化审查证据加入现有实现 Session。

#### KV Cache 影响

仅追加到实现 Session 的可复用前缀之后。策略发现与定时检查不影响模型请求。

### 恢复任务

#### 模型所见

进程丢失在 Reviewer 证据落库前中断 Attempt 时，准确的原实现 Session 会再次收到该 Issue，以及检查此前 transcript 和当前永久 worktree、避免重复已完成工作、验证并提交的指令。已有 Reviewer 证据时，恢复会跳过该任务，直接从修正任务继续。

#### Token 影响

只有不存在持久审查检查点时，一条持久用户消息才会增加恢复指令与 Issue 内容。

#### KV Cache 影响

仅追加到恢复后实现 Session 的现有可复用前缀之后。

## 已知限制与延后工作

- 本包只支持本地 Git 仓库；特意不提供远程 fetch、push、PR、merge 或分支清理操作。物理 worktree 移除是受保护的显式用户操作，绝不会由 Patrol 调度或人工审查通过自动执行。
- 版本一绝不会把 Taskboard Issue 发布到 `deepseek-ai/deepseek-harness` GitHub Issues。
