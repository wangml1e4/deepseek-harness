# @deepseek-ai/dsh-taskboard-sqlite

[English](README.md) | 中文

`ctx.taskboard` 的本地 SQLite Service Provider。它在一份 Host 所属数据库中存储所有 Workspace 分区，并将 Taskboard 数据保留在用户仓库之外。

## 配置与持久性

- `path` 是 SQLite 文件名，测试可使用 `:memory:`。提供方以仅所有者可访问的权限创建父目录，并以 `0600` 模式创建缺失的数据库文件。
- `journalMode` 默认为 `wal`，`busyTimeoutMs` 默认为 5000。外键保持启用。
- 数据库带固定 application id 和单调 schema 版本。存在内容但未标版本的数据库、外来 application id 或任何不支持的版本都会在服务初始化时失败。
- Issue 变更、版本更新、活动记录以及退回时必需的评论在同一事务中提交。评论和活动记录的序列列即使在时间戳相同时也能保持追加顺序。
- Workspace 标签记录通过有序的 Issue-label 行复用；Issue 读取仅暴露稳定的标签名称列表。
- 每个 Taskboard 事务都会创建默认关闭且间隔为 `1h` 的 Patrol Policy。Policy 保存、固定节拍推进、全局活跃 Run 预留、定时重叠结果与终态 Run 历史都在事务中完成，并在 Host 重启后继续保留。
- Patrol Run 行没有删除操作。部分唯一索引保证即使多个调度调用方竞争，所有 Workspace 中仍最多只有一个活跃 Run。

该提供方供应 `TaskboardService`；消费方依赖 [`@deepseek-ai/dsh-taskboard`](../taskboard/README.md)，绝不依赖本包。

## 模型体验

间接影响：由 Taskboard 消费方选择进入模型上下文的持久记录。

#### KV Cache 影响

与模型请求无关，因为持久化绝不改变请求前缀。

## 已知限制与暂缓事项

- 该提供方是单 Host 本地存储，不与 GitHub Issues、Dashi 数据库或云协作服务同步。
- 预发布 schema 变更会拒绝旧数据库版本而不做迁移；首个带标签版本将建立兼容性策略。
