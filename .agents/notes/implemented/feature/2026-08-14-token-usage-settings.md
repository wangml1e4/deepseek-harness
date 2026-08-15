# Agent Note: Persisted token activity in Settings

Status: implemented

English | [中文](2026-08-14-token-usage-settings.zh.md)

## Problem

A session-wide token total cannot be assigned to its latest update date without misreporting work that crosses a day boundary. The loaded conversation window also omits cold sessions and older pages, so a browser-only history fold cannot provide a complete settings summary.

## Decision

Token-meter owns a `tokenActivity` session projection beside `tokenUsage`. It replays the same provider-reported, mutually exclusive uncached-input, cache-read, cache-write, and output buckets into calendar-day rows. A final assistant usage sample replaces a chunk for the same `(turn, step)` and may move it between rows when their event times cross local midnight. Reasoning remains part of output and is not added separately.

A direct user message selects its Host-validated `clientTimeZone` for admitted work. Missing or malformed direct-user zone provenance means UTC. Each usage sample is dated at the sample's durable event time. The projection also records the maximum elapsed time from a matching `turn/start` to a `turn/end` whose reason is `completed`; aborted, incomplete, and mismatched turns contribute no duration.

The Token usage client package registers its page through `settings.section`. It receives the root-scoped `useSessions` hook through standard slot props and folds every unique `SessionListState.ids` entry once. This makes ordinary, forked, and subagent sessions follow the list's existing product visibility without a second lineage traversal. When a visible row lacks `tokenActivity`, the injected sessions face calls `hydrateProjection` for only those unique ids. Requests run serially and use `session.history({ projectionsOnly: true })`: attached sessions return the registry's live cut; cold sessions run the projection cache's version-aware cached-row + persistence-tail restore and durable write-back. The result seeds the existing higher-seq-wins client store. Thus `session.list` stays zero full-log I/O while an old cache row is repaired without opening/resuming the session. Loading, failure, and genuine zero usage are distinct page states.

The browser's explicit IANA zone defines today. Daily view shows the current month plus the preceding eleven months in a Monday-first calendar grid, weekly view shows 52 Monday-start weeks, and monthly view shows 12 calendar months. Peak usage is the maximum selected visible period. Total usage and longest streak cover all projected history. A positive-token day is active; the current streak ends today when today is active, may end yesterday, and otherwise is zero.

## Alternatives considered

**Assign the session total to `updatedAt`.** This loses every earlier day in a cross-day session and changes old history when the session receives later work.

**Fold the loaded client event window.** The window is paged and current-session-scoped, so cold sessions and older usage disappear from the result.

**Scan persisted logs from the settings page.** Browser components cannot access Host context or subscribe to an external source, and a settings read must not turn the session list into unbounded I/O.

**Treat a missing cold key as zero forever.** That preserves list latency but makes an upgrade permanently undercount sessions the durable log can reconstruct. Explicit projection hydration keeps list reads bounded and makes the page exact.

**Store presentation summaries in the session log.** A derived chart is not model-visible domain input. Adding UI records would change durable and prompt-facing contracts for data already reconstructible from existing events.

## Consequences

Calendar totals are replayable from durable logs, share standard projection cache versioning, and reach cold list rows through the existing projection baseline plus on-demand repair. The page adds no log records, model calls, prompts, or KV-cache changes. Old cold cache rows show a loading state, become exact through the cold ladder, and retain the rebuilt key for later zero-I/O lists; failures are labeled incomplete and retryable instead of being presented as zero. Provider omissions are represented honestly as zero rather than inferred usage.
