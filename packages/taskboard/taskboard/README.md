# @deepseek-ai/dsh-taskboard

English | [中文](README.zh.md)

The Workspace-owned Taskboard Service Definition. `ctx.taskboard` exposes durable Taskboard metadata, Issues, comments, activity, attachments, dependency relations, Patrol Policies, and Patrol Runs without exposing a provider's storage format.

## Service semantics

- `ensureWorkspace` creates one implicit Taskboard per `WorkspaceId`; the derived unique prefix may change only before the first Issue, then remains frozen.
- Issue identifiers remain stable when an Issue moves between Workspaces, and moving to its current Workspace is a no-op. New Issues default to `backlog`; explicitly creating or moving one to `todo` authorizes later Patrol Consumers.
- Active Issue lists follow stored board order. Priority is display and filter metadata and never changes execution order.
- Competing Issue mutations require `expectedVersion`. Returning `in_review`, `blocked`, or `done` work to `todo` also requires a reason, which becomes an append-only Comment.
- An update that changes no field is a no-op. Archiving is reversible, repeated archive attempts reject, and the service has no permanent Issue deletion operation. Comments and Activity entries are append-only.
- Activity and Comment actors distinguish User, Patrol Agent, Reviewer, and System responsibility.
- Attachments accept unrestricted file types up to 25 MB. Metadata reads never expose Provider paths; content reads require both the owning Issue and opaque attachment id. Upload and explicitly confirmed deletion advance the Issue version and append Activity, while all other Issue, Comment, Activity, and Patrol records retain their no-delete rules.
- A dependency is one directed edge presented as `blocks` from its source and `blocked_by` from its target. Self, duplicate, cross-Workspace, and cyclic dependencies reject without mutation.
- `listWorkspaceRelations` returns each Workspace dependency once as a canonical `blocks` view for timeline Consumers; `listRelations` retains the requested Issue-relative direction for details.
- Every Taskboard starts with Patrol disabled, `1h` selected, `workspace-write` permission, and nullable new-Session choices. Policy updates accept only `5m`, `30m`, `1h`, `2h`, `6h`, `12h`, or `24h`; enabling requires a local Base Branch, enabling or changing the interval schedules from the save instant, while disabling clears `nextDueAt` without aborting an active Run.
- A scheduled trigger consumes one due instant and advances from the prior cadence past the current time, so Host downtime never creates a catch-up queue. Manual triggers may run while the policy is disabled.
- At most one Patrol Run can remain active across the Host. A scheduled overlap becomes a permanent `skipped_global_busy` history entry; a manual overlap rejects as busy. Run completion is append-like and cannot overwrite a terminal result.
- Startup recovery locates that Host-wide active Run independently of Workspace registration. Each recovery attempt increments `recoveryCount` and saves `lastRecoveredAt`; an unrecoverable active Attempt is atomically completed as failed with its Run while the Issue moves to `blocked` and retains an attributed reason.
- A Run owns ordered `PatrolAttempt` claims. Claiming atomically validates `todo`, assignment, Run ownership, optimistic version, predecessor `done` state, and exact predecessor commit snapshots before moving the Issue to `in_progress`. Only a preceding `permission_blocked` Attempt permits the same Run to claim again.
- Each Patrol-executed Issue owns at most one `PatrolDevelopmentContext`. Its exact Session id, Base Branch, branch, worktree, Agent Preset, model selection, and Permission Preset survive every later return to `todo`; first Session persistence is recorded separately from id reservation, and a review handoff records its result commit. Neither binding nor Attempt history has a deletion operation.
- Each active Attempt accepts one durable `PatrolReview` from a distinct Reviewer Session. The record fixes the reviewed preliminary commit, verdict, findings, verification evidence, risks, and completion time; a second review for the same Attempt rejects and review history has no deletion operation.

Stable failures use `TaskboardError.code`; providers preserve the codes declared by this package. The [Taskboard subsystem reference](../../../docs/subsystems/taskboard.md) owns the public value and service reference.

## Model Experience

Indirectly, through Taskboard Consumers that select records for model context.

#### KV Cache effect

Independent of model requests because this package never changes request content.

## Known Limitations and Deferred Work

- This package owns durable scheduling, claim, binding, review, and lifecycle operations but never starts work by itself; the Patrol Consumer owns timer and Agent orchestration.
- Taskboard creation is implicit but Workspace deletion protection is installed by the later Workspace Consumer; this package alone cannot intercept Workspace removal.
- Version one stores Issues locally and never publishes or synchronizes them with `deepseek-ai/deepseek-harness` GitHub Issues.
