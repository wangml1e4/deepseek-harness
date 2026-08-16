# Agent Note: Workspace 持有的 Taskboard

Status: proposed

[English](2026-08-15-workspace-taskboard.md) | 中文

## 问题

DeepSeek Harness 使用持久 Workspace 组织会话，但缺少供用户与 agent 共享的持久跨会话工作目录。Session Todo 属于单个 agent，Goal 在一个会话中保留一个目标，Job 只存在于进程内，Schedule 提醒也只在所属会话存活时运行；它们都不能表示从提出、执行到人工审核的项目工作。

Dashi Taskboard 参考项目提供了这条产品闭环，但它的独立 Project 实体会重复 Harness 已由 Workspace 持有的目录、标题和会话关系。独立删除还会迫使产品在遗留 Taskboard 数据与静默删除 Issue、评论、附件和 agent 活动之间选择。

## 提案

每个已注册 Workspace 固有且只拥有一个 Taskboard。Taskboard 不会被独立创建、命名或删除，每个 Issue 都属于一个 Workspace。Issue 可以通过显式变更移动到另一个 Workspace。

Taskboard 中仍有任何 Issue 时，Workspace 删除会被拒绝，已归档 Issue 也包括在内。第一版绝不永久删除 Issue、评论、活动记录或 Patrol Run，因此用户必须先把全部 Issue 移到另一个 Workspace；Workspace 删除绝不会级联删除 Taskboard 数据。

第一版产品提供本地 Taskboard 闭环：Issue、Dashboard、看板和列表视图、甘特图、生命周期状态、优先级、标签、评论、关系、附件、搜索与筛选、Harness 会话绑定，以及可配置的 Patrol Agent。向 `deepseek-ai/deepseek-harness` GitHub Issues 发布或同步 Taskboard Issue、重复 Issue、Jira 集成、云协作、桌面端打包、Codex 注入和节点工作流编辑器不在本提案范围内。

Dashboard 是同一份 Issue 数据的只读投影。它展示生命周期数量和完成进度、逾期及即将到期的 Issue 与最近活动，并通过链接打开对应的 Taskboard 筛选视图。它不会持久化第二套统计模型。

现有侧边栏中的每个 Workspace 行都会展示 Taskboard 入口和 `todo` 数量。选择后，中间会话区域会切换为该 Workspace 的 Taskboard，并提供 Dashboard、Board、List 和 Gantt 标签页。Patrol 控件和状态位于 Taskboard 顶栏。打开 Issue 已绑定 Session 时，中间区域会返回对应的普通会话。

选择 Issue 后，其描述、属性、关系、附件、评论、活动、Session 链接和 commit 链接会显示在现有右侧详情栏中，而不会替换 Taskboard 中间区域的状态。窄布局会全屏展示同一详情界面。

同一详情界面会展示人工审查证据：结果 commit、相对 Base Branch 的 diff、Reviewer 意见、已执行验证、剩余风险，以及“通过”和“退回”操作。Taskboard 只使用应用内状态、侧边栏角标和应用内通知；第一版不会发送操作系统、邮件或 webhook 通知。

Dashi 的 Apache-2.0 前端组件和交互逻辑可以用于改造 Board、List、Gantt 与 Issue 详情，但必须保留规定的归属与修改文件声明。`dhtmlx-gantt` 版本 10 可以按其 MIT 许可证使用。不会复制 Dashi 的独立服务端、Codex 注入和自动化桥；Harness 服务、Remote 契约、Session 集成、权限与 Patrol 仍由原生 Cordis 插件实现。

Taskboard 是由 Service Definition、本地 SQLite Provider 与 Host、UI 和 Patrol Consumer 组成的能力接缝。Harness 持久化根目录下的一份 Taskboard 数据库会按 `WorkspaceId` 保存所有 Workspace 的记录；附件字节放在相邻受管目录中，其元数据仍在 SQLite 事务内。Taskboard 不会向 Workspace 仓库写入数据库或附件数据。Provider 使用带索引的表和事务保存 Issue 版本、评论、关系、活动与 Patrol Run，而不是把这些关系数据存进 `storage-domain` 记录。

附件使用随机不透明 id 作为仅所有者可访问的受管文件名；原始文件名只作为元数据保存，绝不参与 Host 路径解析。按 Issue 限定的 Remote 方法通过规范 base64 传输数据且不暴露 Host 路径；每次读取都必须同时校验 Issue 与附件身份，之后才返回字节。

