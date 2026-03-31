---
name: browser-skill
description: Use when you want to complete browser automation work through a self-evolving HTTP browser skill that gets cheaper and faster over time by reusing page knowledge gathered during execution.
---

# Browser Skill

## Overview

Use this skill for browser automation tasks. The skill keeps one daemon-owned browser session alive and exposes one HTTP endpoint per browser operation. Finish the browser task first, and leave one durable page cue behind when the run uncovers something that should make later runs faster.

## Start

Make sure the target Chrome session is already running with remote debugging enabled and Chrome DevTools MCP can attach. Then start the daemon:

`node scripts/browser-sessiond.mjs`

Confirm it is healthy:

`curl -s http://127.0.0.1:3456/health`

That establishes the reusable browser runtime for the rest of the task.

## Normal Flow

1. Call `/capture` to establish or refresh the browser workspace.
2. Use `/navigate`, `/click`, `/type`, `/press`, and `/select-tab` to do the browser work.
3. Use `/query-snapshot` only when you need more page inspection before the next action.
4. Before the final answer, write one `record-knowledge` entry when the trigger rule below fires.

## Knowledge Model

- knowledgeHits auto-load on page match during `/capture`, browser actions, and `/query-snapshot`.
- Consume those returned `knowledgeHits` directly as the reusable page guidance for the current run.
- `/query-snapshot` is for the current page state, not durable knowledge.
- There is no separate manual knowledge-read step in the normal flow.

## Record Rule

You must successfully call `record-knowledge` before the final answer when either of these is true:

- you have used `/query-snapshot` with full-page exploration to locate the right element or recover context
- a query result or successful action revealed a stable reusable cue for the same page or page family

If one of those triggers happened and no knowledge was recorded, the task is not complete.

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
  -d '{"tabRef":"main","mode":"auto"}'

curl -s -X POST http://127.0.0.1:3456/navigate \
  -d '{"tabRef":"main","url":"https://example.com"}'

curl -s -X POST http://127.0.0.1:3456/click \
  -d '{"tabRef":"main","uid":"submit_button"}'

curl -s -X POST http://127.0.0.1:3456/record-knowledge \
  -d '{"tabRef":"main","guide":"Promo code field is below the order summary.","keywords":["checkout","promo","summary"]}'
```

## Practical Rules

- Keep one stable `tabRef` for one browser task context.
- Prefer `/query-snapshot` with auto mode for normal retrieval and use full-page exploration only when needed.
- `/click` and `/type` accept `uid` from the latest snapshot, and also accept `ref` as a narrow alias for Playwright-style `[ref=...]` lines. Prefer `uid` when both are available.
- Do not send Playwright-style `element` objects or call MCP-only tools such as `browser-run-code`; there is no `/browser-run-code` endpoint in this skill.
- Record only stable cues that should help a later run on the same page or page family.
- Treat `tabRef` and `snapshotRef` as the runtime contract. Do not route around the daemon by reading temp files directly during normal execution.
