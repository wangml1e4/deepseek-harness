# @deepseek-ai/dsh-client-ui-taskboard

English | [中文](README.zh.md)

Browser Consumer for each Workspace's implicit Taskboard. A compact action in every real Workspace row opens a Taskboard as an alternate center surface; selecting an Issue opens its editable record in the existing right details column. Returning to a Session restores the ordinary conversation surface.

The center surface provides Dashboard, Board, List, and Gantt views over one shared `TaskboardController` snapshot. Dashboard derives completion, active, overdue, status, priority, and recent-work summaries from the current Issue list. Board renders the seven lifecycle columns and persists drag moves through optimistic Issue versions. List groups the same Issues by lifecycle status. Gantt keeps unscheduled Issues in its grid, draws bars only when both dates exist, and renders `blocks` links between scheduled Issues. Dragging or resizing one bar updates only that Issue's inclusive dates; it never shifts dependent Issues. Search, status, priority, and label filters apply consistently to every view, and the selected view, Gantt scale, and filters persist in browser storage under `dsh.taskboard.view.v1`.

The details surface edits title, Markdown description, status, priority, assignee, labels, and day-granularity dates. It lists append-only Comments and Activity, manages directed dependency relations, and archives an Issue without exposing permanent deletion. Returning an `in_review`, `blocked`, or `done` Issue to `todo` reveals the required reason field before submission.

The Taskboard header opens Patrol settings in the existing right details column. Its switch starts disabled; the panel saves one of the fixed `5m`, `30m`, `1h`, `2h`, `6h`, `12h`, or `24h` intervals plus Base Branch, Agent Preset, provider, model, reasoning effort, and Permission Preset choices. It shows the next due time, active state, permanent Run/Attempt history, and a manual `Run now` action. An eligible `todo` Issue also has a scoped run action. Issue details display the bound Session, branch, Base Branch, result commit, and independent Reviewer findings. Human review moves `in_review` to `done` or returns it to `todo` with a required reason; it never merges code.

The package registers into `sidebar.workspace.action`, `shell.center`, and `shell.details`. `ui-layout` owns the generic alternate-surface selection, and `ui-workspace` supplies the Workspace row owner data. The generated `taskboard` Remote namespace is required explicitly as `remote.taskboard`, so this plugin activates only after its descriptors are mounted. One Workspace-scoped relation read supplies canonical dependency links without per-Issue RPC calls. Host `taskboard/changed` events refresh the active Workspace while generation fences prevent an older Workspace or Issue response from replacing a newer selection.

The Gantt wrapper uses the MIT-licensed `dhtmlx-gantt` 10 Community Edition. Its React lifecycle and manual-scheduling interaction are adapted from Dashi Taskboard's Apache-2.0 `GanttView`; the modified source carries an attribution notice and the published package's `LICENSE` includes both the Harness MIT terms and Dashi's Apache license.

The Web keyless fixture exposes the same generated endpoint names and deterministic Issue data used by the assembled browser snapshot. Package tests own controller races, date conversion, dependency projection, chart lifecycle, persistence, registration, and component behavior; the assembled snapshot owns the Workspace-entry-to-details product path through built bundles.

## Model Experience

None, as this package renders and mutates Host-owned Taskboard records in browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Unfinished Run recovery is pending** — durable Patrol history is visible, but process-loss recovery belongs to the recovery layer.
- **Attachments have no browser surface** — the current details column covers Issue fields, Comments, Activity, and relations only.
- **Archived Issues are hidden after archival** — the Host supports restore, but this package does not yet provide an archive browser or restore action.
