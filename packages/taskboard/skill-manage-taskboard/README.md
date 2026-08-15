# @deepseek-ai/dsh-skill-manage-taskboard

English | [中文](README.zh.md)

The bundled `manage-taskboard` skill Provider. It makes the Workspace Taskboard workflow available to users and models without requiring a local skill installation.

## Workflow

The skill instructs an Agent to use `taskctl` for durable Issue, Comment, Activity, and relation operations. It requires the Agent to read an Issue and its latest Comments first, claim only `todo` work by moving it to `in_progress`, retry one optimistic conflict only after rereading current state, preserve unrelated work, and never delete an Issue.

Before a review handoff, the Agent must review the change, apply required fixes, run verification, create a commit, append the outcome and remaining risks, move the Issue to `in_review`, and end the current execution round. The skill never authorizes an Agent to move work to `done`; human acceptance owns completion.

The Provider registers a global bundled candidate named `manage-taskboard`. It is both model-invocable and user-invocable, and its resource directory contains the detailed `taskctl` command reference.

## Attribution

The workflow and CLI reference are adapted from [Dashi Taskboard](https://github.com/chuspeeism/dashi-taskboard) and carry modification notices. [`licenses/Dashi-LICENSE.txt`](licenses/Dashi-LICENSE.txt) contains the upstream Apache License 2.0.

## Model Experience

### Skill catalog

#### What the model sees

The model-facing skill catalog includes the `manage-taskboard` name and capped description.

#### Token effect

One fixed name and description entry whenever the skill catalog is visible.

#### KV Cache effect

The stable entry participates in the initial skill catalog and remains prefix-stable while its name and description do not change.

### Loaded workflow

#### What the model sees

Loading the skill adds the workflow body and resource-base guidance to retained tool history; the detailed CLI reference is read only when command syntax is needed.

#### Token effect

One data-dependent skill result containing the workflow body, plus referenced CLI documentation only when the Agent reads it.

#### KV Cache effect

Append-only after the reusable request prefix; loading does not change earlier request content.

## Known Limitations and Deferred Work

- The skill requires the bundled `taskctl` executable and a running Web Host.
- It covers interactive Taskboard work only. The later Host-owned Patrol scheduler performs atomic eligibility, claim, Session binding, and lifecycle writeback directly against the Taskboard Service.
- Attachments, Patrol controls, Git and Session evidence, independent Reviewer results, and human review actions arrive in later stack layers.
