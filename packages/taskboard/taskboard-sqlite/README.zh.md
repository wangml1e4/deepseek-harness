# @deepseek-ai/dsh-taskboard-sqlite

[English](README.md) | 中文

`ctx.taskboard` 的本地 SQLite Service Provider。它在一份 Host 所属数据库中存储所有 Workspace 分区，并将 Taskboard 数据保留在用户仓库之外。

## 配置与持久性

- `path` 是 SQLite 文件名，测试可使用 `:memory:`。提供方以仅所有者可访问的权限创建父目录，并以 `0600` 模式创建缺失的数据库文件。
- `attachmentsPath` 选择仅所有者可访问的受管字节目录。文件数据库默认使用 `<path>.attachments`；使用 `:memory:` 时，必须先提供该选项才能执行附件操作。不透明附件 id 是唯一的受管文件名，因此原始文件名绝不参与路径解析。
- `journalMode` 默认为 `wal`，`busyTimeoutMs` 默认为 5000。外键保持启用。
- 数据库带固定 application id 和单调 schema 版本。存在内容但未标版本的数据库、外来 application id 或任何不支持的版本都会在服务初始化时失败。
- Issue 变更、版本更新、活动记录以及退回时必需的评论在同一事务中提交。评论和活动记录的序列列即使在时间戳相同时也能保持追加顺序。
- Workspace 活动记录读取会关联当前活跃 Issue 分区，并按全局活动序列从新到旧返回；归档只会从该投影中隐藏保留的 Issue 历史。
- Workspace 标签记录通过有序的 Issue-label 行复用；Issue 读取仅暴露稳定的标签名称列表。
- 每个 Taskboard 事务都会创建默认关闭、间隔为 `1h`、权限为 `workspace-write` 的 Patrol Policy。Policy 执行选项、固定节拍推进、全局活跃 Run 预留、定时重叠结果、按顺序排列的 Issue Attempt、Development Context 绑定与终态历史都在事务中完成，并在 Host 重启后继续保留。
- Patrol Run 行没有删除操作。部分唯一索引保证即使多个调度调用方竞争，所有 Workspace 中仍最多只有一个活跃 Run。
- 部分唯一索引会限制每个 Run 和每个 Issue 最多只有一个活跃 Attempt。领取、生命周期、阻塞 Comment、Activity、Session 绑定和结果 commit 写入会与其权威 Issue 变更处于同一个 SQLite 事务中。
- 独立 Reviewer 证据仅可追加。唯一 Attempt 引用会阻止重复审查，外键则保留所属 Attempt、Issue 和 Reviewer Session 身份。
- 附件元数据在 SQLite 中有序并以事务方式保存，字节则位于数据库相邻目录，绝不进入 Workspace。上传会先使用仅所有者可访问的独占临时文件和原子重命名，再提交元数据；确认删除会先隔离字节，再提交元数据移除。两种操作都会推进 Issue 版本并保留活动证据。

该提供方供应 `TaskboardService`；消费方依赖 [`@deepseek-ai/dsh-taskboard`](../taskboard/README.md)，绝不依赖本包。

## 模型体验

间接影响：由 Taskboard 消费方选择进入模型上下文的持久记录。

#### KV Cache 影响

与模型请求无关，因为持久化绝不改变请求前缀。

## 已知限制与暂缓事项

- 该提供方是单 Host 本地存储，不与 GitHub Issues、Dashi 数据库或云协作服务同步。
- 预发布 schema 变更会拒绝旧数据库版本而不做迁移；首个带标签版本将建立兼容性策略。
