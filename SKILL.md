---
name: browser-sasiki
description: Use when doing browser automation in a real Chrome session and you want a workspace-first, direct DevTools-backed skill that gets cheaper over time by reusing page knowledge gathered during execution.
---

# Browser Sasiki

## Overview

Use this skill for browser automation tasks in a real Chrome session. This tool exposes a workspace-first HTTP surface backed by a direct DevTools runtime. Think of the process in terms of goal-driven browser work: you open a workspace, act in the tab groups, inspect pages to obtain necessary information, and leave durable cues/knowledge whenever this run discovered something reusable in the future.

## Before You Start

Make sure the target Chrome session is already running with remote debugging enabled.

Ensure the daemon started through the startup helper:

`node scripts/ensure-browser-session.mjs`

This command waits for the daemon to become healthy and prints the current session metadata.

Read `baseUrl` from that JSON output and use it for the remaining HTTP calls. The default is usually `http://127.0.0.1:3456`.

For the curl examples below, the explicit `content-type: application/json` header is optional. The daemon parses the JSON body directly, so the examples keep the request shape minimal.

If you need to read health explicitly after that, use:

`curl -s "$BASE_URL/health"`

## Regular workflow

- Use `POST /workspaces` when you need a fresh workspace entry for a task.
- Use `GET /tabs` when you need the current open-tab inventory for a workspace.
- Use `POST /select-tab` when you know the workspace tab you want to work in.
- Use `POST /navigate`, `POST /click`, `POST /type`, `POST /press`, and `POST /query` when you already know the next browser action.
- Use `POST /query` for contents such as interactive elements or text. 
  - `search` mode provides actionable target uids; Query with `search` mode if you already have the keyword knowledge of potential targets but don't know their `uid`; 
  - `full` mode exposes both text contents and interactive elements in the one-line snapshot text. Use `full` mode if (1) you know nothing about the page (no `knowledgeHits`) and you need to inspect the its structure for your next steps; (2) you need to read the texts.
- Consider using `POST /record-knowledge` during the process whenever a query reveals reusable keywords. A `full` mode query for actionable elements usually indicates the need for such record. 

A common workflow is as follows:

1. Open or refresh the workspace.
2. Select the tab you want.
3. Do the next browser action.
4. Inspect if the next action is still unclear.
5. Record new keyword knowledge for this page.
6. Loop task 2-5 until the task is complete and finish.
7. Inspect whether new knowledge could be further recorded for the next run.

## When To Record Knowledge
**This is very important!!!**
The goal is to leave one reusable hint behind.
You **MUST** call `record-knowledge` when either of these is true:

- you have just used `/query` with full-page exploration to locate an interactive element, and that exploration exposed reusable keywords or page cues that can help later runs read less irrelevant context
- a query search guess successfully revealed a stable reusable cue for the same page or page family

You could only skip recording knowledge if `knowledgeHits` already cover substantially the same cue for the same page

## How To Use Knowledge

- knowledgeHits auto-load on page match during workspace creation, tab actions, and `/query`.
- Consume those returned `knowledgeHits` directly as the reusable page guidance for the current run.

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

### Query Parameters

- `/workspaces`: no body
- `/tabs`: query `workspaceRef`
- `/select-tab`: query `workspaceRef` and `workspaceTabRef`
- `/navigate`: query `workspaceRef`, optional `workspaceTabRef`, and body `url`
- `/click`: query `workspaceRef`, optional `workspaceTabRef`, and body `uid`
- `/type`: query `workspaceRef`, optional `workspaceTabRef`, and body `uid` plus `text`
- `/press`: query `workspaceRef`, optional `workspaceTabRef`, and body `key`
- `/query`: query `workspaceRef`, optional `workspaceTabRef`, and body `mode` plus selectors
- `/record-knowledge`: query `workspaceRef`, optional `workspaceTabRef`, and body `guide`, `keywords`, and required `rationale`

### Examples

```bash
node scripts/ensure-browser-session.mjs

curl -s -X POST "$BASE_URL/workspaces" \
  -d '{}'

curl -s "$BASE_URL/tabs?workspaceRef=workspace_demo"

curl -s -X POST "$BASE_URL/select-tab?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_demo" \
  -d '{}'

curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -d '{"mode":"search","query":"Zara Zhang"}'

curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -d '{"mode":"full"}'

curl -s -X POST "$BASE_URL/navigate?workspaceRef=workspace_demo" \
  -d '{"url":"https://example.com"}'

curl -s -X POST "$BASE_URL/click?workspaceRef=workspace_demo" \
  -d '{"uid":"submit_button"}'

curl -s -X POST "$BASE_URL/record-knowledge?workspaceRef=workspace_demo" \
  -d '{"guide":"Promo code field is below the order summary.","keywords":["checkout","promo","summary"],"rationale":"The order summary and promo field are visible together on the checkout page."}'
```

## Detailed Parameter Explanations

### Workspace and Tab Scope

Use exactly one workspace scope:

- `workspaceRef`: live workspace query. The daemon works against the current browser state for that workspace.
- `workspaceTabRef`: explicit tab selection within a workspace. This is the durable logical tab handle exposed to agents.

The runtime keeps a stricter internal contract:

- each `workspaceTabRef` is bound to a live Chrome `targetId`
- browser `pageId` or tab index is request-local only and may drift when tabs open, close, or reorder
- workspace-scoped requests are serialized in the daemon and refresh live tab truth before and after execution
- `/tabs` and rewritten `### Open tabs` envelopes only expose currently open workspace tabs

### Query Snapshots

Choose one explicit mode for `/query`:

- `mode: "search"`: return compact `matches` only. Each match is concise (`lineNumber`, `role`, `text`, `uid`) and can assist you to find an element reference and its contents. **This should be your default choice as it saves tokens and context.**
- When a text-only AX node maps onto a better actionable ancestor, the returned `uid` is the actionable target and the match may also include `sourceUid` / `sourceText` for provenance.
- `mode: "full"`: return the whole `snapshotText`. **Use this only if you do not/cannot find anything helpful via search mode and need to inspect the page structure.** 

#### Query Search Selectors

Use selector fields only with `mode: "search"`:

- `query`: text contains match
- `role`: exact role match such as `button` or `textbox`
- `uid`: exact element handle from the latest snapshot

`uid` is the only public element handle for browser actions and `/query`. Do not send `ref`.

## Common Failure Mode

- `sleep` does not refresh the current page state. If you need newer page state, query again or perform another browser action.
- `mode` is required for `/query`.
- Use `search` when you want compact element lookup; use `full` when you need whole-page inspection.
- Do not send Playwright-style `element` payloads.
- There is no `/browser-run-code` endpoint in this skill.

## Practical Rules

- Keep one stable workspace for one browser task context.
- `/click` and `/type` accept `uid` from the latest snapshot.
- Start with the smallest call that can prove the next step.
- Prefer `search` over `full` unless you really need page-wide inspection.
- Treat returned `knowledgeHits` as hints, not commands; they narrow exploration but do not replace reading the current page.
- Record only stable, genuinely new cues that should help a later run on the same page or page family.
- Treat the workspace contract as the runtime contract. Do not route around the daemon by reading temp files directly during normal execution.