第一版还会提供改造后的 `taskctl` CLI 和内置 `manage-taskboard` skill，二者都是 Taskboard Consumer。用户和交互式 Agent 会通过它们，针对 UI 使用的同一 Host Service 执行 Issue、评论、关系和查询操作。Patrol 的资格判断、原子认领、Session 绑定和生命周期写回会直接调用 Host Service，而不是要求模型通过 CLI 编排关键事务。

甘特图排期沿用 Dashi 的人工模型。Issue 包含可选且按天记录的 `startDate` 和 `dueDate` 字段。未排期 Issue 仍保留在表格中，但只有两个日期都存在时，时间轴才会绘制时间条。拖动或缩放时间条会修改这些日期。`blocks` 关系会在已排期 Issue 之间绘制依赖线，但绝不会自动移动日期。

新 Issue 默认进入 `backlog`，除非用户直接在 `todo` 中创建；把 Issue 移入 `todo` 就是对无人值守执行的显式授权。人类可读的 Issue 标识采用 `<WORKSPACE_PREFIX>-<单调递增编号>`。前缀从 Workspace 标题派生，可在创建第一个 Issue 前编辑，必须唯一，此后不可变。

Issue 归档可逆。第一版不提供 Issue、评论、活动记录或 Patrol Run 的永久删除；评论和活动只能追加。附件沿用 Dashi 的单文件 25 MB 上限并接受任意文件类型，图片可预览，下载通过受控 Host 路由，且仅能在显式确认后删除。

Issue 状态原样采用 Dashi 的封闭生命周期：`backlog`、`todo`、`in_progress`、`in_review`、`blocked`、`done` 和 `canceled`。

只有 `todo` 才授权 Patrol Agent 认领 Issue。`backlog` 表示尚未批准的工作，其他状态都不能作为新的认领候选。

用户可以手动调整 Issue 状态。“通过”是 `in_review` 转为 `done` 的正常路径。把 `in_review`、`blocked` 或 `done` 退回 `todo` 时必须填写原因，并保留全部既有 Session 和 Development Context 绑定。

第一版提供三种分配值：`Unassigned`、`User` 和 `Patrol Agent`。Patrol 只会考虑 `Unassigned` 和 `Patrol Agent` Issue，并跳过所有分配给 `User` 的 Issue。认领会把 Assignee 设为 `Patrol Agent` 并绑定具体 Session；Assignee 与 Session 绑定仍是两个独立字段。

带有 `blocked_by` 关系的 `todo` Issue 只有在所有前置 Issue 都严格为 `done`，且每个前置 Issue 的结果 commit 都是当前 Base Branch 的祖先时才符合条件。`canceled`、`in_review` 和其他任何状态都不能满足依赖。已完成但尚未集成的前置 Issue 会让后继 Issue 明确显示“等待代码集成”；要绕过依赖，必须显式修改关系。

Patrol 按 `todo` 列的人工从上到下顺序扫描 Issue。它会跳过依赖未满足，或 Issue 内容及最新评论明确写明等待或暂不开始的候选。优先级只用于展示和筛选，绝不会重新排列 Patrol 工作。

Issue 详情还会提供针对所选 Issue 的“立即执行”。这一单次操作会绕过看板顺序，但仍然执行状态、分配、依赖、并发和权限资格检查。固定间隔调度关闭时也可以运行，且绝不会因此启用该策略。

Issue 会保留一个持久的 Harness Session 绑定。已绑定 Issue 回到 `todo` 后，Patrol Agent 必须恢复该确切 Session；只有没有绑定的 Issue 才能创建新 Session。

每个由 Patrol 执行的 Issue 还会保留专属 Git branch 和 worktree 绑定。开始未绑定 Issue 前，Patrol 会创建二者并在该 worktree 中启动 Session；后续轮次会恢复同一 Session 和 worktree。Patrol 绝不会在用户当前 Workspace checkout 中 commit。非 Git Workspace 或 branch/worktree 创建失败时，会记录原因并把 Issue 转为 `blocked`，而不会回退到 Workspace 根目录。

