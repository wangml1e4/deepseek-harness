# Taskboard

The Taskboard context coordinates durable project work between people and Agents.

## Language

**Taskboard**:
A durable Issue collection and Workspace-level center surface owned by one Harness Workspace. Each Workspace owns exactly one Taskboard, entered from its sidebar row and rendered as Dashboard, Board, List, or Gantt. Host-owned SQLite under the Harness persistence root stores all Taskboards; attachment bytes live in an adjacent managed directory rather than a project repository.
_Avoid_: Project Board, Taskboard Project

**Issue**:
A durable unit of work tracked from proposed work through completion. A new Issue defaults to `backlog`; creating it in or moving it to `todo` explicitly authorizes Patrol. An Issue may be archived and restored but is never permanently deleted in version one.
_Avoid_: Task, Todo, Ticket

**Issue Identifier**:
A stable human-readable `<WORKSPACE_PREFIX>-<monotonic number>` reference. The prefix derives from the Workspace title, may be changed before the first Issue exists, must be unique, and then remains immutable; moving an Issue preserves its identifier.
_Avoid_: IssueId, Row ID

**Issue Status**:
One of `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, or `canceled`, identifying an Issue's current lifecycle phase.
_Avoid_: Column

**Blocking Dependency**:
A `blocked_by` relation whose predecessor must reach `done` and whose result commit must be an ancestor of the current Base Branch before the dependent Issue is eligible for Patrol Agent work. A completed but unintegrated predecessor leaves the dependent Issue waiting for code integration.
_Avoid_: Related Issue, Soft Dependency

**Review Handoff**:
The point after a Patrol Agent has implemented an Issue, obtained one independent Reviewer pass over its branch relative to Base Branch, corrected the required findings, rerun verification, and created a commit, when the Issue enters `in_review` and the result is handed to a person for review. The right details column presents the commit, diff, Reviewer findings, verification, and remaining risks. Acceptance moves it to `done` without merging its branch; rejection requires a recorded reason and returns it to `todo` for work in the bound Session.
_Avoid_: Tool Approval, Permission Prompt

**Reviewer Agent**:
An independent read-only Agent that inspects an Issue branch relative to Base Branch and returns findings to the bound Patrol Session. It reuses the Patrol Agent Preset, model, and reasoning effort but is fixed to sandbox `read-only` with approval policy `never`; it cannot modify files, commits, or Issue state.
_Avoid_: Patrol Agent, Human Reviewer

**Tool Approval**:
A one-shot permission decision requested by a tool under the Session's selected Permission Preset. An unattended Patrol Agent never waits for this decision: it rejects the operation and marks the Issue `blocked`.
_Avoid_: Human Review, Review Handoff

**Patrol Queue Order**:
The manual top-to-bottom order of the `todo` column used when Patrol scans for work. Patrol skips Issues with unsatisfied dependencies or explicit wait instructions; priority never reorders the queue.
_Avoid_: Priority Order, Automatic Ranking

**Schedule Window**:
An Issue's optional day-granularity `startDate` and `dueDate`. Gantt draws a bar only when both dates exist; dragging or resizing changes these dates, while dependency links never reschedule Issues automatically.
_Avoid_: Agent Estimate, Automatic Schedule

**Assignee**:
An Issue's optional execution owner: `User` or `Patrol Agent`; absence is `Unassigned`. Patrol may claim only `Unassigned` or `Patrol Agent` Issues and never takes work assigned to `User`.
_Avoid_: Session Binding, Reviewer

**Development Context**:
The dedicated Git branch and worktree bound to an Issue for code execution. Patrol creates it from the Patrol Policy's configured local Base Branch before starting an unbound Issue, runs and resumes the Issue Session there, and marks the Issue `blocked` instead of falling back to the user's current directory when creation is unavailable. Patrol never fetches, pulls, pushes, creates a pull request, merges, or removes the Development Context automatically. A user may remove a clean worktree after its result commit enters Base Branch while retaining the branch, Session, and history.
_Avoid_: Workspace, Session Binding

**Session Binding**:
The durable association between an Issue and the ordinary persistent Harness Session that executes it. The Session remains visible under its Workspace, and Patrol Agent work resumes it after the Issue returns to `todo`.
_Avoid_: Conversation Link, Recent Session

**Patrol Agent**:
An Agent that claims eligible Issues and executes their requested work rather than only inspecting or reporting on them.
_Avoid_: Inspector, Reporting Agent

**Patrol Policy**:
A Workspace's user-controlled, durable fixed-interval scheduled task for Patrol Agent work. It starts disabled and offers `5m`, `30m`, `1h`, `2h`, `6h`, `12h`, and `24h`, with `1h` selected by default. It uses the existing Permission Preset model with Workspace Write selected by default and may explicitly select Danger Full Access or another available preset. Its Base Branch defaults to the Git branch checked out when the user enables Patrol and is configurable for later unbound Issues. It persists the next due time, uses fixed cadence, recalculates the next due time from an interval save, performs one catch-up run after an overdue Host restart, and never queues every missed trigger. An empty inspection does not disable an enabled policy, and only the user changes whether it is enabled. Disabling it prevents new triggers but lets an active run finish at `in_review` or `blocked` before the policy becomes inactive. A user may also start one Run immediately without enabling the fixed-interval schedule.
_Avoid_: Reminder, Auto-pause Rule

**Patrol Run**:
A durable record of an attempt to produce at most one Review Handoff for a Workspace. It records timing, outcome, errors, claimed Issue, Session, commit, and token usage, including empty and skipped scheduled triggers. An empty run never creates a Session. A Tool Approval that moves a claimed Issue to `blocked` does not consume the successful-handoff allowance, so the run may claim another eligible `todo`; reaching `in_review` ends the run. Only one Patrol Run may be active across the Host, and another Workspace's due trigger records `skipped-global-busy` rather than queuing. Any other claimed-work failure marks the Issue `blocked` and ends the Run without an automatic Patrol retry. After a crash, the Host attempts once to recover the unfinished Run with its exact Session and Development Context before accepting a new trigger; failed recovery preserves the artifacts and marks the Issue `blocked`.
_Avoid_: Batch, Sweep
