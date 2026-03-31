---
name: browser-skill
description: Use when you want to complete browser automation work through a self-evolving skill that gets cheaper and faster over time by reusing page knowledge gathered during execution.
---

# Browser Skill

## Overview

This is a browser automation skill. If the task is to get something done in a browser, you should normally use this skill as the default path. Its first job is to help you finish the current browser task. Its second job is to improve future browser automation by reusing page-level knowledge gathered during real execution.

## When To Use

Use it whenever the underlying job is browser automation: navigating a site, clicking through flows, typing into forms, switching tabs, checking page state, or completing a browser workflow end to end. Do not use it as a generic knowledge-writing skill when there is no real browser task to complete.

## How To Start

Make sure the target Chrome session is already running with remote debugging enabled, and allow Chrome DevTools MCP to attach if Chrome asks. Then start with `node dist/scripts/capture.js --tab-ref <tabRef>`. That establishes a trustworthy browser context for the current task.

Default capture behavior is now workspace-oriented:

- first `capture --tab-ref <tabRef>` creates a new workspace tab for that agent context
- later `capture --tab-ref <same-tabRef>` refreshes that existing bound tab
- binding an already open tab requires explicit intent through `--page-id` on `capture` or `select-tab` later

If capture fails because Chrome is not attachable, open `chrome://inspect/#remote-debugging` in Chrome, turn remote debugging on, allow the MCP connection if prompted, and then retry capture.

## Recommended Flow

Treat this skill as browser automation first.

1. Start with `capture.js` to establish or refresh a workspace.
2. Use `navigate.js`, `click.js`, `type.js`, `press.js`, and `select-tab.js` to do the actual browser work.
3. Use `query-snapshot.js` only when you need extra page inspection to decide what to do next.
4. Use knowledge commands only when the current run uncovers something stable that should help a later run on the same page.

Before you give the final answer, run one `record-knowledge.js` write when either of these is true:

- you had to use a full snapshot to locate the right element or recover context
- a query or successful action revealed a stable reusable cue that should help later runs on the same page or page family

When recording from the current browser context, prefer the low-friction path: pass `--tab-ref` or `--snapshot-ref` plus `--guide` and `--keywords`, and let the daemon fill in the current page identity.

The agent does not need to reason about runtime ownership, sockets, or daemon internals here. The front door is the CLI command set.

## Command Surface

At the CLI level, the skill currently exposes these commands:

- `node dist/scripts/capture.js --tab-ref <tabRef>`
- `node dist/scripts/navigate.js --tab-ref <tabRef> --url <absolute-url>`
- `node dist/scripts/click.js --tab-ref <tabRef> --uid <element-uid>`
- `node dist/scripts/type.js --tab-ref <tabRef> --uid <element-uid> --text <value>`
- `node dist/scripts/press.js --tab-ref <tabRef> --key <key-name>`
- `node dist/scripts/select-tab.js --tab-ref <tabRef> --page-id <page-id>`
- `node dist/scripts/query-snapshot.js --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--uid <uid>]`
- `node dist/scripts/read-knowledge.js --origin <origin> --normalized-path <path>`
- `node dist/scripts/record-knowledge.js --tab-ref <tabRef> --guide <text> --keywords <comma-separated>`

Use the README as the denser operator-facing reference for installation and exact command details. After installation, call the compiled `dist/scripts/*.js` entrypoints rather than the `.ts` source files.

### Argument Meanings

- `tabRef`: the agent-facing logical workspace handle. It points to one bound Chrome tab and its latest snapshot.
- `snapshotRef`: the daemon-generated handle for a stored snapshot. This is the only snapshot lookup handle normal agent flows should depend on.
- `uid`: the Chrome DevTools accessibility-tree element handle from the latest snapshot. This is the canonical element selector.
- `page-id`: the Chrome DevTools page handle used by `list_pages` / `select_page`.
- `page-id`: explicit override for binding an already open tab instead of creating a new workspace tab.

### `tabRef` Rules