Patrol Policy 包含 Base Branch。启用 Patrol 时会初始选择当前 checkout 的本地分支，用户也可以选择其他本地分支。新的未绑定 Issue 会从所选分支的本地 tip 创建 branch 和 worktree。Patrol 绝不会自动 fetch 或 pull。修改 Base Branch 只影响之后的未绑定 Issue；既有 Development Context 绑定保持不变。

Patrol 创建的 Session 是普通持久 Workspace Session，会出现在现有 Session 列表中，并根据 Issue 标识和标题命名。自动执行绝不会使用隐藏 transcript。

在把已实现 Issue 交给人工审查前，其绑定 Session 会调用一个独立 Reviewer Agent，审查 Issue branch 相对 Base Branch 的改动。Patrol Agent 会修正必须处理的问题、重新运行相关验证，并在交接前创建包含结果的 commit。

Reviewer 会复用 Patrol Policy 选定的 Agent Preset、模型和推理强度，但其有效沙箱模式固定为 `read-only`，审批策略固定为 `never`。它只能向已绑定 Session 返回持久审查意见，不能编辑文件、创建 commit 或变更 Issue 状态。Reviewer 权限是固定安全约束，而不是另一项用户可配置预设。

工具权限审批与 Issue 审查是两种不同决策。无人值守的 Patrol Agent 绝不会等待工具权限审批：它会拒绝请求的操作、保留 Session 绑定、记录原因，并把 Issue 移至 `blocked`。以这种方式受阻的候选不会占用本轮的成功执行名额，因此本轮可以继续寻找另一个符合条件的 `todo` Issue。

完成规定的审查、修正和 commit 后，Patrol Agent 会把已实现 Issue 移至 `in_review`，交给用户人工审查。人工审查不属于 `blocked`，Patrol 也不会认领 `in_review` Issue。

人工审查通过后，Issue 会从 `in_review` 转为 `done`。退回审查时必须填写原因，将其记录到 Issue 历史，并把 Issue 退回 `todo`；后续 Patrol Run 会恢复既有 Session 绑定以处理该反馈。

人工审查通过不会把 Issue branch 合并到 Base Branch。Issue 进入 `done` 后，其 branch、worktree 和 commit 仍保持绑定并可见；代码集成仍属于用户显式持有的 Git 操作。

Patrol 不执行任何 Git 网络操作，也不创建 pull request：不会自动 fetch、pull、push、修改远端分支或 merge。第一版绝不自动清理已绑定 worktree。只有 worktree 干净，且结果 commit 已成为 Base Branch 的祖先时，用户才能显式移除 worktree；这一操作会保留 branch、Session、Issue 历史和 Patrol Run 历史。

Patrol Agent 会认领符合条件且要求修改仓库的 Issue 并执行其中工作，而不是只生成巡检报告。没有产生可提交 diff 的 Run 会把 Issue 转为 `blocked`。除被拒绝的工具权限审批外，任何实现、验证、Reviewer、commit、恢复、Provider、额度或限流失败都会记录原因，把当前 Issue 转为 `blocked`，并结束本轮，不进行 Patrol 层自动重试。已保存策略保持启用。

每个 Workspace 都有一项由其 Taskboard 控制的 Patrol Policy。该策略初始关闭，用户显式启用后使用默认一小时间隔。第一版只支持从 `5m`、`30m`、`1h`、`2h`、`6h`、`12h` 和 `24h` 中选择固定间隔，不接受 cron 表达式或固定钟点计划。启用的策略在巡检没有发现符合条件的 Issue 时仍保持启用，并在下一个间隔再次检查；只有用户显式变更才能将其关闭。

Patrol Policy 是宿主持有的持久定时任务。它会跨宿主重启保存启用状态和下次到期时间。宿主停止期间无法执行巡检；启动后，逾期策略会在所属 Workspace 就绪后执行一次、丢弃其他错过的触发，然后恢复原定间隔。

间隔使用固定节拍，而不是从上次完成时间重新延迟。保存新间隔时从保存时间计算下次到期；活动 Run 保持原执行。与活动工作重叠的到期触发会记录为已跳过，绝不排队。

活动轮次执行期间关闭 Patrol，会阻止之后的所有触发，但不会中止活动 Session。界面会显示 Patrol 将在本轮结束后停止；当本轮到达 `in_review` 或 `blocked` 后，策略才进入未启用状态。

