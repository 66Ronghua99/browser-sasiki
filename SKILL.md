---
name: browser-skill
description: Use when you need to automate a browser task through a tabRef-based skill surface, especially when you want lower-token snapshot retrieval and reusable page knowledge without pushing full browser snapshots into chat.
---

# Browser Skill

## Overview

You should use this skill when your real goal is to finish work in a browser, not to inspect browser state for its own sake. The point of this skill is to give you a more stable operating model than raw Playwright calls: every task flow is anchored to an explicit `tabRef`, every mutation produces a fresh snapshot, and snapshots are queried locally instead of being dumped back into chat in full.

The long-term benefit is not just cleaner automation in the current run. If you keep using the skill the intended way, it also accumulates page-level knowledge that can make later runs cheaper and faster. That knowledge is helpful, but it is never the main objective. The main objective is still to complete the browser task correctly.

## When To Use

You should reach for this skill when you need to navigate, click, type, press keys, switch tabs, or inspect a real page, and you want the browser work to stay tied to a stable task context instead of drifting with whichever tab happens to be active. It is especially useful when you expect to revisit the same page identities over time and want reusable page knowledge to reduce token cost on later runs.

You should not use this skill as a generic knowledge-writing tool or a note-taking tool. If there is no concrete browser task to complete, or if durable page knowledge is the only thing you care about, this is probably the wrong skill.

## What To Do First

Start with `capture.ts`. The purpose of capture is to establish the current browser context in a way the rest of the skill can trust. It binds the current page to a `tabRef`, writes a fresh snapshot to runtime temp storage, and gives you a compact result that can be used for every later action.

If you do not have a `tabRef`, do not guess one. Capture first, then keep using that same `tabRef` as the thread that ties the rest of the work together.

## Core Work Model

The intended rhythm is simple. First you capture the current tab. Then you mutate the browser through the action commands while keeping the same `tabRef`. After each mutation, the skill automatically refreshes the snapshot and returns any matching `knowledgeHits`. In many cases that is enough to continue without asking for anything else. Only when the returned hints are not enough should you call `query-snapshot.ts` to inspect the latest bound snapshot more deeply.

If the page reveals a stable, reusable cue that would genuinely help a later run on the same `origin + normalizedPath`, then you can record it. But that happens after or alongside useful browser work, not instead of it.

## Default Check Path

After any capture or mutation, check `knowledgeHits` first. That is the cheapest place to start, because it gives you page-aware guidance without forcing you to inspect the full snapshot. If those hits are not enough, then use `query-snapshot.ts` to retrieve the exact slice of the latest bound snapshot that you still need.

Use `read-knowledge.ts` only when you want the durable page-level record for a known page identity. Use `record-knowledge.ts` only when the current page exposed something stable enough to deserve being saved for future runs. Do not treat knowledge recording as a required checkpoint. Browser work should keep moving even when nothing is worth saving.

## Invocation Shapes

At the CLI level, the commands are:

- `capture.ts --tab-ref <tabRef>`
- `navigate.ts --tab-ref <tabRef> --url <absolute-url>`
- `click.ts --tab-ref <tabRef> --ref <element-ref>`
- `type.ts --tab-ref <tabRef> --ref <element-ref> --text <value>`
- `press.ts --tab-ref <tabRef> --key <key-name>`
- `select-tab.ts --tab-ref <tabRef> --index <tab-index>`
- `query-snapshot.ts --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--ref <ref>]`
- `read-knowledge.ts --origin <origin> --normalized-path <path>`
- `record-knowledge.ts --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]`

If you need more detailed parameter reference, use the repository README as the canonical operator document. `SKILL.md` should teach you the operating model first, and the README should carry the denser command reference.

## Storage Rules

Runtime temp state stays outside `skill/`, because it is disposable execution state rather than part of the portable skill package. Durable knowledge lives under `skill/knowledge/`, because that is the reusable artifact worth carrying forward. Keeping those two layers separate is part of what makes this skill portable.

## Practical Rules

Keep each action anchored to one `tabRef`. Rebind with `capture.ts` whenever page ownership becomes uncertain. Query the latest snapshot instead of relying on old snapshot text you saw earlier in the conversation. Save knowledge only when it is likely to help a future run on the same page identity.
