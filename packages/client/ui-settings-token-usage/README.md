# @deepseek-ai/dsh-client-ui-settings-token-usage

English | [中文](README.zh.md)

Standalone Token usage section for the 800px settings shell. The browser plugin registers one `settings.section` entry, reads the framework-provided root `useSessions` hook, and receives projection hydration through the injected `ctx.sessions` face. It folds each unique session-list id once, so ordinary, forked, and subagent sessions follow the product's existing visible-list scope without lineage duplication.

The page combines the durable `tokenActivity` projection from every visible persisted session. Its total is uncached input plus cache reads, cache writes, and output; reasoning is not added separately. When a visible row lacks the key (including a cold cache row written before this projection existed), the page serially asks the sessions service for an exact projection-only baseline. The Host uses the live registry cut or cold cache ladder and writes rebuilt cold checkpoints back; `session.list` itself remains zero full-log I/O. Loading and per-session failure are shown separately from a genuine zero-usage state.

## Calendar semantics

Day boundaries use the browser's explicit IANA time zone. Daily view covers the current calendar month and the preceding eleven months in a Monday-first seven-row grid; weekly view covers 52 Monday-start weeks; monthly view covers 12 calendar months. Peak tokens are recomputed from the selected visible periods. Total tokens and streaks use all projected history.

An active day has a positive token total. The current streak ends today when today is active, otherwise it may end yesterday; if neither day is active it is zero. The longest streak spans all history. Longest completed work is the maximum durable matching `turn/start` to successful `turn/end` elapsed time supplied by the projection.

The five summaries form one divided statistics bar with values above labels and wrap to two columns at narrow widths. Visual numbers use compact locale formatting, while titles and accessible names expose the full integer. Durations use localized hour/minute/second units. Every real heat cell is a keyboard-focusable button named with its date or period and exact token count; the intensity legend and neutral zero grid supplement color.

## Composition

```yaml
- name: '@deepseek-ai/dsh-client-ui-settings-token-usage'
```

The package requires client runtime, settings, and locale plugins. Its Host half is empty; all registration is Cordis-effect-owned in the browser half.

## Model Experience

None, as the page only renders persisted projections and does not add prompts, messages, tools, schemas, model calls, or session-log events.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- A failed exact projection load leaves known sessions visible and marks the aggregate incomplete; Retry repeats only the still-missing identities. It is never presented as the genuine zero state.
- Each provider bucket preserves the existing number contract; client aggregation converts buckets to `bigint` before cross-session addition, so formatting does not add precision loss.