Taskboard 顶栏还会提供“立即巡检”。即使固定间隔调度已关闭，它也会使用已保存策略启动一次 Patrol Run，且不会改变启用状态。已有其他 Run 活动时，该操作不可用；其结果会像定时触发一样持久化。

第一版不提供 Provider 额度感知暂停，因为 Harness Provider 没有统一的额度查询接口。Patrol Run 历史会保留 token 用量和 Provider 错误。额度或限流失败会记录原因、把当前 Issue 移至 `blocked` 并结束本轮，但不会关闭固定间隔策略；后续定时 Run 仍可处理其他符合条件的 Issue。

Patrol Policy 还会选择 Agent Preset、模型和推理强度，初始继承当前的新 Session 默认值。新建 Patrol Session 会在创建时记录这些已解析选择。后续策略变更只影响之后创建的 Session；已绑定 Issue 会使用其 Session 的既有配置恢复运行。

巡检权限复用现有 Permission Preset 选择器，而不是把沙箱模式和审批策略作为独立控件暴露。默认选中 Workspace Write。用户可以显式选择 Danger Full Access 或其他可用权限预设。新建 Patrol Session 会在创建时解析所选预设；已绑定 Session 恢复运行时保留其既有权限。

每次定时 Patrol Run 最多产生一次成功的 Review Handoff。工具权限审批导致已认领 Issue 转为 `blocked` 时不会占用该名额，因此本轮会继续处理下一个符合条件的 `todo`。已实现 Issue 转为 `in_review` 时会占用该名额并结束本轮。其他符合条件的 Issue 会留给后续运行，而不会组成批次。

整个 Host 同时最多只能有一次活动 Patrol Run，因此每个 Workspace 内也同样如此。任意 Workspace 已有活动 Run 时到达的定时触发都会记录 `skipped-global-busy`；既不启动并发工作，也不创建补跑队列。

每次定时触发都会创建持久 Patrol Run 记录，其中包含开始和结束时间、结果、错误，以及已认领 Issue、已绑定 Session 和最终 commit。空巡检、重叠触发跳过和权限受阻都会保留在历史中。Taskboard 会展示上次运行、下次到期时间和 Run 历史。没有符合条件 Issue 的触发只记录该结果，不会创建 Session。

宿主重启后，会先恢复未完成的 Patrol Run，再处理逾期或新的定时触发。恢复只会自动尝试一次，且必须恢复原绑定 Session 和 worktree。任一对象无法恢复时，宿主会记录原因，保留 Session、branch、worktree 和 Run 历史，把 Issue 移至 `blocked`，并且绝不会创建替代 Session。

Taskboard 是由宿主数据支持的永久 Workspace 产品界面，与拟议中的会话级声明式 [Task Surface](2026-08-04-task-surface.md) 无关。

实现交付会按以下顺序拆成可独立验证的 PR 或一组正式 stack：领域与 SQLite；Host Remote、CLI 与 skill；Dashboard、Board、List 与详情 UI；Gantt 与依赖；Patrol 调度；Git、Session 与权限；Reviewer 与人工审查；恢复、审计与最终验证。每个后续 PR 都会明确依赖前一层，在自身可合并点保持各 capability role 完整，并进入人工审查而不自动合并。

## 当前实现

前十二个 stack 层现已提供 Workspace 所属 Taskboard Service Definition、本地 SQLite Provider、Host Typert Remote、JSON `taskctl` 命令行、内置 `manage-taskboard` skill、浏览器 Dashboard、Board、List、Gantt 和 Issue 详情、持久 Patrol 状态、本地 Git 与准确 Session 执行、固定间隔协调、启动恢复、独立 Reviewer、人工审查控件、附件、Workspace 删除保护、完整 Dashboard 投影和审查导航。标准 Web Host 会把交互角色组装在一起，安装后的 `dsh` 包同时暴露 `dsh` 与 `taskctl` 可执行文件。Remote 与 CLI 覆盖 Workspace 元数据、Issue 生命周期与顺序、评论、活动记录、依赖、附件、Patrol 配置与历史、手工 Run 和 Issue 证据。Dashboard 会推导完成率、生命周期数量、逾期工作、14 天内到期工作和最新五条活跃 Issue 活动记录，并把每项摘要链接到对应的筛选 List。Remote 还会单独推导每个 Workspace 当前的 `todo` 数量，并把已提交的 Base Branch diff 作为审查证据暴露。Taskboard Host 消费方会注册保留数据守卫，因此任何活动或已归档 Issue 都会在不改变两类存储的前提下拒绝 Workspace 删除；把所有 Issue 移到另一个 Workspace 后，blocker 即消失。创建 Issue 和把 Issue 移入 Workspace 会与删除共享注册表变更队列，因此守卫能够看到并发写入。写操作成功后会发布经过错误隔离的 `taskboard/changed` 事件，让当前浏览器投影与侧边栏数量无需轮询即可刷新。

