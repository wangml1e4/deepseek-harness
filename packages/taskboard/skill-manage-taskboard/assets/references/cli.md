<!--
Adapted from Dashi Taskboard's taskctl reference, Apache-2.0:
https://github.com/chuspeeism/dashi-taskboard
Modified for the DeepSeek Harness Taskboard Remote command set.
-->
# taskctl CLI

`taskctl` emits one JSON object. Successful output contains `schemaVersion` and `result`; errors contain `schemaVersion` and `error`. Exit codes are `0` for success, `2` for invalid input, `3` when the Host is unavailable, `4` for Remote or response failures, and `5` for optimistic version conflicts.

Set `DSH_TASKBOARD_URL` to override the default Web Host origin, `http://127.0.0.1:3080`. Writes use `CODEX_THREAD_ID` as the stable actor id when it is available. `DSH_TASKBOARD_ACTOR_NAME` changes the captured display name.

## Workspace Taskboard

```bash
taskctl workspace get WORKSPACE_ID
taskctl workspace prefix WORKSPACE_ID --prefix PREFIX --if-version N
```

## Read Issues

```bash
taskctl issue list --workspace WORKSPACE_ID [--status STATUS] [--priority PRIORITY] [--label LABEL] [--assignee ASSIGNEE] [--archived exclude|include|only] [--query TEXT]
taskctl issue get ISSUE_ID
```

## Create and update Issues

```bash
taskctl issue create --workspace WORKSPACE_ID --title TITLE [--description TEXT] [--status STATUS] [--priority PRIORITY] [--labels a,b] [--assignee ASSIGNEE] [--start-date YYYY-MM-DD] [--due-date YYYY-MM-DD]
taskctl issue update ISSUE_ID --if-version N [--title TITLE] [--description TEXT] [--status STATUS] [--priority PRIORITY] [--labels a,b] [--assignee ASSIGNEE] [--start-date YYYY-MM-DD] [--due-date YYYY-MM-DD] [--sort-order N] [--return-reason TEXT]
taskctl issue move ISSUE_ID --workspace WORKSPACE_ID --if-version N
taskctl issue archive ISSUE_ID --if-version N
taskctl issue restore ISSUE_ID --if-version N
```

Statuses are `backlog`, `todo`, `in_progress`, `in_review`, `blocked`, `done`, and `canceled`. Priorities are `none`, `urgent`, `high`, `medium`, and `low`. Assignees are `unassigned`, `user`, and `patrol_agent`. An empty `--start-date=` or `--due-date=` clears that date during update.

## Comments and Activity

```bash
taskctl comment list ISSUE_ID
taskctl comment add ISSUE_ID --body TEXT
taskctl activity list ISSUE_ID
```

Comments and Activity are append-only.

## Attachments

```bash
taskctl attachment list ISSUE_ID
taskctl attachment add ISSUE_ID --file PATH --if-version N [--name NAME] [--media-type TYPE]
taskctl attachment download ISSUE_ID ATTACHMENT_ID --output PATH
taskctl attachment delete ISSUE_ID ATTACHMENT_ID --if-version N --confirm
```

Uploads accept any file type up to 25 MB. Downloads refuse to overwrite an existing output path. Attachment deletion is permanent and requires the user's explicit request plus `--confirm`; this exception does not permit deleting an Issue, Comment, Activity entry, or Patrol history.

## Relations

```bash
taskctl relation list ISSUE_ID
taskctl relation add ISSUE_ID --type blocks|blocked_by --issue RELATED_ISSUE_ID --if-version N
taskctl relation remove ISSUE_ID RELATION_ID --if-version N
```

Relations stay within one Workspace. Self-relations, duplicates, and cycles are rejected.

## Patrol

```bash
taskctl patrol get WORKSPACE_ID
taskctl patrol update WORKSPACE_ID --if-version N [--enabled true|false] [--interval 5m|30m|1h|2h|6h|12h|24h] [--base-branch BRANCH] [--agent-preset PRESET] [--provider PROVIDER] [--model MODEL] [--reasoning-effort EFFORT] [--permission-preset PRESET]
taskctl patrol run WORKSPACE_ID [--issue ISSUE_ID]
taskctl patrol issue ISSUE_ID
```

An empty `--agent-preset=`, `--provider=`, `--model=`, or `--reasoning-effort=` restores the Host or model default for later unbound Issues. `patrol run` starts one manual Run without enabling the saved schedule. Critical eligibility, claim, Session binding, approval handling, review, and lifecycle writes remain Host-owned operations.
