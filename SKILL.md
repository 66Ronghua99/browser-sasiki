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

Start with `capture.ts`. That establishes a trustworthy browser context for the current task. If you do not already have a valid bound context, capture first and continue from there.

## Work Model

Establish context first. Then keep doing the browser work through this skill instead of mixing in unrelated browser calls. When the built-in guidance is enough, continue. When it is not enough, query the latest snapshot more precisely. If the run exposes something stable and useful for the same page identity, record it. Knowledge is a byproduct of successful browser work, not the main goal.

## Command Surface

At the CLI level, the skill currently exposes these commands:

- `capture.ts --tab-ref <tabRef>`
- `navigate.ts --tab-ref <tabRef> --url <absolute-url>`
- `click.ts --tab-ref <tabRef> --ref <element-ref>`
- `type.ts --tab-ref <tabRef> --ref <element-ref> --text <value>`
- `press.ts --tab-ref <tabRef> --key <key-name>`
- `select-tab.ts --tab-ref <tabRef> --index <tab-index>`
- `query-snapshot.ts --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--ref <ref>]`
- `read-knowledge.ts --origin <origin> --normalized-path <path>`
- `record-knowledge.ts --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]`

Use the README as the denser operator-facing reference for installation and exact command details.

## Practical Rules

Keep the browser work inside one coherent task context at a time. Re-establish context when ownership becomes uncertain. Ask the skill for fresh retrieval instead of trusting stale browser state from earlier in the conversation. Save knowledge only when it is likely to improve a future run on the same page identity.
