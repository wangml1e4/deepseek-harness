# @deepseek-ai/dsh-taskboard-sqlite

English | [中文](README.zh.md)

The local SQLite Service Provider for `ctx.taskboard`. It stores every Workspace partition in one Host-owned database and keeps Taskboard data outside user repositories.

## Configuration and durability

- `path` is the SQLite filename or `:memory:` for tests. The provider creates parent directories with owner-only permissions and creates a missing database file as mode `0600`.
- `journalMode` defaults to `wal`; `busyTimeoutMs` defaults to 5000. Foreign keys remain enabled.
- The database carries a fixed application id and monotonic schema version. A populated unversioned database, a foreign application id, or any unsupported version fails during service initialization.
- Issue mutations, version updates, Activity entries, and required return Comments commit in the same transaction. Comment and Activity sequence columns preserve append order even when timestamps match.
- Workspace Label records are reused through ordered Issue-label rows; Issue reads expose only their stable label-name list.
- Each Taskboard transaction creates its default-off `1h` Patrol Policy with `workspace-write` permission. Policy execution choices, cadence advancement, global active-Run reservation, scheduled-overlap results, ordered Issue Attempts, Development Context bindings, and terminal history remain transactional and durable across Host restarts.
- Patrol Run rows have no deletion operation. A partial unique index enforces one active Run across every Workspace even if multiple scheduling callers race.
- Partial unique indexes allow one active Attempt per Run and per Issue. Claim, lifecycle, blocker Comment, Activity, Session binding, and result-commit writes share the same SQLite transaction as their authoritative Issue mutation.

The provider supplies `TaskboardService`; Consumers depend on [`@deepseek-ai/dsh-taskboard`](../taskboard/README.md), never this package.

## Model Experience

Indirectly, through Taskboard Consumers that select persisted records for model context.

#### KV Cache effect

Independent of model requests because persistence never changes a request prefix.

## Known Limitations and Deferred Work

- The provider is a single-Host local store and does not synchronize with GitHub Issues, Dashi databases, or cloud collaboration services.
- Pre-release schema changes reject older database versions instead of migrating them; the first tagged release will establish the compatibility policy.
