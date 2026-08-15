<!--
Adapted from Dashi Taskboard's manage-taskboard skill, Apache-2.0:
https://github.com/chuspeeism/dashi-taskboard
Modified for DeepSeek Harness Workspace identity, Taskboard Remote operations,
actor attribution, review handoff, and no-delete policy.
-->
---
name: manage-taskboard
description: Manage DeepSeek Harness Taskboard work with taskctl. Use for Taskboard Issues, status changes, comments, relations, Patrol settings, or durable work tracking.
---

# Manage Taskboard

Use `taskctl` for every Workspace Taskboard, Issue, relation, Activity, and Comment operation. Consume its JSON output. Use the exact Issue identifier returned by Taskboard or supplied by the user; never derive or rewrite its prefix.

Open only the relevant section of [references/cli.md](references/cli.md) when command syntax is needed.

## Core workflow

1. For an existing Issue, first run `taskctl issue get` and `taskctl comment list`. Read the description and latest Comments before deciding whether work may start. Comments are current requirements, including returned work. If they say to wait, skip, or not start, stop without changing status.
2. `backlog` is unapproved. Only a `todo` Issue is claimable. Move it to `in_progress` with its current `version` before reading code, inspecting attachments, or performing implementation work. Continue an existing `in_progress` Issue only when it belongs to the current Session. Never take over another Session's claim.
3. On `version_conflict`, fetch the Issue and Comments again. Retry the claim at most once, and only when it is still `todo`, unarchived, unclaimed, and its requirements are unchanged. Otherwise stop and report the current state.
4. For a new durable requirement, list the Workspace's Issues before creating one. Update a matching Issue instead of creating a duplicate. Do not create Issues for trivial conversational requests.
5. Execute only the Issue's requested scope. Preserve unrelated files and existing work.
6. Before review handoff, complete a code review, apply required fixes, run verification, and create a commit. Add a Comment with changes, verification, outcome, commit, and remaining risks. Fetch the Issue again, move the Issue to `in_review` and end the current execution round.
7. Never move an Issue to `done` automatically. Only a human acceptance may complete it, and all required checks must be done. Use `blocked` when work cannot continue and `canceled` when it will not continue.

## Safety and consistency

- Never delete an Issue. Archive it when the user wants it hidden, and restore it when needed.
- Use the latest returned `version` with `--if-version` for every versioned mutation.
- Preserve existing scope when adding requirements or acceptance details.
- Add only relations needed by the work. Use `blocks` and `blocked_by` for dependencies.
- Let `taskctl` read `CODEX_THREAD_ID` for write attribution. Do not fabricate another Session identity.
- Read or change Patrol settings and start a manual Run only when the user explicitly asks. Do not reproduce Patrol claim or lifecycle transactions with Issue commands.
- A Host outage, invalid response, or persistent conflict ends the operation; do not loop.