浏览器 UI 从每个 Workspace 行进入，在该行显示实时 `todo` 数量，以所选 Taskboard 替换对话中间区域，并复用现有右侧详情栏。已绑定的实现 Session 会导航回普通对话视图，人工审查则显示已提交的 Base Branch diff。视图、甘特图时间刻度与筛选偏好保存在浏览器存储中，权威 Issue 数据仍由 Host 持有。甘特图渲染器会在表格中保留未排期 Issue，在已排期条形之间绘制规范 `blocks` 连线，并只持久化被拖动 Issue 的日期而不产生级联变更。

每个已确保的 Taskboard 都持有默认关闭、间隔为 `1h` 且包含执行选项的 Patrol Policy。协调器会消费到期时间，只按手工顺序扫描 `todo`，并跳过用户指派、明确等待，以及未满足或尚未集成的依赖。永久 Development Context 会固定每个 Patrol Issue 的本地分支、worktree、准确 Session、Agent Preset、模型选择和 Permission Preset。实现 Agent 必须提交干净的 Base Branch diff。独立的持久 Reviewer 固定使用只读沙箱、`never` 审批策略和唯一结构化提交工具，并记录永久证据；原 Session 会收到该证据，执行一轮修正，再把 Issue 移至 `in_review`。一项审查交接会结束 Run，只有被拒绝的工具审批才允许阻塞当前 Issue 后继续扫描。Host 启动时会先记录恢复次数与时间，再恢复唯一未完成 Run。恢复会复用准确 Development Context 和已有 Reviewer 证据；Session 或 worktree 缺失或不匹配时，Attempt 与 Run 会原子地失败，Issue 被阻塞，原因被记录，并且绝不会创建替代对象。UI 会发现 Host 所属配置选项，显示永久 Run、Attempt、恢复、Session、Git 和审查证据，并把 `done` 与代码集成都留给用户。

## 版本一之后的计划

版本一只在本地运行，绝不会在 `deepseek-ai/deepseek-harness` 中创建、评论、更新或同步 Issue。后续交付按以下顺序推进：先增加显式选择加入的仓库绑定与凭据检查；再增加由用户发起的发布操作，创建一条 GitHub Issue，并保存永久的本地—远程身份映射与审计记录；随后增加具备冲突处理的元数据和评论导入或同步；最后再考虑从 Patrol 结果 commit 出发、单独授权的 Draft PR 发布。Patrol 不得自动发布 Issue，人工审查通过也绝不得自动合并代码。

## 考虑过的替代方案

**保留独立 Taskboard Project。**不采用，因为 Project 会重复 Workspace 身份，并要求用户和 agent 维护第二份指向同一目录及会话的映射。

**Workspace 删除级联删除 Taskboard 数据。**不采用，因为移除 Workspace 注册不应静默销毁持久工作历史、评论、附件或 agent 活动。

**只让巡检生成报告。**不采用，因为只检查而不认领和执行，无法完成从 Taskboard 到代码再到审核的产品闭环。

**没有符合条件的 Issue 时暂停巡检。**不采用，因为暂时没有工作不能撤销用户的持续授权，也不应要求用户在新增 Issue 后重新启用巡检。

**把宿主停止期间错过的每次触发全部排队。**不采用，因为回放已经过去的间隔会在重启时产生与当前 Taskboard 状态无关的执行洪峰。

**第一版支持 cron 或固定钟点计划。**不采用，因为所需的巡检行为是固定间隔，有限选项无需引入第二套调度模型即可提供所需控制。

**第一版支持重复 Issue。**不采用，因为自动生成 Issue 与 Patrol 执行组合后，需要额外定义生成、Session 绑定和终止策略，超出一次性 Issue 闭环。

