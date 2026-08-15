# @deepseek-ai/dsh-taskctl

English | [中文](README.zh.md)

`taskctl` is the machine-readable CLI for the DeepSeek Harness Taskboard Host Remote. Its command grammar is adapted from Dashi Taskboard's Apache-2.0 CLI and changed for Workspace identity, Harness actor attribution, Typert RPC, and the no-delete lifecycle.

## Commands and output

The CLI covers Workspace metadata; Issue list, get, create, update, move, archive, and restore; append-only Comments and Activity; and dependency relation list, add, and remove. Run `taskctl <resource> <action>` with the option reference bundled in [`@deepseek-ai/dsh-skill-manage-taskboard`](../skill-manage-taskboard/README.md).

Each invocation writes exactly one JSON object. Success uses `{ "schemaVersion": 1, "result": ... }`; failure uses `{ "schemaVersion": 1, "error": { "code", "message" } }`.

| Exit code | Meaning |
|---|---|
| `0` | Success |
| `2` | Invalid command or option |
| `3` | Host unavailable or non-successful HTTP response |
| `4` | Invalid response, Remote carrier failure, or Taskboard business failure |
| `5` | Optimistic version conflict |

The default Host origin is `http://127.0.0.1:3080`; `DSH_TASKBOARD_URL` overrides it. Writes use `CODEX_THREAD_ID` as the actor id when available. `DSH_TASKBOARD_ACTOR_TYPE`, `DSH_TASKBOARD_ACTOR_ID`, and `DSH_TASKBOARD_ACTOR_NAME` provide explicit attribution overrides.

Every competing mutation requires `--if-version`. The CLI never retries automatically and has no Issue deletion command.

## Attribution

The argument-dispatch design is adapted from [Dashi Taskboard](https://github.com/chuspeeism/dashi-taskboard). The adapted source carries a modification notice, and [`licenses/Dashi-LICENSE.txt`](licenses/Dashi-LICENSE.txt) contains the upstream Apache License 2.0.

## Model Experience

Indirectly, through the bundled `manage-taskboard` skill that instructs an Agent to call this executable and consume its JSON output.

#### KV Cache effect

Independent of model requests. Command results enter a Session only when a calling tool records them.

## Known Limitations and Deferred Work

- `taskctl` requires a running Web Host and does not launch one.
- Attachments, Patrol eligibility and claims, Session or Git bindings, review evidence, and Patrol policy or Run commands arrive in later stack layers. Critical Patrol transactions call the Host Service directly rather than relying on model-authored CLI commands.
- The CLI performs no GitHub Issue publication or synchronization.
