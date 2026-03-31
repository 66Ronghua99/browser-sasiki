---
name: browser-skill
description: Use when you want to complete browser automation work through a self-evolving skill that gets cheaper and faster over time by reusing page knowledge gathered during execution.
---

# Browser Skill

## Overview

Use this skill for browser automation tasks. Finish the browser task first, and leave one durable page cue behind when the run uncovers something that should make later runs faster.

## Start

Make sure the target Chrome session is already running with remote debugging enabled and Chrome DevTools MCP can attach. Then start with:

`node dist/scripts/capture.js --tab-ref <tabRef>`

That establishes or refreshes the workspace tab for this task.

## Normal Flow

1. Run `capture.js` to establish the browser workspace.
2. Use `navigate.js`, `click.js`, `type.js`, `press.js`, and `select-tab.js` to do the browser work.
3. Use `query-snapshot.js` only when you need more page inspection before the next action.
4. Before the final answer, write one `record-knowledge.js` entry when the trigger rule below fires.

## Knowledge Model

- knowledgeHits auto-load on page match during `capture.js`, browser actions, and daemon-backed `query-snapshot.js`.
- Consume those returned `knowledgeHits` directly as the reusable page guidance for the current run.
- `query-snapshot.js` is for the current page state, not durable knowledge.
- Do not call `read-knowledge.js` in the normal browser-task flow.

## Record Rule

You must successfully call `record-knowledge.js` before the final answer when either of these is true:

- you used `query-snapshot.js --mode full` to locate the right element or recover context
- a query result or successful action revealed a stable reusable cue for the same page or page family

If one of those triggers happened and no knowledge was recorded, the task is not complete.

## Commands

- `node dist/scripts/capture.js --tab-ref <tabRef>`
- `node dist/scripts/navigate.js --tab-ref <tabRef> --url <absolute-url>`
- `node dist/scripts/click.js --tab-ref <tabRef> --uid <element-uid>`
- `node dist/scripts/type.js --tab-ref <tabRef> --uid <element-uid> --text <value>`
- `node dist/scripts/press.js --tab-ref <tabRef> --key <key-name>`
- `node dist/scripts/select-tab.js --tab-ref <tabRef> --page-id <page-id>`
- `node dist/scripts/query-snapshot.js --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--uid <uid>]`
- `node dist/scripts/record-knowledge.js --tab-ref <tabRef> --guide <text> --keywords <comma-separated>`

## Command Details

- `capture.js`
  - purpose: establish or refresh the workspace tab for this task
  - normal use: `--tab-ref <tabRef>`
  - explicit rebinding: `--page-id <page-id>` when you intentionally want to bind an already open tab
- `navigate.js`
  - required: `--tab-ref`, `--url`
  - purpose: move the bound workspace tab to a new absolute URL
- `click.js`
  - required: `--tab-ref`, `--uid`
  - purpose: click a known element from the latest snapshot
- `type.js`
  - required: `--tab-ref`, `--uid`, `--text`
  - purpose: type into a known element from the latest snapshot
  - note: use `press.js` afterward when you need Enter or another key action
- `press.js`
  - required: `--tab-ref`, `--key`
  - purpose: send a keyboard action to the bound tab
- `select-tab.js`
  - required: `--tab-ref`, `--page-id`
  - purpose: rebind the workspace to another already open Chrome tab
- `query-snapshot.js`
  - required: `--mode` plus one snapshot source such as `--tab-ref` or `--snapshot-ref`
  - `search` mode also needs a selector such as `--query`, `--role`, or `--uid`
  - purpose: inspect the current page when you need more context before the next action
  - normal path: prefer `--mode auto`
  - escalated path: use `--mode full` only when targeted retrieval is not enough
- `record-knowledge.js`
  - required: `--guide`, `--keywords`, plus either `--tab-ref`, `--snapshot-ref`, or explicit page identity
  - purpose: save one durable reusable cue for the same page or page family
  - normal path: prefer `--tab-ref` or `--snapshot-ref` and let the daemon infer page identity

## Manual Inspection

- `read-knowledge.js` is available for explicit inspection or debugging, not for the normal browser-task loop.
- Use it only when you intentionally want to inspect durable page knowledge outside the normal `knowledgeHits` flow.

## Practical Rules

- Keep one stable `tabRef` for one browser task context.
- Prefer `query-snapshot.js --mode auto` for normal retrieval and use `--mode full` only when you need the whole page snapshot.
- Prefer `uid` values from the latest snapshot when clicking or typing.
- Record only stable cues that should help a later run on the same page or page family.
- Treat `tabRef` and `snapshotRef` as the runtime contract. Do not route around the daemon by reading temp files directly during normal execution.