- `tabRef` is a skill-owned workspace name, not a Chrome-provided page id.
- Prefer passing a stable `--tab-ref` such as `work`, `checkout`, or `baidu-fashion` so later commands can reuse the same workspace.
- If `capture` is called without `--tab-ref`, the skill mints one locally and returns it in the capture result.
- The `tabs` array returned by `capture` is the Chrome page inventory, not a list of `tabRef` values.

### Knowledge Rules

- `read-knowledge.js` is for reuse. Use it when you want durable page guidance for a known page or workspace before acting.
- `record-knowledge.js` is for successful discoveries. Use it only after you have learned something stable and reusable, not for temporary observations.
- before finishing, record one reusable cue whenever full-snapshot exploration or an accurate query materially helped you find the right element
- `query-snapshot.js` is not durable knowledge. It is for inspecting the current page state.
- Do not start with knowledge commands unless the task already depends on previously learned page guidance.

### Command Details

- `capture.js`
  - purpose: create or refresh an agent workspace
  - recommended: `--tab-ref <tabRef>`
  - optional: `--page-id <page-id>` to bind an already open tab explicitly
  - alias: `--tab-index` remains accepted during migration
  - default behavior: first use for a new `tabRef` opens a new workspace tab
- `navigate.js`
  - required: `--tab-ref`, `--url`
  - purpose: navigate the bound workspace tab to an absolute URL
- `click.js`
  - required: `--tab-ref`, `--uid`
  - alias: `--ref` remains accepted during migration
  - purpose: click an element from the latest snapshot
- `type.js`
  - required: `--tab-ref`, `--uid`, `--text`
  - alias: `--ref` remains accepted during migration
  - note: `submit` is still an explicit failure path in the current daemon-backed contract; use a follow-up `press.js` instead
- `press.js`
  - required: `--tab-ref`, `--key`
  - purpose: send a keyboard action to the bound tab
- `select-tab.js`
  - required: `--tab-ref`, `--page-id`
  - aliases: `--index`, `--tab-index`
  - purpose: rebind a workspace to another already open Chrome page
- `query-snapshot.js`
  - required: `--mode`
  - requires one snapshot source: `--tab-ref`, `--snapshot-ref`, or `--snapshot-text`
  - `search` mode also requires at least one selector: `--query` / `--text`, `--role`, `--uid`, or `--ref`
  - only `full` results, or `auto` when it truly falls back to full, should include `snapshotText`
  - `snapshotPath` is no longer part of the query front door or normal CLI output
  - `--knowledge-file` is no longer accepted on the daemon-backed path
  - use it when you need to inspect the current page more precisely before the next action
- `read-knowledge.js`
  - daemon path: use `--tab-ref`, `--snapshot-ref`, `--knowledge-ref`, or `--origin` + `--normalized-path`
  - standalone compatibility path: `--knowledge-file` only when you are intentionally bypassing runtime state
  - use it when the task may benefit from previously recorded page-specific guidance
- `record-knowledge.js`
  - required: `--guide`, `--keywords`, plus either `--tab-ref`, `--snapshot-ref`, or `--origin` + `--normalized-path`
  - optional runtime hints: `--tab-ref`, `--snapshot-ref`, `--knowledge-ref`, `--rationale`
  - standalone compatibility path: `--knowledge-file` only when there is no `tabRef` or `snapshotRef`
  - use it after a run reveals a stable reusable cue such as a hidden control location, a naming quirk, or a reliable workflow hint

For snapshot retrieval, treat `query-snapshot.js` as the single local front door and prefer `--uid` selectors from the latest snapshot. `click.js`, `type.js`, and `query-snapshot.js` still accept legacy `--ref` during migration, and `select-tab.js` still accepts legacy `--index`, but the canonical names are `--uid` and `--page-id`.

## Practical Rules

Keep the browser work inside one coherent task context at a time. Re-establish context when ownership becomes uncertain. Ask the skill for fresh retrieval instead of trusting stale browser state from earlier in the conversation. Save knowledge only when it is likely to improve a future run on the same page identity.

Treat `tabRef` and `snapshotRef` as the agent-facing runtime contract. Normal CLI results intentionally omit runtime file paths so agents do not route around the daemon. Do not design new flows around direct runtime-file reads unless you are explicitly debugging the daemon or inspecting compatibility behavior.
