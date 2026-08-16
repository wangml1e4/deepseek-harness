# Agent Note: Workspace-owned Taskboard

Status: proposed

English | [中文](2026-08-15-workspace-taskboard.zh.md)

## Problem

DeepSeek Harness groups sessions under durable Workspaces but has no durable cross-session work catalog that people and Agents can share. Session Todos belong to one Agent, Goals retain one objective in one Session, Jobs are process-local, and Schedule reminders run only while their owning Session is live; none represents project work moving from proposal through execution and human review.

The Dashi Taskboard reference supplies that product loop, but its independent Project entity would duplicate the Workspace directory, title, and session relationship already owned by Harness. Independent deletion would also force the product to choose between orphaning Taskboard data and silently deleting Issues, comments, attachments, and Agent activity.

## Proposal

Each registered Workspace owns exactly one implicit Taskboard. A Taskboard is not created, named, or deleted independently, and every Issue belongs to one Workspace. An Issue may move to another Workspace through an explicit mutation.

Workspace deletion rejects while its Taskboard contains any Issue, including archived Issues. Version one never permanently deletes an Issue, comment, activity entry, or Patrol Run, so the user must move every Issue to another Workspace first; Workspace deletion never cascades into Taskboard data.

The first product release provides the local Taskboard loop: Issues, Dashboard, board and list views, Gantt view, lifecycle status, priority, labels, comments, relations, attachments, search and filtering, Harness Session binding, and a configurable Patrol Agent. Publishing or synchronizing Taskboard Issues with GitHub Issues in `deepseek-ai/deepseek-harness`, recurring Issues, Jira integration, cloud collaboration, desktop packaging, Codex injection, and the node workflow editor remain outside this proposal.

Dashboard is a read-only projection of the same Issue data. It reports lifecycle counts and completion progress, overdue and upcoming Issues, and recent activity, with links that open the corresponding filtered Taskboard view. It does not persist a second statistics model.

Each Workspace row in the existing sidebar exposes its Taskboard entry and `todo` count. Selecting it replaces the center conversation surface with that Workspace's Taskboard and its Dashboard, Board, List, and Gantt tabs. Patrol controls and status occupy the Taskboard header. Opening an Issue's bound Session returns the center surface to that ordinary conversation.

Selecting an Issue opens its description, properties, relations, attachments, comments, activity, Session link, and commit link in the existing right details column without replacing the Taskboard center state. Narrow layouts present the same detail surface full-screen.

The same detail surface presents human review evidence: the result commit, the diff against Base Branch, Reviewer findings, executed verification, remaining risks, and the `Approve` and `Return` actions. Taskboard uses only in-app status, sidebar badges, and in-app notifications; version one sends no operating-system, email, or webhook notifications.

Dashi's Apache-2.0 frontend components and interaction logic may be adapted for Board, List, Gantt, and Issue detail with the required attribution and modified-file notices. `dhtmlx-gantt` version 10 may be used under its MIT license. Dashi's standalone server, Codex injection, and automation bridge are not copied; Harness services, Remote contracts, Session integration, permissions, and Patrol remain native Cordis plugins.

Taskboard is a capability seam with a Service Definition, a local SQLite Provider, and Host, UI, and Patrol Consumers. One Taskboard database under the Harness persistence root stores every Workspace's records keyed by `WorkspaceId`; attachment bytes live in an adjacent managed directory while their metadata remains transactional in SQLite. Taskboard writes no database or attachment data into a Workspace repository. The Provider uses indexed tables and transactions for Issue versions, comments, relations, activity, and Patrol Runs instead of storing this relational state in `storage-domain` records.

Attachment identities are random opaque ids used as owner-only managed filenames; original filenames remain metadata and never participate in Host path resolution. Issue-scoped Remote methods carry canonical base64 without exposing a Host path, and every read verifies both the Issue and attachment identity before returning bytes.

Version one also ships an adapted `taskctl` CLI and a built-in `manage-taskboard` skill as Taskboard Consumers. Users and interactive Agents use them for Issue, comment, relation, and query operations against the same Host Service as the UI. Patrol eligibility, atomic claim, Session binding, and lifecycle writeback call the Host Service directly rather than asking the model to orchestrate critical transactions through the CLI.

