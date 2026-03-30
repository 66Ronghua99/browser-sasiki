---
name: browser-skill
description: Use when you need to automate a browser task through a tabRef-based skill surface, especially when you want lower-token snapshot retrieval and reusable page knowledge without pushing full browser snapshots into chat.
---

# Browser Skill

## Overview

You should use this skill when browser automation is the main goal and you want a cleaner control surface than direct raw Playwright tools.

This skill wraps Playwright MCP behind a small set of TypeScript commands. Its core model is:

- browser automation first
- explicit `tabRef` ownership instead of guessing the active tab
- fresh snapshot after every mutation
- local snapshot querying instead of dumping whole snapshots into context
- page knowledge as a reusable byproduct, not the main task

## When To Use

Use this skill when:

- you need to navigate, click, type, press keys, or switch tabs in a real browser
- you want each task flow anchored to a stable `tabRef`
- you want to query only the relevant part of the latest snapshot
- you expect repeated work on the same `origin + normalizedPath` pages and want reusable page knowledge

Do not use this skill as a generic knowledge-writing tool. If there is no browser task to finish, this is probably the wrong skill.

## What To Do First

Begin with `capture.ts`.

- Bind the current browser tab to a `tabRef`, or refresh an existing one.
- Capture a fresh snapshot for that tab.
- Use the returned `tabRef` for every later mutation command.

If you do not have a `tabRef`, do not guess one and do not proceed with mutation scripts.

## Core Work Model

1. `capture.ts` establishes or refreshes the tab binding.
2. Mutation commands use that same `tabRef`.
3. Each mutation auto-captures a fresh snapshot.
4. You inspect `knowledgeHits` first.
5. Only if needed, you call `query-snapshot.ts` to look deeper into the latest bound snapshot.
6. If the page revealed a stable reusable cue, you record it.

## Default Check Path

Check returned `knowledgeHits` first after capture or any mutation.

- Use `query-snapshot.ts` only when those hits are not enough and you still need a fresh `ref` or deeper structural lookup.
- Use `read-knowledge.ts` only when you need durable page knowledge for a known page identity.
- Use `record-knowledge.ts` only when the current task reveals a reusable cue that is worth keeping.

Do not treat knowledge recording as required for task completion. Browser work should keep moving even when no knowledge is worth saving.

## Invocation Shapes

- `capture.ts --tab-ref <existing|new>`
- `navigate.ts --tab-ref <tabRef> --url <absolute-url>`
- `click.ts --tab-ref <tabRef> --ref <element-ref>`
- `type.ts --tab-ref <tabRef> --ref <element-ref> --text <value>`
- `press.ts --tab-ref <tabRef> --key <key-name>`
- `select-tab.ts --tab-ref <tabRef> --index <tab-index>`
- `query-snapshot.ts --tab-ref <tabRef> --mode <search|auto|full> [--query <text|ref|role>]`
- `read-knowledge.ts --origin <origin> --normalized-path <path>`
- `record-knowledge.ts --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]`

## Storage Rules

- Temp runtime state stays outside `skill/`.
- Durable knowledge lives under `skill/knowledge/`.
- Keep the skill bundle portable by avoiding temp files or session state inside `skill/`.

## Practical Rules

- Keep each action anchored to one `tabRef`.
- Rebind with `capture.ts` after switching tabs or when page ownership is uncertain.
- Query the latest snapshot instead of reading snapshot text from memory.
- Save knowledge only when it will help a future run on the same page identity.