**单独持久化 Dashboard 统计。**不采用，因为当前 Issue 和活动数据就是权威来源，足以推导所需总览。

**在 Workspace 导航之外创建全局 Taskboard 页面。**不采用，因为 Taskboard 身份和数据所有权都限定于 Workspace，而现有侧边栏已经提供权威 Workspace 层级。

**在弹窗中打开 Issue 详情。**不采用，因为现有详情栏可以在保留看板位置和筛选条件的同时，提供产品既有的次级查看界面。

**把 Dashi 独立后端复制到 Harness。**不采用，因为这会绕过 Harness 已经提供的 Workspace、Session、权限、Remote 和插件所有权。

**把 Taskboard 记录存进 `storage-domain`。**不采用，因为它的单记录 KV 操作无法为 Issue 认领、关系、评论和 Patrol Run 状态提供跨表事务或二级索引。

**把 Taskboard 数据存进各项目仓库。**不采用，因为 Taskboard 元数据和附件属于 Host 产品状态，不应污染或改动用户源码树。

**通过模型编写的 `taskctl` 调用驱动 Patrol 认领。**不采用，因为 Host 已经持有调度与并发，关键认领和绑定事务不应依赖提示词遵循程度。

**为每次定时触发创建 Session。**不采用，因为空触发或跳过触发没有 Agent 工作和 transcript；其持久 Patrol Run 记录就是权威审计结果。

**崩溃后替换无法恢复的 Patrol Session。**不采用，因为替代 Session 可能重复未知副作用，也会违反 Issue 的持久 Session 所有权。

**关闭 Patrol 时中止活动 Session。**不采用，因为立即取消可能遗留未提交文件，并让 Issue 无法得到可靠的交接或阻塞结果。

**要求先启用定时 Patrol 才能手动运行。**不采用，因为显式的一次性操作已经构成单次 Run 授权，且不能静默建立持续授权。

**第一版复刻 Dashi 的 Codex 账户额度暂停。**不采用，因为 Harness 支持不同 Provider，而它们没有共同的权威额度服务。

**人工审查通过时自动合并 Issue branch。**不采用，因为 Base Branch 漂移、冲突和用户活动 checkout 都要求在无人值守 Patrol 执行之外进行显式 Git 集成决策。

**仅以 `done` 状态满足代码依赖。**不采用，因为否则从 Base Branch 创建的后继 worktree 会缺少尚未集成的已接受前置 commit。

**排队或并行运行重叠的 Patrol Run。**不采用，因为并发 agent 会修改同一个 Workspace，而补跑队列会把一次暂时缓慢的运行变成无界执行积压。

**分别配置沙箱模式和审批策略。**不采用，因为 Harness 已通过 Permission Preset 持有二者的有效组合和展示方式。巡检不应建立第二套权限模型。

**用 `blocked` 表示人工审查。**不采用，因为 `in_review` 已表示等待用户决策的工作，而 `blocked` 表示无法继续的工作。

**按优先级自动排列 Patrol 工作。**不采用，因为用户已经可以通过调整 `todo` 列直接控制执行顺序，静默重排会让下一次认领更难预测。

**让 Patrol 认领分配给 `User` 的工作。**不采用，因为分配是显式的所有权决定，无人值守自动化不应静默接管人工工作。

**让 Patrol 直接在用户当前 checkout 中执行。**不采用，因为自动代码修改和 commit 可能包含无关的用户工作，或干扰交互式 Session。

**认领前 fetch 或 pull Base Branch。**不采用，因为本地定时执行不应在缺少另一项显式授权时变更或依赖远程仓库状态。

**自动调整有依赖关系的 Issue 排期。**不采用，因为依赖关系表达的是执行约束，而 Issue 日期仍属于用户显式持有的计划。

**不填写原因就退回审查。**不采用，因为已绑定 Session 需要持久且对模型可见的反馈，才能明确下一轮必须修改的内容。

**让实现 Agent 执行规定的自我审查。**不采用，因为独立 Reviewer 可以在不接管实现或状态变更的前提下，在人工审查前提供一份独立判断。

**让 Reviewer 继承 Patrol 写权限。**不采用，因为 Reviewer 只负责评价；允许它修改实现会抹去审查意见与修正之间的职责分离。

## 验收标准

