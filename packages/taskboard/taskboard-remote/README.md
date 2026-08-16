# @deepseek-ai/dsh-taskboard-remote

English | [中文](README.zh.md)

The Host Remote Consumer for the Workspace-owned Taskboard capability. It exposes the Taskboard Service through Typert RPC while keeping the Host's Workspace registry authoritative.

## Remote methods

The `taskboard` namespace provides Workspace metadata, Issue lifecycle, Comments, per-Issue and Workspace Activity, attachments, relations, and five Patrol operations: `patrol`, `updatePatrol`, `runPatrol`, `patrolIssue`, and `removePatrolWorktree`. `todoCount` derives one Workspace's current `todo` count without returning Issue records, while `listWorkspaceActivities` validates the registered Workspace before returning newest-first Activity for its active Issues.

Attachment metadata is listed separately from bytes. Upload and read methods carry canonical base64 through the controlled Host namespace, enforce the 25 MB limit before persistence, scope every read to its owning Issue, and never return the managed filesystem path. Deletion delegates explicit confirmation and optimistic version validation to the Taskboard Service.

Workspace-scoped methods reject unknown Workspace ids before touching Taskboard state. Reads that need the implicit Taskboard ensure it from the current registered Workspace title. Moving an Issue also verifies and ensures the destination Workspace.

While this Host Consumer is mounted, it registers a Workspace deletion guard. Any active or archived Issue returns the `taskboard-issues` blocker with the exact retained count; moving every Issue to another Workspace removes the blocker. Issue creation and movement into a Workspace use the registry mutation queue, so a concurrent deletion observes the completed write before its guard runs. The check never deletes or rewrites Taskboard data.

Every method returns `TaskboardRemoteResult<T>`. Domain failures remain stable business results with `TaskboardError.code`; malformed requests fail in the generated Typert carrier, and infrastructure failures reject instead of being mislabeled as domain errors. `getIssue` uses an explicit nullable value so a missing Issue is distinct from a failed call.

`patrol` combines the saved Policy, current Host choices, and permanent Run/Attempt history. `updatePatrol` delegates Host-owned selection validation to the Patrol Consumer, and `runPatrol` starts one manual background Run. `patrolIssue` returns the permanent Development Context, current physical-worktree presence, bounded Base Branch diff for its result commit, and independent Reviewer evidence for the details sidebar. `removePatrolWorktree` delegates explicit confirmation and the clean-and-integrated checks to the Patrol Consumer, then returns the preserved branch, path, and result-commit identities.

The generated `./remote` entry is mounted by [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.md) for browser Consumers. The Web Host mounts this package beside the Taskboard Service Definition and SQLite Provider.

## Model Experience

None, as the Remote transports Taskboard operations without adding model-visible instructions or tools.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

- `taskboard/changed` is forwarded by the browser API assembly for active-Workspace invalidation; the event carries no Issue payload.
- The Remote is a Host-local application API; it does not publish or synchronize GitHub Issues.
