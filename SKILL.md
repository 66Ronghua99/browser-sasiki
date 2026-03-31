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
- binding an already open tab requires explicit intent through `--tab-index` on `capture` or `select-tab` later

If capture fails because Chrome is not attachable, open `chrome://inspect/#remote-debugging` in Chrome, turn remote debugging on, allow the MCP connection if prompted, and then retry capture.

## Work Model

Establish context first. Then keep doing the browser work through this skill instead of mixing in unrelated browser calls. In this phase the skill attaches to an already running Chrome session through Chrome DevTools MCP auto-connect, and the first command starts `browser-sessiond` as the single runtime owner for MCP attach, snapshot capture, snapshot querying, and knowledge IO. The CLI scripts are thin RPC entrypoints into that daemon; they do not each own their own browser session. Chrome DevTools MCP snapshots are accessibility-tree text headed by `## Latest page snapshot`, and element handles in that snapshot are `uid` values. When the built-in guidance is enough, continue. When it is not enough, query the latest snapshot more precisely. If the run exposes something stable and useful for the same page identity, record it. Knowledge is a byproduct of successful browser work, not the main goal.

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
- `node dist/scripts/record-knowledge.js --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]`

Use the README as the denser operator-facing reference for installation and exact command details. After installation, call the compiled `dist/scripts/*.js` entrypoints rather than the `.ts` source files.

### Argument Meanings

- `tabRef`: the agent-facing logical workspace handle. It points to one bound Chrome tab and its latest snapshot.
- `snapshotRef`: the daemon-generated handle for a stored snapshot. Prefer this over `snapshotPath` in new flows.
- `uid`: the Chrome DevTools accessibility-tree element handle from the latest snapshot. This is the canonical element selector.
- `page-id`: the Chrome DevTools page handle used by `list_pages` / `select_page`.
- `tab-index`: capture-only explicit override for binding an already open tab instead of creating a new workspace tab.

### Command Details

- `capture.js`
  - purpose: create or refresh an agent workspace
  - recommended: `--tab-ref <tabRef>`
  - optional: `--tab-index <page-id>` to bind an already open tab explicitly
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
  - requires one snapshot source: `--tab-ref`, `--snapshot-ref`, `--snapshot-path`, or `--snapshot-text`
  - `search` mode also requires at least one selector: `--query` / `--text`, `--role`, `--uid`, or `--ref`
  - only `full` results, or `auto` when it truly falls back to full, should include `snapshotText`
  - `--knowledge-file` is no longer accepted on the daemon-backed path
- `read-knowledge.js`
  - daemon path: use `--tab-ref`, `--snapshot-ref`, `--knowledge-ref`, or `--origin` + `--normalized-path`
  - standalone compatibility path: `--knowledge-file` only when you are intentionally bypassing runtime state
- `record-knowledge.js`
  - required: `--origin`, `--normalized-path`, `--guide`, `--keywords`
  - optional runtime hints: `--tab-ref`, `--snapshot-ref`, `--knowledge-ref`, `--rationale`
  - standalone compatibility path: `--knowledge-file` only when there is no `tabRef` or `snapshotRef`

For snapshot retrieval, treat `query-snapshot.js` as the single local front door and prefer `--uid` selectors from the latest snapshot. `click.js`, `type.js`, and `query-snapshot.js` still accept legacy `--ref` during migration, and `select-tab.js` still accepts legacy `--index`, but the canonical names are `--uid` and `--page-id`.

## Practical Rules

Keep the browser work inside one coherent task context at a time. Re-establish context when ownership becomes uncertain. Ask the skill for fresh retrieval instead of trusting stale browser state from earlier in the conversation. Save knowledge only when it is likely to improve a future run on the same page identity.

Treat `tabRef` and `snapshotRef` as the agent-facing runtime contract. Normal CLI results intentionally omit runtime file paths so agents do not route around the daemon. Do not design new flows around direct runtime-file reads unless you are explicitly debugging the daemon or inspecting compatibility behavior.
