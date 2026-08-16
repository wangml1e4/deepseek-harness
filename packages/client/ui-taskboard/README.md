# @deepseek-ai/dsh-client-ui-taskboard

English | [中文](README.zh.md)

Browser Consumer for each Workspace's implicit Taskboard. A compact action and live `todo` badge in every real Workspace row opens a Taskboard as an alternate center surface; selecting an Issue opens its editable record in the existing right details column. Opening its bound implementation Session restores the ordinary conversation surface and selects that persistent transcript.

The center surface provides Dashboard, Board, List, and Gantt views over one shared `TaskboardController` snapshot. Dashboard derives completion, lifecycle counts, overdue work, work due within 14 days, and the five newest Workspace Activity entries from current Host records; every summary opens the matching filtered List. Board renders the seven lifecycle columns and persists drag moves through optimistic Issue versions. List groups the same Issues by lifecycle status. Gantt keeps unscheduled Issues in its grid, draws bars only when both dates exist, and renders `blocks` links between scheduled Issues. Dragging or resizing one bar updates only that Issue's inclusive dates; it never shifts dependent Issues. Search, status, priority, label, and due-date filters apply consistently to every view, and the selected view, Gantt scale, and filters persist in browser storage under `dsh.taskboard.view.v2`; the obsolete `v1` value remains untouched and is not loaded.

The details surface edits title, Markdown description, status, priority, assignee, labels, and day-granularity dates. It lists append-only Comments and Activity, manages directed dependency relations, and archives an Issue without exposing permanent deletion. Attachments accept every file type up to 25 MB; the surface lists metadata, previews images, downloads bytes through the controlled Host Remote, and calls permanent attachment deletion only after a browser confirmation. Returning an `in_review`, `blocked`, or `done` Issue to `todo` reveals the required reason field before submission.

The Taskboard header opens Patrol settings in the existing right details column. Its switch starts disabled; the panel saves one of the fixed `5m`, `30m`, `1h`, `2h`, `6h`, `12h`, or `24h` intervals plus Base Branch, Agent Preset, provider, model, reasoning effort, and Permission Preset choices. It shows the next due time, active state, permanent Run/Attempt history, aggregated token usage, structured Provider diagnostics, and a manual `Run now` action. An eligible `todo` Issue also has a scoped run action. Issue details link to the bound Session and display its branch, Base Branch, result commit, bounded committed diff, and independent Reviewer findings. Human review moves `in_review` to `done` or returns it to `todo` with a required reason; it never merges code.

The package registers into `sidebar.workspace.action`, `shell.center`, and `shell.details`. `ui-layout` owns the generic alternate-surface selection, and `ui-workspace` supplies the Workspace row owner data. The generated `taskboard` Remote namespace is required explicitly as `remote.taskboard`, so this plugin activates only after its descriptors are mounted. Sidebar actions share a count projection that loads only the derived `todo` number per Workspace. One Workspace-scoped relation read supplies canonical dependency links without per-Issue RPC calls. Host `taskboard/changed` events refresh the affected count and active Workspace while generation fences prevent an older count, Workspace, or Issue response from replacing newer state.

The Gantt wrapper uses the MIT-licensed `dhtmlx-gantt` 10 Community Edition. Its React lifecycle and manual-scheduling interaction are adapted from Dashi Taskboard's Apache-2.0 `GanttView`; the modified source carries an attribution notice and the published package's `LICENSE` includes both the Harness MIT terms and Dashi's Apache license.

The Web keyless fixture exposes the same generated endpoint names and deterministic Issue data used by the assembled browser snapshot. Package tests own controller races, date conversion, dependency projection, chart lifecycle, persistence, registration, and component behavior; the assembled snapshot owns the Workspace-entry-to-details product path through built bundles.

## Model Experience

None, as this package renders and mutates Host-owned Taskboard records in browser chrome; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Archived Issues are hidden after archival** — the Host supports restore, but this package does not yet provide an archive browser or restore action.
