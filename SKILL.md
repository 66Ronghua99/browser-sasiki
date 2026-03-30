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

Start with `node dist/scripts/capture.js --tab-ref <tabRef>`. That establishes a trustworthy browser context for the current task. If you do not already have a valid bound context, capture first and continue from there.

## Work Model

Establish context first. Then keep doing the browser work through this skill instead of mixing in unrelated browser calls. When the built-in guidance is enough, continue. When it is not enough, query the latest snapshot more precisely. If the run exposes something stable and useful for the same page identity, record it. Knowledge is a byproduct of successful browser work, not the main goal.

## Command Surface

At the CLI level, the skill currently exposes these commands:

- `node dist/scripts/capture.js --tab-ref <tabRef>`
- `node dist/scripts/navigate.js --tab-ref <tabRef> --url <absolute-url>`
- `node dist/scripts/click.js --tab-ref <tabRef> --ref <element-ref>`
- `node dist/scripts/type.js --tab-ref <tabRef> --ref <element-ref> --text <value>`
- `node dist/scripts/press.js --tab-ref <tabRef> --key <key-name>`
- `node dist/scripts/select-tab.js --tab-ref <tabRef> --index <tab-index>`
- `node dist/scripts/query-snapshot.js --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--ref <ref>]`
- `node dist/scripts/read-knowledge.js --origin <origin> --normalized-path <path>`
- `node dist/scripts/record-knowledge.js --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]`

Use the README as the denser operator-facing reference for installation and exact command details. After installation, call the compiled `dist/scripts/*.js` entrypoints rather than the `.ts` source files.

## Practical Rules

Keep the browser work inside one coherent task context at a time. Re-establish context when ownership becomes uncertain. Ask the skill for fresh retrieval instead of trusting stale browser state from earlier in the conversation. Save knowledge only when it is likely to improve a future run on the same page identity.
