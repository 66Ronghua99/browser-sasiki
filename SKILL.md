---
name: browser-skill
description: Use when you want to complete browser automation work through a self-evolving skill that gets cheaper and faster over time by reusing page knowledge gathered during execution.
---

# Browser Skill

## Overview

This is a browser automation skill. That is the main thing you should understand before anything else. If the job is to get something done in a browser, this skill is supposed to be the default path. It is not mainly about exposing a few helper commands. It is about giving you one stable way to do browser automation so that the current run is easier to control and later runs can gradually become more efficient.

This skill is also self-evolving. While you are doing real browser work, it can accumulate reusable page-level knowledge. That means the next time you face the same page identity, you do not have to rediscover everything from scratch. Over time, that should help both token efficiency and execution efficiency. But that self-improvement is always secondary. The first priority is still to finish the browser task.

## When To Use

You should use this skill whenever the underlying task is browser automation: moving through a site, clicking through flows, typing into forms, switching tabs, checking the current state of a page, or completing a browser workflow from start to finish. It is especially useful when the same sites and page identities show up repeatedly, because that is where the self-evolving part starts paying off.

You should not use this skill as a generic note-taking tool or as a pure knowledge-writing tool. If there is no actual browser task to complete, this is probably not the right skill.

## What You Get

When you use this skill the intended way, you get a few practical benefits. Your browser work stays inside one coherent control surface instead of drifting across unrelated browser calls. The skill can keep a stable sense of context while you work. It can retrieve only the slice of browser state you actually need instead of forcing the whole snapshot into the conversation. And if the run reveals something stable and reusable, that knowledge can be carried into later runs.

That is why this should be treated as a browser automation skill first and a knowledge skill second. The knowledge matters because it improves future browser automation, not because collecting knowledge is the task.

## How To Start

Start with `capture.ts`. The reason is simple: browser automation only works well when the skill has a trustworthy baseline for the current browser context. Capture establishes that baseline and gives the rest of the skill something stable to build on.

If you do not already have a valid bound context for the current browser task, capture first and continue from there. Do not guess.

## Work Model

The intended rhythm is straightforward. First establish context. Then keep doing the browser work through this skill instead of mixing in ad hoc browser calls. After each meaningful step, the skill refreshes what it knows and gives you compact guidance about what matters next. In many cases that is already enough to continue. When it is not enough, ask for deeper retrieval against the latest browser state.

If the run exposes something stable and reusable, save it. That is how the skill becomes self-evolving. But saving knowledge is never the main storyline of the run. It is something that happens during useful browser work, not instead of useful browser work.

## Default Decision Path

After any capture or mutation, start from the compact guidance the skill already gives you. That is usually the cheapest and most efficient path. If that is not enough, then ask for deeper retrieval. If durable knowledge is relevant, read it. If the current run discovered something clearly worth keeping, record it. But keep the main momentum on finishing the browser task.

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

The important thing is not the syntax by itself. The important thing is that the whole browser workflow is supposed to stay inside this skill. The more detailed parameter reference belongs in the README, which should be treated as the denser operator-facing document.

## Storage Model

Runtime temp state stays outside `skill/`, because it is disposable execution state rather than part of the portable skill package. Durable knowledge lives under `skill/knowledge/`, because that is the reusable artifact worth carrying forward. Keeping those layers separate is part of what makes the skill portable and keeps day-to-day execution noise out of the skill bundle itself.

## Practical Rules

Keep the browser work inside one coherent task context at a time. Re-establish context whenever ownership becomes uncertain. Ask the skill for fresh retrieval instead of trusting stale browser state from earlier in the conversation. Save knowledge only when it is likely to improve a future run on the same page identity.
