# @deepseek-ai/dsh-taskboard-patrol

English | [中文](README.zh.md)

Host execution support for Workspace Taskboard Patrol. `ctx.taskboardPatrol` turns an already durable `PatrolAttempt` into one persistent Development Context and one ordinary visible Harness Session.

- A never-bound Issue captures the selected local Base Branch, Agent Preset, provider, model, reasoning effort, and Permission Preset. A returned Issue reuses those values instead of reading later Policy changes.
- Each Issue owns one `dsh-task/<issue-identifier>` branch and one permanent Host-managed worktree. The Session cwd preserves the Workspace's relative directory when the Workspace is below the repository root.
- The Git adapter uses argument-vector local commands only: repository/ref inspection, `worktree add`, ancestry checks, status, diff, and commit reads. It contains no fetch, pull, push, merge, reset, branch deletion, worktree removal, or pull-request operation.
- A reserved Session id may be created after provisioning failed before its first persistence. Once first persistence is recorded, a cold Session resumes that exact id and a missing Session fails instead of creating a replacement. A live bound Session is borrowed only while idle and only when its cwd and Agent Preset still match.
- New Sessions join the selected Agent Preset before publication, record their Permission Preset, retain logged model selection on resume, attach to the owning Workspace, and flush before execution begins.
- Each execution lease answers every tool approval request with `rejected`, records the requested tool and reason, and cancels that turn. The Patrol coordinator owns the resulting Attempt and Issue writeback.
- The coordinator schedules enabled Policies from their durable `nextDueAt`, scans only `todo` Issues in manual order, and skips User assignments, explicit waits, and dependencies whose `done` result commit is not integrated into the Issue's fixed Base Branch.
- One Run ends after one reviewed Issue reaches `in_review`. Only an Attempt blocked by a tool approval may continue to another eligible `todo`; every other failure blocks the claimed Issue and ends the Run.
- On startup, the coordinator recovers the single durable active Run before scheduling new due triggers. An active Attempt resumes only its exact bound Session and worktree. Existing Reviewer evidence is reused; otherwise the resumed implementation Session receives one recovery turn before review. A missing or mismatched binding ends the Run and Attempt as failed, moves the Issue to `blocked`, and never creates a replacement Session.
- The implementation Agent must leave a clean committed Base Branch diff. A separate persistent Reviewer Session receives that committed diff, inherits the saved model composition, exposes only its structured review-submission tool, and always uses read-only sandboxing with approval policy `never`. The implementation Session then receives the durable findings for one correction and verification turn before human handoff.
- `configuration()` discovers local branches, mountable Agent Presets, live provider/model/reasoning choices, and existing Permission Presets. `updatePolicy()` validates those Host-owned choices before the version-checked save. `trigger()` starts a manual Run without enabling the fixed schedule.

The scheduler is in-process: while the Host is stopped it cannot run. The Taskboard Policy retains cadence; startup finishes active-Run recovery first, then consumes at most one overdue trigger.

## Model Experience

### Implementation assignment

#### What the model sees

The implementation Agent receives `Issue.identifier`, the title, description, lifecycle requirements, local Git restrictions, and review-handoff requirements as a plugin-authored user message.

#### Token effect

One retained user message adds the Issue content and fixed execution instructions to the existing implementation Session.

#### KV Cache effect

Append-only after the implementation Session's reusable prefix.

### Independent review assignment

#### What the model sees

The Reviewer receives the exact preliminary commit and its bounded Base Branch diff, then returns structured findings through `patrol_review_submit`, its only tool.

#### Token effect

One retained user message adds the Issue, commit, diff statistics, and bounded patch to the independent Reviewer Session.

#### KV Cache effect

Append-only after the Reviewer Session's reusable prefix.

### Correction assignment

#### What the model sees

The implementation Session receives the durable verdict, findings, verification, and risks with instructions to correct, verify, and commit the result.

#### Token effect

One retained user message adds the structured review evidence to the existing implementation Session.

#### KV Cache effect

Append-only after the implementation Session's reusable prefix. Policy discovery and timer checks do not affect model requests.

### Recovery assignment

#### What the model sees

When process loss interrupted an Attempt before Reviewer evidence was stored, the exact implementation Session receives the Issue again with instructions to inspect its prior transcript and current permanent worktree, avoid repeating completed work, verify, and commit. If Reviewer evidence already exists, recovery skips this assignment and resumes from the correction assignment.

#### Token effect

One retained user message adds the recovery instruction and Issue content only when no durable review checkpoint exists.

#### KV Cache effect

Append-only after the recovered implementation Session's existing reusable prefix.

## Known Limitations and Deferred Work

- It supports only local Git repositories and permanent local worktrees; remote fetch, push, pull-request, merge, and cleanup operations are deliberately absent.
- Version one never publishes Taskboard Issues to `deepseek-ai/deepseek-harness` GitHub Issues.
