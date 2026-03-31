---
name: browser-skill
description: Use when you want to complete browser automation work through a workspace-first HTTP browser skill that talks directly to an attached Chrome session and gets cheaper and faster over time by reusing page knowledge gathered during execution.
---

# Browser Skill

## Overview

Use this skill for browser automation tasks in a real Chrome session. The daemon owns one reusable browser runtime, attaches to Chrome through direct DevTools access, and exposes a workspace-first HTTP surface. Think in terms of goal-driven browser work: open a workspace, act in the right tab, inspect only when needed, and leave one durable cue behind when this run discovered something reusable.

## Before You Start

Make sure the target Chrome session is already running with remote debugging enabled.

Start or reuse the daemon through the startup helper:

`node scripts/ensure-browser-session.mjs`

This command waits for the daemon to become healthy and prints the current session metadata.

Read `baseUrl` from that JSON output and use it for the remaining HTTP calls. The default is usually `http://127.0.0.1:3456`.

If you need to read health explicitly after that, use:

`curl -s "$BASE_URL/health"`

## Decide The Next Call

- Use `POST /workspaces` when you need a fresh workspace entry for a task.
- Use `GET /tabs` when you need the current tab inventory for a workspace.
- Use `POST /select-tab` when you know the workspace tab you want to work in.
- Use `POST /navigate`, `POST /click`, `POST /type`, `POST /press`, and `POST /query` when you already know the next browser action.
- Use `POST /record-knowledge` before the final answer when this run exposed a stable reusable cue.

Keep the loop small:

1. Open or refresh the workspace.
2. Select the tab you want.
3. Do the next browser action.
4. Inspect only if the next action is still unclear.
5. Finish the task, then record durable knowledge if the write rule fired.

## Knowledge Model

- knowledgeHits auto-load on page match during workspace creation, tab actions, and `/query`.
- Consume those returned `knowledgeHits` directly as the reusable page guidance for the current run.
- `/query` is for the current page state, not durable knowledge.
- There is no separate manual knowledge-read step in the normal flow.

## Parameter Guide

### Runtime Target

Use exactly one workspace scope:

- `workspaceRef`: live workspace query. The daemon works against the current browser state for that workspace.
- `workspaceTabRef`: explicit tab selection within a workspace. The daemon resolves that tab before running the action.

### Query Mode

Choose one explicit mode for `/query`:

- `mode: "search"`: return compact `matches` only. Use this when you need to find an element before a click or type.
- `mode: "full"`: return the whole `snapshotText`. Use this when you need to inspect the page structure or recover context.

### Search Selectors

Use selector fields only with `mode: "search"`:

- `query`: text contains match
- `role`: exact role match such as `button` or `textbox`
- `uid`: exact element handle from the latest snapshot

`uid` is the only public element handle for browser actions and `/query`. Do not send `ref`.

### Action Parameters

- `/workspaces`: no body
- `/tabs`: query `workspaceRef`
- `/select-tab`: query `workspaceRef` and `workspaceTabRef`
- `/navigate`: query `workspaceRef`, optional `workspaceTabRef`, and body `url`
- `/click`: query `workspaceRef`, optional `workspaceTabRef`, and body `uid`
- `/type`: query `workspaceRef`, optional `workspaceTabRef`, and body `uid` plus `text`
- `/press`: query `workspaceRef`, optional `workspaceTabRef`, and body `key`
- `/query`: query `workspaceRef`, optional `workspaceTabRef`, and body `mode` plus selectors
- `/record-knowledge`: query `workspaceRef`, optional `workspaceTabRef`, and body `guide`, `keywords`, and required `rationale`

## When To Use Workspace Scope

- Use `workspaceRef` when you want the current live workspace state.
- Use `workspaceTabRef` when you intentionally want a specific tab inside that workspace.
- If your plan is “query again for something newer”, stay in the same workspace and use the live workspace scope rather than freezing an older snapshot.

## Record Rule

You must successfully call `record-knowledge` before the final answer when either of these is true:

- you have used `/query` with full-page exploration to locate the right element or recover context
- a query result or successful action revealed a stable reusable cue for the same page or page family

If one of those triggers happened and no knowledge was recorded, the task is not complete.

## Common Failure Mode

- `sleep` does not refresh the current page state. If you need newer page state, query again or perform another browser action.
- `mode` is required for `/query`.
- Use `search` when you want compact element lookup; use `full` when you need whole-page inspection.
- Do not send Playwright-style `element` payloads.
- There is no `/browser-run-code` endpoint in this skill.

## Endpoints

- `GET /health`
- `POST /workspaces`
- `GET /tabs`
- `POST /select-tab`
- `POST /navigate`
- `POST /click`
- `POST /type`
- `POST /press`
- `POST /query`
- `POST /record-knowledge`
- `POST /shutdown`

## Startup Front Door

Use `node scripts/ensure-browser-session.mjs` only to start or reuse the daemon.

- It waits for `/health` and prints the current session metadata.
- After that, keep using the daemon's HTTP endpoints directly.
- Do not introduce a second shell RPC layer for browser actions.

## Request Examples

```bash
node scripts/ensure-browser-session.mjs

curl -s -X POST "$BASE_URL/workspaces" \
  -H 'content-type: application/json' \
  -d '{}'

curl -s "$BASE_URL/tabs?workspaceRef=workspace_demo"

curl -s -X POST "$BASE_URL/select-tab?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_demo" \
  -H 'content-type: application/json' \
  -d '{}'

curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"mode":"search","query":"Zara Zhang"}'

curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"mode":"full"}'

curl -s -X POST "$BASE_URL/navigate?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com"}'

curl -s -X POST "$BASE_URL/click?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"uid":"submit_button"}'

curl -s -X POST "$BASE_URL/record-knowledge?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"guide":"Promo code field is below the order summary.","keywords":["checkout","promo","summary"],"rationale":"The order summary and promo field are visible together on the checkout page."}'
```

## Practical Rules

- Keep one stable workspace for one browser task context.
- `/click` and `/type` accept `uid` from the latest snapshot.
- Start with the smallest call that can prove the next step.
- Prefer `search` over `full` unless you really need page-wide inspection.
- Treat returned `knowledgeHits` as hints, not commands; they narrow exploration but do not replace reading the current page.
- Record only stable cues that should help a later run on the same page or page family.
- Treat the workspace contract as the runtime contract. Do not route around the daemon by reading temp files directly during normal execution.
