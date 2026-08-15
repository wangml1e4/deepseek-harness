# @deepseek-ai/dsh-taskboard-patrol

English | [中文](README.zh.md)

Host execution support for Workspace Taskboard Patrol. `ctx.taskboardPatrol` turns an already durable `PatrolAttempt` into one persistent Development Context and one ordinary visible Harness Session.

- A never-bound Issue captures the selected local Base Branch, Agent Preset, provider, model, reasoning effort, and Permission Preset. A returned Issue reuses those values instead of reading later Policy changes.
- Each Issue owns one `dsh-task/<issue-identifier>` branch and one permanent Host-managed worktree. The Session cwd preserves the Workspace's relative directory when the Workspace is below the repository root.
- The Git adapter uses argument-vector local commands only: repository/ref inspection, `worktree add`, ancestry checks, status, diff, and commit reads. It contains no fetch, pull, push, merge, reset, branch deletion, worktree removal, or pull-request operation.
- A reserved Session id may be created after provisioning failed before its first persistence. Once first persistence is recorded, a cold Session resumes that exact id and a missing Session fails instead of creating a replacement. A live bound Session is borrowed only while idle and only when its cwd and Agent Preset still match.
- New Sessions join the selected Agent Preset before publication, record their Permission Preset, retain logged model selection on resume, attach to the owning Workspace, and flush before execution begins.
- Each execution lease answers every tool approval request with `rejected`, records the requested tool and reason, and cancels that turn. The Patrol coordinator owns the resulting Attempt and Issue writeback.

This package does not schedule timers, scan or claim Issues, prompt an Agent, run the independent Reviewer, or change human-review status. Those orchestration operations are later Consumers over the durable Taskboard and this service.

## Model Experience

Indirectly, through the later Patrol coordinator that prompts the prepared Agent Session. This package does not add model-visible content by itself.

#### KV Cache effect

Independent of model requests because Session and Git preparation does not change a request prefix.

## Known Limitations and Deferred Work

- This package does not yet own the timer, Issue eligibility scan, Agent prompt, independent Reviewer, or human-review controls.
- It supports only local Git repositories and permanent local worktrees; remote fetch, push, pull-request, merge, and cleanup operations are deliberately absent.
