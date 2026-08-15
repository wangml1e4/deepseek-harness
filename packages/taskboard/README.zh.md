# taskboard/：Workspace Taskboard 家族

[English](README.md) | 中文

本家族拥有持久化的 Workspace Issue、手动看板顺序、仅追加的评论与活动记录，以及有向依赖关系。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`taskboard/`](taskboard/README.md) | 声明 Taskboard 值、失败类型和 Service Definition | `ctx.taskboard` |
| [`taskboard-sqlite/`](taskboard-sqlite/README.md) | 在一份 Host 所属的 SQLite 数据库中持久化该服务 | 提供 `ctx.taskboard` |

[Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md)负责产品行为、Patrol 策略和分阶段交付决策。