- 每个已注册 Workspace 都会提供一个 Taskboard，无需单独创建 Project。
- 每个 Workspace 侧边栏行都会在中间区域打开其 Taskboard，其中 Dashboard、Board、List、Gantt 和 Patrol 控件都限定于该 Workspace；打开已绑定 Session 时会返回对应会话。
- 选择 Issue 会使用右侧详情栏而不丢失 Taskboard 状态，并在窄布局下用同一详情界面全屏显示。
- 改造后的 Dashi 前端文件会保留 Apache-2.0 归属与修改声明，`dhtmlx-gantt` 会作为 MIT 依赖记录，并且不会把独立 Dashi 后端或 Codex 自动化桥带入 Harness runtime。
- 本地 SQLite Provider 会在 Harness 持久化根目录中保存按 Workspace 划分的 Taskboard 记录，把附件字节放入相邻受管目录，并保持 Workspace 仓库不变。
- `taskctl`、内置 `manage-taskboard` skill、UI 和交互式 Agent 会共享 Taskboard Service，而 Patrol 认领与生命周期事务会直接通过 Host 执行，不采用模型编写的 CLI 调用。
- Issue 可以通过显式用户操作在 Workspace 之间移动或归档、恢复，但第一版绝不永久删除 Issue、评论、活动记录或 Patrol Run。
- 仍有任何活动或已归档 Issue 时，Workspace 删除会返回可操作的失败结果；只有全部 Issue 都已移到其他 Workspace 后才能删除。
- 本地产品基于同一组持久 Issue 提供看板、列表和甘特图，并在宿主重启后保留其评论、关系、附件及会话绑定。
- Dashboard 会从权威 Issue 数据推导生命周期数量、完成进度、逾期和即将到期工作及最近活动，并把每项摘要链接到筛选视图。
- 甘特图会在表格中保留未排期 Issue，只为同时具有两个日期的 Issue 绘制时间条，保存拖动和缩放修改，并在不自动改期的前提下显示依赖连线。
- 第一版绝不会根据重复规则创建后继 Issue。
- 第一版绝不会在 `deepseek-ai/deepseek-harness` 中创建 GitHub Issue 或把 Taskboard Issue 同步到该仓库。
- 每个 Issue 都有且仅有七种已定义生命周期状态之一。
- 新建 Issue 默认进入 `backlog`；直接创建或移动到 `todo` 就是无人值守执行的显式授权。
- Issue 标识采用不可变且唯一的 Workspace 前缀和 Workspace 内单调递增编号；前缀只能在第一个 Issue 创建前修改。
- 把 `in_review`、`blocked` 或 `done` 退回 `todo` 时必须持久记录原因，并保留原 Session 和 Development Context 绑定。
- Patrol Run 只会把 `todo` Issue 作为新的认领候选。
- Patrol 只会认领 `Unassigned` 或 `Patrol Agent` Issue，绝不会认领 `User` Issue，并在认领后同时记录 Patrol Agent 分配与具体 Session 绑定。
- 任意 `blocked_by` 前置 Issue 不为 `done`，或其结果 commit 不是当前 Base Branch 的祖先时，Patrol Run 都会拒绝该 `todo` Issue；界面会把后者区分为“等待代码集成”。
- Patrol Run 会按看板人工顺序扫描 `todo`、跳过明确的等待指令，而且绝不会让优先级覆盖该顺序。
- 针对所选 Issue 的“立即执行”会绕过看板顺序，但不会绕过其他资格或安全规则，也不会启用固定间隔调度。
- 对于被退回 `todo` 的 Issue，Patrol Agent 会恢复已绑定 Session；只有未绑定 Issue 才会创建 Session。
- Patrol 会在执行未绑定 Issue 前创建并绑定专属 Git branch 和 worktree，让其随 Session 一同复用；无法建立隔离环境时会把 Issue 转为 `blocked`，而不是写入 Workspace 根目录。
- Patrol Policy 在启用时预选当前本地分支作为 Base Branch，允许改选其他本地分支，只让未来未绑定 Issue 从其本地 tip 创建上下文，并且不会自动 fetch 或 pull。
- Patrol 创建的 Session 会在宿主重启后保留，出现在所属 Workspace 的 Session 列表中，并公开完整 transcript。
- 人工审查开始前，一个独立 Reviewer 会审查 Issue branch 相对 Base Branch 的改动，随后 Patrol Agent 会修正必须处理的问题、重新验证，并提交由此产生的工作。
- Reviewer 在固定 `read-only` 沙箱与 `never` 审批设置下使用 Patrol Agent Preset、模型和推理强度，且不能修改 worktree、Git 状态或 Issue。
- 无人值守的 Patrol 工作遇到工具权限审批时绝不会等待：请求的操作会被拒绝，原因会被记录，Issue 会转为 `blocked` 并保留 Session 绑定。
- 已实现并提交的 Issue 会转为 `in_review` 而非 `blocked`，等待人工审查期间不会被 Patrol 认领。
- 人工审查通过会把 Issue 转为 `done`；退回时必须记录原因、把 Issue 退回 `todo`，并让后续 Patrol 工作恢复其已绑定 Session。
- 人工审查通过不会合并或移除 Issue 的 branch 和 worktree；Taskboard 会保留其持久 commit 与 Development Context 链接。
- Patrol 不执行 fetch、pull、push、创建 pull request、merge 或自动移除 worktree。手动移除 worktree 要求其干净，且结果 commit 已集成到 Base Branch。
- 没有可提交仓库 diff 的 Patrol Issue 会转为 `blocked`；任何非审批失败都会使其转为 `blocked` 并结束本轮，不进行自动重试。
- 已启用的 Patrol Agent 可以认领符合条件的 Issue，在所属 Workspace 中执行请求的工作，并将结果提交给用户审核。
- 新注册的 Workspace 在用户显式启用其策略前不会执行任何 Patrol Agent 工作；初始间隔为一小时。
- 第一版的巡检间隔配置只提供 `5m`、`30m`、`1h`、`2h`、`6h`、`12h` 和 `24h`，默认选中 `1h`。
- 巡检启用状态和下次到期时间会在宿主重启后保留；逾期策略会在启动后执行一次，而不会回放每个错过的间隔。
- 活动轮次期间关闭 Patrol 会阻止后续触发，让本轮完成到 `in_review` 或 `blocked`，并在界面中展示待关闭状态。
- “立即巡检”会使用已保存策略启动一次持久 Run，不启用后续调度，并且在已有活动 Run 时不可用。
- Patrol Run 历史会记录 token 用量和 Provider 错误；额度或限流失败会把当前 Issue 转为 `blocked`，但不关闭策略，且第一版不执行额度感知暂停。
- 巡检设置会提供 Agent Preset、模型和推理强度，并预选新 Session 默认值；后续修改不会重新配置已绑定 Session。
- 巡检设置会复用 Permission Preset，预选 Workspace Write，允许用户显式选择 Danger Full Access 或其他可用预设，并且只把后续修改应用于之后创建的 Session。
- 一次 Patrol Run 最多把一个 Issue 移至 `in_review`；只有前一个已认领 Issue 因工具权限审批转为 `blocked` 后，本轮才可以继续认领另一个 Issue。
- 整个 Host 在所有 Workspace 中最多只有一次活动 Patrol Run；重叠触发会记录 `skipped-global-busy`，且不产生排队运行。
- 每次定时触发都有持久且可见的 Patrol Run 结果，但空触发或跳过触发不会创建 Session。
- 宿主重启会记录恢复次数与时间，在新触发前恢复未完成 Run，只尝试一次恢复原 Session 和 worktree，复用已有 Reviewer 证据；无法恢复时会把 Issue 转为 `blocked`，且不创建替代对象。
- 附件单文件不超过 25 MB，图片可预览，只通过受控 Host 路由下载，并且必须显式确认才能删除；评论和活动只能追加。
- 右侧详情栏中的人工审查会展示 commit、Base Branch diff、Reviewer 意见、验证、风险及“通过”和“退回”操作；通知只存在于应用内。

## 风险

Taskboard 生命周期与 Workspace 生命周期绑定后，Workspace 删除会有意变得更严格。因为不能永久删除 Issue，拒绝路径必须让用户可以方便地把全部活动和已归档 Issue 移到另一个 Workspace。

自动执行可能在没有同时发生的用户提示时消耗模型额度并修改项目文件。默认关闭、Host 全局单 Run、专属 worktree、Permission Preset、显式状态转换和持久结果可以约束这一风险，但 Danger Full Access 仍是用户主动选择的高影响权限。
