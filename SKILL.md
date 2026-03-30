---
name: browser-skill
description: Use when an agent needs to automate a browser page with explicit tab ownership, snapshot queries, and optional page knowledge capture.
---

# Browser Skill

## What To Do First

Begin with `capture.ts`.

- Bind the current browser tab to a `tabRef`, or refresh an existing one.
- Capture a fresh snapshot for that tab.
- Use the returned `tabRef` for every later mutation command.

If you do not have a `tabRef`, do not guess one and do not proceed with mutation scripts.

## Default Check Path

Check returned `knowledgeHits` first after capture or any mutation.

- Use `query-snapshot.ts` only when those hits are not enough and you still need a fresh `ref` or deeper structural lookup.
- Use `read-knowledge.ts` only when you need durable page knowledge for a known page identity.
- Use `record-knowledge.ts` only when the current task reveals a reusable cue that is worth keeping.

Do not treat knowledge recording as required for task completion. Browser work should keep moving even when no knowledge is worth saving.

## Command Order

1. `capture.ts` to establish or refresh the tab binding.
2. `navigate.ts`, `click.ts`, `type.ts`, `press.ts`, or `select-tab.ts` to perform the task. These commands auto-capture and refresh the bound snapshot after each action.
3. Inspect `knowledgeHits` first; use `query-snapshot.ts` only if the hits are not enough and you still need a fresh `ref`.
4. `record-knowledge.ts` only if a durable page cue emerged.

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