Gantt scheduling follows Dashi's manual model. An Issue has optional day-granularity `startDate` and `dueDate` fields. The grid retains unscheduled Issues, but the timeline draws a bar only when both dates exist. Dragging or resizing a bar changes those dates. `blocks` relations draw dependency links between scheduled Issues but never move dates automatically.

New Issues enter `backlog` unless the user creates them directly in `todo`; moving an Issue to `todo` is the explicit authorization for unattended work. Human-readable Issue identifiers use `<WORKSPACE_PREFIX>-<monotonic number>`. The prefix is derived from the Workspace title, may be edited before the first Issue is created, must be unique, and then becomes immutable.

Issue archiving is reversible. Version one has no permanent deletion for Issues, comments, activity entries, or Patrol Runs; comments and activity are append-only. Attachments accept Dashi's 25 MB per-file limit and unrestricted file types, preview images, download through a controlled Host route, and permit an explicit confirmed deletion.

Issue status uses the closed Dashi lifecycle unchanged: `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, and `canceled`.

Only `todo` authorizes a Patrol Agent to claim an Issue. `backlog` is unapproved work, and no other status is a candidate for a new claim.

Users may change Issue state manually. `Approve` is the normal `in_review` to `done` transition. Returning `in_review`, `blocked`, or `done` to `todo` requires a reason and retains every existing Session and Development Context binding.

Version one provides three assignment values: `Unassigned`, `User`, and `Patrol Agent`. Patrol considers only `Unassigned` and `Patrol Agent` Issues and skips every Issue assigned to `User`. A claim sets the assignee to `Patrol Agent` and binds the concrete Session; assignee and Session binding remain separate fields.

A `todo` Issue with `blocked_by` relations becomes eligible only when every predecessor is strictly `done` and each predecessor's result commit is an ancestor of the current Base Branch. `canceled`, `in_review`, and every other status leave the dependency unsatisfied. A completed but unintegrated predecessor leaves the dependent Issue visibly waiting for code integration; bypassing the dependency requires an explicit relation change.

Patrol scans `todo` Issues in their manual top-to-bottom board order. It skips candidates with unsatisfied dependencies or Issue content and latest comments that explicitly say to wait or not start. Priority remains display and filter metadata and never reorders Patrol work.

Issue detail also provides `Run now` for the selected Issue. This one-off action bypasses board order but still enforces status, assignment, dependency, concurrency, and permission eligibility. It may run while fixed-interval scheduling is disabled and never enables that policy.

An Issue retains one durable Harness Session binding. When a bound Issue returns to `todo`, Patrol Agent work must resume that exact Session; only an Issue without a binding may create a new Session.

Every Patrol-executed Issue also retains a dedicated Git branch and worktree binding. Before starting an unbound Issue, Patrol creates both and starts its Session inside that worktree; later runs resume the same Session and worktree. Patrol never commits in the user's current Workspace checkout. A non-Git Workspace or branch/worktree creation failure is recorded and moves the Issue to `blocked` without falling back to the Workspace root.

Patrol Policy includes a Base Branch. Enabling Patrol initially selects the currently checked-out local branch, and the user may select another local branch. A new unbound Issue creates its branch and worktree from the selected branch's local tip. Patrol never fetches or pulls automatically. Changing Base Branch affects only later unbound Issues; existing Development Context bindings remain fixed.

A Patrol-created Session is an ordinary persistent Workspace Session, visible in the existing Session list and named from the Issue identifier and title. Automatic execution never uses a hidden transcript.

Before handing an implemented Issue to human review, its bound Session invokes one independent Reviewer Agent to inspect the Issue branch relative to Base Branch. The Patrol Agent applies the required corrections, reruns relevant verification, and creates a commit containing the result before the handoff.

The Reviewer reuses the Patrol Policy's selected Agent Preset, model, and reasoning effort, but its effective sandbox mode is fixed to `read-only` and its approval policy to `never`. It can return only durable findings to the bound Session and cannot edit files, create commits, or change Issue state. Reviewer permissions are a fixed safety invariant rather than another user-configurable preset.

Tool approval and Issue review are separate decisions. An unattended Patrol Agent never waits on a tool approval request: it rejects the requested operation, retains the Session binding, records the reason, and moves the Issue to `blocked`. A candidate blocked this way does not consume the run's successful-execution allowance, so the run may look for another eligible `todo` Issue.

After the required review, corrections, and commit, the Patrol Agent moves the implemented Issue to `in_review` for human review. Human review is not a `blocked` condition, and Patrol does not claim an `in_review` Issue.

Accepting human review moves the Issue from `in_review` to `done`. Rejecting review requires a reason, records it in the Issue history, and returns the Issue to `todo`; a later Patrol Run resumes the existing Session binding to address that feedback.

Review acceptance does not merge the Issue branch into Base Branch. The Issue's branch, worktree, and commit remain bound and visible after it becomes `done`; integration stays an explicit user-owned Git operation.

Patrol performs no Git network operation and creates no pull request: no fetch, pull, push, remote branch mutation, or merge occurs automatically. Version one never cleans a bound worktree automatically. A user may explicitly remove a worktree only when it is clean and its result commit is an ancestor of Base Branch; this operation preserves the branch, Session, Issue history, and Patrol Run history.

The Patrol Agent claims eligible repository-changing Issues and executes their requested work rather than producing a report-only scan. A run that produces no committable diff moves the Issue to `blocked`. Except for a rejected Tool Approval, every implementation, verification, Reviewer, commit, recovery, Provider, quota, or rate-limit failure records the reason, moves the current Issue to `blocked`, and ends the Run without an automatic Patrol-level retry. The saved policy remains enabled.

Each Workspace has one Patrol Policy controlled by its Taskboard. The policy starts disabled and uses a one-hour default interval after the user explicitly enables it. Version one supports only fixed intervals selected from `5m`, `30m`, `1h`, `2h`, `6h`, `12h`, and `24h`; it does not accept cron expressions or wall-clock schedules. An enabled policy remains enabled when an inspection finds no eligible Issue and checks again at the next interval; only an explicit user change disables it.

The Patrol Policy is a Host-owned durable scheduled task. It persists its enabled state and next due time across Host restarts. The Host cannot run patrol while stopped; after startup, an overdue policy runs once after its Workspace is ready, discards the other missed triggers, and then resumes its interval.

Intervals use fixed cadence rather than completion-relative delay. Saving a new interval calculates the next due time from that save; an active Run keeps its existing execution. A due trigger that overlaps active work is recorded as skipped and is never queued.

Disabling Patrol while a run is active suppresses every later trigger but does not abort the active Session. The UI shows that Patrol will stop after the current run, and the policy becomes inactive after that run reaches `in_review` or `blocked`.

The Taskboard header also provides `Run now`. It starts one Patrol Run with the saved policy even when fixed-interval scheduling is disabled and does not change that enablement. The action is unavailable while another Run is active, and its result is persisted like a scheduled trigger.

Version one has no provider-quota-aware pause because Harness providers expose no common quota query. Patrol Run history retains token usage and Provider errors. A quota or rate-limit failure records its reason, moves the current Issue to `blocked`, and ends the Run without disabling the fixed-interval policy; later scheduled Runs may process other eligible Issues.

The Patrol Policy also selects an Agent Preset, model, and reasoning effort, initially inherited from the current new-Session defaults. A new Patrol-created Session records those resolved choices at creation. Later policy changes affect only Sessions created later; a bound Issue resumes its Session with that Session's existing configuration.

Patrol permissions reuse the existing Permission Preset selector instead of exposing sandbox mode and approval policy as independent controls. Workspace Write is selected by default. The user may explicitly select Danger Full Access or any other available permission preset. A new Patrol-created Session resolves the selected preset at creation; a bound Session retains its existing permissions when it resumes.

Each scheduled Patrol Run produces at most one successful Review Handoff. A Tool Approval that moves a claimed Issue to `blocked` does not consume that allowance, so the run continues to the next eligible `todo`. Moving an implemented Issue to `in_review` consumes the allowance and ends the run. Additional eligible Issues remain available for later runs rather than forming a batch.

Only one Patrol Run may be active across the entire Host, and therefore also within a Workspace. A scheduled trigger that arrives while any Workspace has an active Run records `skipped-global-busy`; it neither starts concurrent work nor creates a catch-up queue.

Every scheduled trigger creates a durable Patrol Run record with start and end times, result, errors, and any claimed Issue, bound Session, and resulting commit. Empty inspections, overlapping-trigger skips, and permission blocks remain visible in history. Taskboard shows the last run, next due time, and Run history. A trigger with no eligible Issue records that outcome without creating a Session.

On Host restart, an unfinished Patrol Run is recovered before overdue or new scheduled triggers. Recovery makes one automatic attempt to resume the exact bound Session and worktree. If either cannot be resumed, the Host records the reason, preserves the Session, branch, worktree, and Run history, moves the Issue to `blocked`, and never creates a replacement Session.

Taskboard is permanent Workspace product UI backed by host-owned data. It is unrelated to the proposed Session-local declarative [Task Surface](2026-08-04-task-surface.md).

Implementation delivery follows independently verifiable PRs or one formal stack in this order: domain and SQLite; Host Remote, CLI, and skill; Dashboard, Board, List, and detail UI; Gantt and dependencies; Patrol scheduling; Git, Session, and permissions; Reviewer and human review; recovery, audit, and final verification. Each later PR declares its dependency on the preceding layer, keeps every capability role complete at its merge point, and enters human review without automatic merge.

## Current implementation

The first twelve stack layers provide the Workspace-owned Taskboard Service Definition, local SQLite Provider, Host Typert Remote, JSON `taskctl` command line, bundled `manage-taskboard` skill, browser Dashboard, Board, List, Gantt and Issue details, durable Patrol state, local Git and exact Session execution, fixed-interval coordination, startup recovery, an independent Reviewer, human review controls, attachments, Workspace deletion protection, complete Dashboard projections, and review navigation. The standard Web Host mounts the interactive roles together, and the installed `dsh` package exposes both `dsh` and `taskctl` executables. The Remote and CLI cover Workspace metadata, Issue lifecycle and order, Comments, Activity, dependencies, attachments, Patrol configuration and history, manual Runs, and Issue evidence. The Dashboard derives completion, lifecycle counts, overdue work, work due within 14 days, and the five newest active-Issue Activity entries, and links each summary to its filtered List. The Remote separately derives each Workspace's current `todo` count and exposes the committed Base Branch diff as review evidence. The Taskboard Host Consumer registers a retained-data guard so any active or archived Issue rejects Workspace deletion without changing either store; moving every Issue to another Workspace removes the blocker. Issue creation and movement into a Workspace share the registry mutation queue with deletion, so the guard observes concurrent writes. Successful writes publish a contained `taskboard/changed` event so the active browser projection and sidebar count refresh without polling.

The browser UI enters from each Workspace row, shows the live `todo` count there, replaces the conversation center with the selected Taskboard, and reuses the existing right details column. A bound implementation Session navigates back to the ordinary conversation view, while human review displays the committed Base Branch diff. View, Gantt scale, and filter preferences persist in browser storage, while authoritative Issue data remains Host-owned. The Gantt renderer keeps unscheduled Issues in its grid, draws canonical `blocks` links between scheduled bars, and persists one dragged Issue's dates without cascading changes.

Every ensured Taskboard owns a default-off `1h` Patrol Policy with execution choices. The coordinator consumes due instants, scans only `todo` in manual order, and skips User assignments, explicit waits, and unsatisfied or unintegrated dependencies. A permanent Development Context fixes each Patrol-owned Issue's local branch, worktree, exact Session, Agent Preset, model selection, and Permission Preset. The implementation Agent must commit a clean Base Branch diff. A separate persistent Reviewer with read-only sandboxing, approval policy `never`, and only a structured submission tool records permanent evidence; the original Session receives it for one correction turn before the Issue enters `in_review`. One review handoff ends the Run, while only a rejected tool approval may block the current Issue and continue scanning. Host startup records a recovery count and time before it resumes the unique unfinished Run. Recovery reuses the exact Development Context and existing Reviewer evidence; missing or mismatched Session or worktree state atomically fails the Attempt and Run, blocks the Issue, records the reason, and never creates a replacement. The UI discovers Host-owned configuration choices, shows permanent Run, Attempt, recovery, Session, Git, and review evidence, and leaves `done` and code integration to the user.

## Post-version-one plan

Version one is local-only and never creates, comments on, updates, or synchronizes Issues in `deepseek-ai/deepseek-harness`. Later delivery is sequenced as follows: first add an explicit opt-in repository binding and credential check; then add a user-owned publish action that creates one GitHub Issue and stores a permanent local-to-remote identity and audit record; then add conflict-aware metadata and Comment import or synchronization; finally consider separately authorized Draft pull-request publication from a Patrol result commit. Patrol must not auto-publish Issues, and review acceptance must never auto-merge code.

## Alternatives considered

**Retain independent Taskboard Projects.** Rejected because a Project would duplicate Workspace identity and require users and Agents to maintain a second mapping to the same directory and Sessions.

**Cascade Workspace deletion into Taskboard data.** Rejected because removing a Workspace registration must not silently destroy durable work history, comments, attachments, or Agent activity.

**Make patrol report-only.** Rejected because inspection without claiming and execution does not complete the Taskboard-to-code-to-review product loop.

**Pause patrol when no Issue is eligible.** Rejected because temporary absence of work must not revoke the user's continuing authorization or require the user to re-enable patrol after adding an Issue.

**Queue every trigger missed while the Host is stopped.** Rejected because replaying elapsed intervals would create a restart-time execution burst unrelated to current Taskboard state.

**Support cron or wall-clock schedules in version one.** Rejected because the requested patrol behavior is an interval and fixed choices provide the required control without a second scheduling model.

**Support recurring Issues in version one.** Rejected because automatic Issue generation combined with Patrol execution needs separate generation, Session-binding, and termination policies beyond the one-time Issue loop.

**Persist separate Dashboard statistics.** Rejected because current Issue and activity data is authoritative and sufficient to derive the required overview.

**Create a global Taskboard page outside Workspace navigation.** Rejected because Taskboard identity and data ownership are Workspace-scoped, while the existing sidebar already provides the authoritative Workspace hierarchy.

**Open Issue detail in a modal.** Rejected because the existing details column preserves board position and filters while providing the product's established secondary-inspection surface.

**Copy Dashi's standalone backend into Harness.** Rejected because it would bypass Workspace, Session, permission, Remote, and plugin ownership already provided by Harness.

**Store Taskboard records in `storage-domain`.** Rejected because its single-record KV operations provide no cross-table transactions or secondary indexes for Issue claims, relations, comments, and Patrol Run state.

**Store Taskboard data in each project repository.** Rejected because Taskboard metadata and attachments are Host product state and must not dirty or alter the user's source tree.

**Drive Patrol claims through model-authored `taskctl` calls.** Rejected because the Host already owns scheduling and concurrency, and critical claim and binding transactions must not depend on prompt compliance.

**Create a Session for every scheduled trigger.** Rejected because an empty or skipped trigger has no Agent work or transcript; its durable Patrol Run record is the authoritative audit result.

**Replace an unrecoverable Patrol Session after a crash.** Rejected because a replacement could repeat unknown side effects and would violate the Issue's durable Session ownership.

**Abort the active Session when Patrol is disabled.** Rejected because immediate cancellation can leave uncommitted files and an Issue without a reliable handoff or blocker result.

**Require scheduled Patrol to be enabled before a manual Run.** Rejected because the explicit one-time action is sufficient authorization for one Run and must not silently create continuing authorization.

**Replicate Dashi's Codex-account quota pause in version one.** Rejected because Harness supports heterogeneous Providers without a common authoritative quota service.

**Merge an Issue branch automatically when review is accepted.** Rejected because Base Branch drift, conflicts, and an active user checkout require an explicit Git integration decision outside unattended Patrol execution.

**Treat `done` alone as sufficient for code dependencies.** Rejected because a successor worktree created from Base Branch would otherwise omit an accepted predecessor commit that has not been integrated.

**Queue or parallelize overlapping Patrol Runs.** Rejected because concurrent Agents would modify the same Workspace, while a catch-up queue would turn a temporary slow run into an unbounded execution backlog.

**Configure sandbox mode and approval policy independently.** Rejected because Harness already owns their valid combinations and presentation through Permission Presets. Patrol should not create a second permissions model.

**Represent human review as `blocked`.** Rejected because `in_review` already identifies work awaiting a human decision, while `blocked` identifies work that cannot continue.

**Automatically rank Patrol work by priority.** Rejected because users already control execution order directly by arranging the `todo` column, and silently reordering it would make the next claim harder to predict.

**Let Patrol claim work assigned to `User`.** Rejected because assignment is an explicit ownership decision and unattended automation must not silently take human work.

**Run Patrol directly in the user's current checkout.** Rejected because automatic code changes and commits could include unrelated user work or interfere with an interactive Session.

**Fetch or pull the Base Branch before a claim.** Rejected because scheduled local execution must not mutate or depend on remote repository state without a separate explicit authorization.

**Automatically schedule dependent Issues.** Rejected because dependency relations express execution constraints, while Issue dates remain an explicit user-owned plan.

**Return rejected review without a reason.** Rejected because the bound Session needs durable, model-visible feedback that explains what must change in the next attempt.

**Let the implementation Agent perform its own required review.** Rejected because an independent Reviewer provides a separate evaluation before human review without taking ownership of implementation or status changes.

**Let the Reviewer inherit Patrol write permissions.** Rejected because the Reviewer owns evaluation only; allowing it to modify the implementation would erase the separation between findings and corrections.

## Acceptance criteria

- Every registered Workspace exposes one Taskboard without a separate Project-creation flow.
- Every Workspace sidebar row opens its Taskboard in the center surface, where Dashboard, Board, List, Gantt, and Patrol controls remain scoped to that Workspace; opening a bound Session returns to its conversation.
- Issue selection uses the right details column without losing Taskboard state and uses the same detail surface full-screen in narrow layouts.
- Adapted Dashi frontend files retain Apache-2.0 attribution and modification notices, `dhtmlx-gantt` is tracked as an MIT dependency, and no standalone Dashi backend or Codex automation bridge enters the Harness runtime.
- A local SQLite Provider stores Workspace-keyed Taskboard records under the Harness persistence root, stores attachment bytes in an adjacent managed directory, and leaves Workspace repositories unchanged.
- `taskctl`, the built-in `manage-taskboard` skill, UI, and interactive Agents share the Taskboard Service, while Patrol claim and lifecycle transactions execute directly through the Host rather than model-authored CLI calls.
- An Issue can be moved between Workspaces or archived and restored, but version one never permanently deletes an Issue, comment, activity entry, or Patrol Run.
- Workspace deletion fails with an actionable result while any active or archived Issue remains and succeeds only after every Issue has moved to another Workspace.
- The local product exposes board, list, and Gantt views over the same durable Issues and retains their comments, relations, attachments, and Session bindings across Host restarts.
- Dashboard derives lifecycle counts, completion progress, overdue and upcoming work, and recent activity from authoritative Issue data and links each summary to a filtered view.
- Gantt retains unscheduled Issues in its grid, draws bars only for Issues with both dates, saves drag and resize edits, and shows dependency links without changing dates automatically.
- Version one never creates a successor Issue from a recurrence rule.
- Version one never creates or synchronizes a Taskboard Issue as a GitHub Issue in `deepseek-ai/deepseek-harness`.
- Every Issue has exactly one of the seven defined lifecycle statuses.
- A newly created Issue defaults to `backlog`; creating or moving it into `todo` is the explicit unattended-execution authorization.
- Issue identifiers use an immutable, unique Workspace prefix and a Workspace-monotonic number; the prefix may change only before the first Issue exists.
- Returning `in_review`, `blocked`, or `done` to `todo` requires a durable reason and preserves the exact Session and Development Context bindings.
- A Patrol Run considers only `todo` Issues for a new claim.
- Patrol claims only `Unassigned` or `Patrol Agent` Issues, never claims a `User` Issue, and records both the Patrol Agent assignment and concrete Session binding after a claim.
- A Patrol Run rejects a `todo` Issue while any `blocked_by` predecessor is not `done` or its result commit is not an ancestor of the current Base Branch, and the UI distinguishes the latter as waiting for code integration.
- A Patrol Run scans `todo` in manual board order, skips explicit wait instructions, and never lets priority override that order.
- A selected Issue's `Run now` bypasses board order without bypassing any other eligibility or safety rule and does not enable fixed-interval scheduling.
- Patrol Agent work resumes the bound Session for returned `todo` Issues and creates a Session only for an unbound Issue.
- Patrol creates and binds a dedicated Git branch and worktree before executing an unbound Issue, reuses them with the Session, and moves the Issue to `blocked` rather than writing in the Workspace root when isolation cannot be created.
- Patrol Policy preselects the current local branch as Base Branch when enabled, allows another local branch selection, creates only future unbound Issue contexts from its local tip, and performs no automatic fetch or pull.
- A Patrol-created Session survives Host restart, appears in the owning Workspace's Session list, and exposes its complete transcript.
- Before human review begins, one independent Reviewer inspects the Issue branch relative to Base Branch, after which the Patrol Agent applies required corrections, reruns verification, and commits the resulting work.
- Reviewer uses the Patrol Agent Preset, model, and reasoning effort under fixed `read-only` sandbox and `never` approval settings and cannot mutate the worktree, Git state, or Issue.
- A tool approval request never waits during unattended Patrol work: the requested operation is rejected, the reason is recorded, and the Issue moves to `blocked` while retaining its Session binding.
- An implemented and committed Issue moves to `in_review`, not `blocked`, and Patrol does not claim it while it awaits human review.
- Accepting review moves an Issue to `done`; rejecting review requires a recorded reason, returns it to `todo`, and causes later Patrol work to resume its bound Session.
- Accepting review does not merge or remove the Issue's branch and worktree; Taskboard retains links to its persistent commit and Development Context.
- Patrol performs no fetch, pull, push, pull-request creation, merge, or automatic worktree removal. Manual worktree removal requires a clean worktree and a result commit already integrated into Base Branch.
- A Patrol Issue with no committable repository diff moves to `blocked`; every non-approval failure moves it to `blocked` and ends the Run without an automatic retry.
- An enabled Patrol Agent can claim an eligible Issue, execute its requested work in the owning Workspace, and present the result for human review.
- A newly registered Workspace performs no Patrol Agent work until the user explicitly enables its policy; the initial interval is one hour.
- Patrol interval configuration offers exactly `5m`, `30m`, `1h`, `2h`, `6h`, `12h`, and `24h` in version one, with `1h` selected by default.
- Patrol enablement and next due time survive Host restart; an overdue policy runs once after startup without replaying every missed interval.
- Disabling Patrol during an active run prevents later triggers, lets that run finish at `in_review` or `blocked`, and exposes the pending-disable state in the UI.
- `Run now` starts one durable Run with the saved policy without enabling future scheduling and is unavailable during an active Run.
- Patrol Run history records token usage and Provider errors; quota and rate-limit failures move the current Issue to `blocked` without disabling the policy, and version one performs no quota-aware pause.
- Patrol settings expose Agent Preset, model, and reasoning effort with the new-Session defaults preselected, and later edits do not reconfigure bound Sessions.
- Patrol settings reuse Permission Presets, preselect Workspace Write, permit an explicit Danger Full Access or other available preset selection, and apply later edits only to Sessions created later.
- One Patrol Run moves no more than one Issue to `in_review`; it may claim another Issue only after a Tool Approval moves the prior claim to `blocked`.
- The Host never has more than one active Patrol Run across all Workspaces, and an overlapping trigger records `skipped-global-busy` without a queued run.
- Every scheduled trigger has a durable, visible Patrol Run result, while an empty or skipped trigger creates no Session.
- Host restart records the recovery count and time, recovers an unfinished Run before new triggers, attempts the exact Session and worktree once, reuses existing Reviewer evidence, and moves the Issue to `blocked` without replacement when recovery is impossible.
- Attachments accept files up to 25 MB, preview images, download only through a controlled Host route, and require explicit confirmation before deletion; comments and activity stay append-only.
- Human review in the right details column shows the commit, Base Branch diff, Reviewer findings, verification, risks, and Approve and Return actions; notifications remain in-app only.

## Risks

Tying Taskboard lifetime to Workspace lifetime makes Workspace deletion intentionally stricter. The refusal path must make moving every active and archived Issue to another Workspace practical because permanent Issue deletion is unavailable.

Automatic execution can spend model quota and modify project files without a contemporaneous prompt. Default-off enablement, one Host-wide active Run, dedicated worktrees, Permission Presets, explicit status transitions, and durable results bound that risk, but Danger Full Access remains a deliberate high-impact user choice.
