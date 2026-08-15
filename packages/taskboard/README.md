# taskboard/ — Workspace Taskboard family

English | [中文](README.zh.md)

This family owns durable Workspace Issues, their manual board order, append-only comments and activity, directed dependencies, and the Host interfaces used by interactive Consumers.

| Package | Role | ctx key |
|---|---|---|
| [`taskboard/`](taskboard/README.md) | Declares Taskboard values, failures, and the Service Definition | `ctx.taskboard` |
| [`taskboard-sqlite/`](taskboard-sqlite/README.md) | Persists the service in one Host-owned SQLite database | provides `ctx.taskboard` |
| [`taskboard-remote/`](taskboard-remote/README.md) | Exposes Taskboard operations through the Host Typert API | `ctx.taskboardRemote` |
| [`taskctl/`](taskctl/README.md) | Provides the machine-readable Taskboard command line | binary Consumer |
| [`skill-manage-taskboard/`](skill-manage-taskboard/README.md) | Registers the bundled interactive Taskboard workflow | `ctx.skills` Provider |

The standard Web Host mounts the SQLite Provider, Remote Consumer, and bundled skill. The [Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md) owns product behavior, Patrol policy, and the staged delivery decision.
