# @deepseek-ai/dsh-client-ui-taskboard

English | [中文](README.zh.md)

Browser Consumer for each Workspace's implicit Taskboard. A compact action in every real Workspace row opens a Taskboard as an alternate center surface; selecting an Issue opens its editable record in the existing right details column. Returning to a Session restores the ordinary conversation surface.

The center surface provides Dashboard, Board, and List views over one shared `TaskboardController` snapshot. Dashboard derives completion, active, overdue, status, priority, and recent-work summaries from the current Issue list. Board renders the seven lifecycle columns and persists drag moves through optimistic Issue versions. List groups the same Issues by lifecycle status. Search, status, priority, and label filters apply consistently to every view, and the selected view and filters persist in browser storage under `dsh.taskboard.view.v1`.

The details surface edits title, Markdown description, status, priority, assignee, labels, and day-granularity dates. It lists append-only Comments and Activity, manages directed dependency relations, and archives an Issue without exposing permanent deletion. Returning an `in_review`, `blocked`, or `done` Issue to `todo` reveals the required reason field before submission.

The package registers into `sidebar.workspace.action`, `shell.center`, and `shell.details`. `ui-layout` owns the generic alternate-surface selection, and `ui-workspace` supplies the Workspace row owner data. The generated `taskboard` Remote namespace is required explicitly as `remote.taskboard`, so this plugin activates only after its descriptors are mounted. Host `taskboard/changed` events refresh the active Workspace while generation fences prevent an older Workspace or Issue response from replacing a newer selection.

The Web keyless fixture exposes the same generated endpoint names and deterministic Issue data used by the assembled browser snapshot. Package tests own controller races, persistence, registration, and component behavior; the assembled snapshot owns the Workspace-entry-to-details product path through built bundles.

## Model Experience

None, as this package renders and mutates Host-owned Taskboard records in browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Gantt is not registered in this layer** — dates are editable and durable, but the timeline and dependency links arrive in the next stack PR.
- **Patrol and review controls are absent** — scheduling, Development Context, Session execution, Reviewer evidence, and human review actions belong to later stack layers.
- **Attachments have no browser surface** — the current details column covers Issue fields, Comments, Activity, and relations only.
- **Archived Issues are hidden after archival** — the Host supports restore, but this package does not yet provide an archive browser or restore action.
