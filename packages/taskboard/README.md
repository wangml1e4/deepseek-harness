# taskboard/ — Workspace Taskboard family

English | [中文](README.zh.md)

This family owns durable Workspace Issues, their manual board order, append-only comments and activity, and directed dependencies.

| Package | Role | ctx key |
|---|---|---|
| [`taskboard/`](taskboard/README.md) | Declares Taskboard values, failures, and the Service Definition | `ctx.taskboard` |
| [`taskboard-sqlite/`](taskboard-sqlite/README.md) | Persists the service in one Host-owned SQLite database | provides `ctx.taskboard` |

The [Workspace Taskboard Agent Note](../../.agents/notes/proposed/feature/2026-08-15-workspace-taskboard.md) owns product behavior, Patrol policy, and the staged delivery decision.
