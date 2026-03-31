---
name: browser-skill
description: Use when you want to complete browser automation work through a self-evolving HTTP browser skill that gets cheaper and faster over time by reusing page knowledge gathered during execution.
---

# Browser Skill

## Overview

Use this skill for browser automation tasks in a real Chrome session. The daemon owns one reusable browser runtime and exposes a small HTTP tool surface. Think in terms of goal-driven browser work: capture context, act, inspect only when needed, and leave one durable cue behind when this run discovered something reusable.

## Before You Start

Make sure the target Chrome session is already running with remote debugging enabled and Chrome DevTools MCP can attach.

Start the daemon:

`node scripts/browser-sessiond.mjs`

Confirm it is healthy:

`curl -s http://127.0.0.1:3456/health`

Do not start browser work until `/health` returns `ok: true`.

## Decide The Next Call

- Use `/capture` when you need to establish or refresh a workspace tab for a task.
- Use `/navigate`, `/click`, `/type`, `/press`, and `/select-tab` when you already know the next browser action.
- Use `/query-snapshot` only when you need more page inspection before the next action.
- Use `/record-knowledge` before the final answer when this run exposed a stable reusable cue.

Keep the loop small:

1. Capture or refresh context.
2. Do the next browser action.
3. Inspect only if the next action is still unclear.
4. Finish the task, then record durable knowledge if the write rule fired.

## Knowledge Model

- knowledgeHits auto-load on page match during `/capture`, browser actions, and `/query-snapshot`.
- Consume those returned `knowledgeHits` directly as the reusable page guidance for the current run.
- `/query-snapshot` is for the current page state, not durable knowledge.
- There is no separate manual knowledge-read step in the normal flow.

## Parameter Guide

### Runtime Target

Use exactly one:

- `tabRef`: live tab query. The daemon refreshes the bound browser tab first, then runs the query against that fresh snapshot.
- `snapshotRef`: exact snapshot query. The daemon reads that stored snapshot as-is. Repeating the same `snapshotRef` query later does not make it newer.

### Query Mode

Choose one explicit mode for `/query-snapshot`:

- `mode: "search"`: return compact `matches` only. Use this when you need to find an element before a click or type.
- `mode: "full"`: return the whole `snapshotText`. Use this when you need to inspect the page structure or recover context.

### Search Selectors

Use selector fields only with `mode: "search"`:

- `query`: text contains match
- `role`: exact role match such as `button` or `textbox`
- `uid`: exact element handle from the latest snapshot

`uid` is the only public element handle for browser actions and `query-snapshot`. Do not send `ref`.

### Action Parameters

- `/capture`: normally send `tabRef`
- `/navigate`: send `tabRef` and `url`
- `/click`: send `tabRef` and `uid`
- `/type`: send `tabRef`, `uid`, and `text`
- `/press`: send `tabRef` and `key`
- `/select-tab`: send `tabRef` and `pageId`

### When To Use `tabRef` vs `snapshotRef`

- Use `tabRef` when you want the latest live page state.
- Use `snapshotRef` only when you intentionally want the exact older snapshot again.
- If your plan is “query again for something newer”, use `tabRef`, not `snapshotRef`.

## Record Rule

You must successfully call `record-knowledge` before the final answer when either of these is true:

- you have used `/query-snapshot` with full-page exploration to locate the right element or recover context
- a query result or successful action revealed a stable reusable cue for the same page or page family

If one of those triggers happened and no knowledge was recorded, the task is not complete.

## Common Failure Mode

- `sleep` does not refresh a stored snapshot. If you need newer page state, query by `tabRef` or perform another browser action.
- `query-snapshot(snapshotRef)` is exact lookup, not live polling.
- `mode` is required for `/query-snapshot`.
- Use `search` when you want compact element lookup; use `full` when you need whole-page inspection.
- Do not send Playwright-style `element` payloads.
- There is no `/browser-run-code` endpoint in this skill.

## Endpoints

- `GET /health`
- `POST /capture`
- `POST /navigate`
- `POST /click`
- `POST /type`
- `POST /press`
- `POST /select-tab`
- `POST /query-snapshot`
- `POST /record-knowledge`
- `POST /shutdown`

## Request Examples

```bash
curl -s http://127.0.0.1:3456/health

curl -s -X POST http://127.0.0.1:3456/capture \
  -d '{"tabRef":"main"}'

curl -s -X POST http://127.0.0.1:3456/query-snapshot \
  -d '{"tabRef":"main","mode":"search","query":"Zara Zhang"}'

curl -s -X POST http://127.0.0.1:3456/query-snapshot \
  -d '{"tabRef":"main","mode":"full"}'

curl -s -X POST http://127.0.0.1:3456/query-snapshot \
  -d '{"snapshotRef":"snapshot_demo","mode":"search","uid":"submit_button"}'

curl -s -X POST http://127.0.0.1:3456/navigate \
  -d '{"tabRef":"main","url":"https://example.com"}'

curl -s -X POST http://127.0.0.1:3456/click \
  -d '{"tabRef":"main","uid":"submit_button"}'

curl -s -X POST http://127.0.0.1:3456/record-knowledge \
  -d '{"tabRef":"main","guide":"Promo code field is below the order summary.","keywords":["checkout","promo","summary"]}'
```

## Practical Rules

- Keep one stable `tabRef` for one browser task context.
- `/click` and `/type` accept `uid` from the latest snapshot.
- Start with the smallest call that can prove the next step.
- Prefer `search` over `full` unless you really need page-wide inspection.
- Treat returned `knowledgeHits` as hints, not commands; they narrow exploration but do not replace reading the current page.
- Record only stable cues that should help a later run on the same page or page family.
- Treat `tabRef` and `snapshotRef` as the runtime contract. Do not route around the daemon by reading temp files directly during normal execution.
