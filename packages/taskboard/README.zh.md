# taskboard/：Workspace Taskboard 家族

[English](README.md) | 中文

本家族拥有持久化的 Workspace Issue、手动看板顺序、仅追加的评论与活动记录、有向依赖关系，以及交互式消费方使用的 Host 接口。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`taskboard/`](taskboard/README.md) | 声明 Taskboard 值、失败类型和 Service Definition | `ctx.taskboard` |
| [`taskboard-sqlite/`](taskboard-sqlite/README.md) | 在一份 Host 所属的 SQLite 数据库中持久化该服务 | 提供 `ctx.taskboard` |
| [`taskboard-remote/`](taskboard-remote/README.md) | 通过 Host Typert API 暴露 Taskboard 操作 | `ctx.taskboardRemote` |
| [`taskctl/`](taskctl/README.md) | 提供机器可读的 Taskboard 命令行 | 二进制消费方 |
| [`skill-manage-taskboard/`](skill-manage-taskboard/README.md) | 注册内置交互式 Taskboard 工作流 | `ctx.skills` 提供方 |
| [`../client/ui-taskboard/`](../client/ui-taskboard/README.md) | 在浏览器中展示 Dashboard、Board、List 和 Issue 详情 | UI 消费方 |

标准 Web Host 会挂载 SQLite Provider、Remote 与 UI 消费方和内置 skill。[Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md)负责产品行为、Patrol policy 和分阶段交付决策。
