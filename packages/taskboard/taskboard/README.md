# @deepseek-ai/dsh-taskboard

English | [中文](README.zh.md)

The Workspace-owned Taskboard Service Definition. `ctx.taskboard` exposes durable Taskboard metadata, Issues, comments, activity, and dependency relations without exposing a provider's storage format.

## Service semantics

- `ensureWorkspace` creates one implicit Taskboard per `WorkspaceId`; the derived unique prefix may change only before the first Issue, then remains frozen.
- Issue identifiers remain stable when an Issue moves between Workspaces, and moving to its current Workspace is a no-op. New Issues default to `backlog`; explicitly creating or moving one to `todo` authorizes later Patrol Consumers.
- Active Issue lists follow stored board order. Priority is display and filter metadata and never changes execution order.
- Competing Issue mutations require `expectedVersion`. Returning `in_review`, `blocked`, or `done` work to `todo` also requires a reason, which becomes an append-only Comment.
- An update that changes no field is a no-op. Archiving is reversible, repeated archive attempts reject, and the service has no permanent Issue deletion operation. Comments and Activity entries are append-only.
- Activity and Comment actors distinguish User, Patrol Agent, Reviewer, and System responsibility.
- A dependency is one directed edge presented as `blocks` from its source and `blocked_by` from its target. Self, duplicate, cross-Workspace, and cyclic dependencies reject without mutation.

Stable failures use `TaskboardError.code`; providers preserve the codes declared by this package. The [Taskboard subsystem reference](../../../docs/subsystems/taskboard.md) owns the public value and service reference.

## Model Experience

Indirectly, through Taskboard Consumers that select records for model context.

#### KV Cache effect

Independent of model requests because this package never changes request content.

## Known Limitations and Deferred Work

- The first domain layer does not expose attachments, Session or Git bindings, Patrol policies, Patrol Runs, or review evidence; later Taskboard packages add those records through the same service.
- Taskboard creation is implicit but Workspace deletion protection is installed by the later Workspace Consumer; this package alone cannot intercept Workspace removal.
