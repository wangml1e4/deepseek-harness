# @deepseek-ai/dsh-taskboard-remote

English | [中文](README.zh.md)

The Host Remote Consumer for the Workspace-owned Taskboard capability. It exposes the Taskboard Service through Typert RPC while keeping the Host's Workspace registry authoritative.

## Remote methods

The `taskboard` namespace provides `workspace`, `setPrefix`, `listIssues`, `getIssue`, `createIssue`, `updateIssue`, `moveIssue`, `archiveIssue`, `restoreIssue`, `listComments`, `addComment`, `listActivities`, `listWorkspaceRelations`, `listRelations`, `addRelation`, and `removeRelation`.

Workspace-scoped methods reject unknown Workspace ids before touching Taskboard state. Reads that need the implicit Taskboard ensure it from the current registered Workspace title. Moving an Issue also verifies and ensures the destination Workspace.

Every method returns `TaskboardRemoteResult<T>`. Domain failures remain stable business results with `TaskboardError.code`; malformed requests fail in the generated Typert carrier, and infrastructure failures reject instead of being mislabeled as domain errors. `getIssue` uses an explicit nullable value so a missing Issue is distinct from a failed call.

The generated `./remote` entry is mounted by [`@deepseek-ai/dsh-api-remotes`](../../api/remotes/README.md) for browser Consumers. The Web Host mounts this package beside the Taskboard Service Definition and SQLite Provider.

## Model Experience

None, as the Remote transports Taskboard operations without adding model-visible instructions or tools.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

- `taskboard/changed` is forwarded by the browser API assembly for active-Workspace invalidation; the event carries no Issue payload.
- Attachments, Session and Git bindings, Patrol policy and Run history, and review evidence are not in this protocol layer yet.
- The Remote is a Host-local application API; it does not publish or synchronize GitHub Issues.
