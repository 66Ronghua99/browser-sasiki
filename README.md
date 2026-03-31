# Browser Skill

Browser Skill is a browser automation skill for coding agents. Its core job is to give browser work one stable skill surface, while allowing reusable page-level knowledge to accumulate over time. Browser automation comes first. Self-improvement exists to make later browser automation cheaper and faster.

## Install

Install this folder itself as the skill package. After copying it into your skills directory, run `npm install` in the package root. That install step also builds the compiled `dist/` entrypoints that agents should call.

### Codex

Copy or clone the repo into your Codex skills directory. A common target is:

```bash
mkdir -p "$CODEX_HOME/skills"
git clone <this-repo-url> "$CODEX_HOME/skills/browser-skill"
cd "$CODEX_HOME/skills/browser-skill"
npm install
```

If your Codex setup uses a different skills root, keep the folder name as `browser-skill` and place the repo there.

### Claude Code

Copy or clone the repo into your Claude Code skills directory:

```bash
mkdir -p ~/.claude/skills
git clone <this-repo-url> ~/.claude/skills/browser-skill
cd ~/.claude/skills/browser-skill
npm install
```

After install, the files that matter most are:

- `SKILL.md`, which explains the operating model for the agent
- `README.md`, which acts as the install and operator-facing reference
- `dist/scripts/*.js`, which are the compiled commands the agent should run

## Runtime Requirements

- Node `>=20`
- Google Chrome already running in the session you want to automate
- remote debugging enabled for that running Chrome session
- Chrome DevTools MCP available through `npx chrome-devtools-mcp@latest --autoConnect`, or equivalent custom command via:
  - `SASIKI_BROWSER_MCP_COMMAND`
  - `SASIKI_BROWSER_MCP_ARGS`
- approval for Chrome DevTools MCP to attach when Chrome prompts for confirmation

There is not yet a dedicated `help` command in the package. For now, this README is the install document and the concise command reference. After `npm install`, call the compiled scripts in `dist/scripts/` rather than the `.ts` source files.

The runtime model in this phase is attach-first and daemon-backed: the first command starts `browser-sessiond`, and that daemon becomes the single owner of Chrome DevTools MCP attachment, snapshot capture, snapshot querying, and knowledge read/write. The CLI scripts are thin RPC entrypoints into that daemon. The skill does not launch its own Playwright-managed browser, create a fresh profile, or import cookies on your behalf.

## If Chrome Does Not Attach

If a command fails because the skill cannot attach to Chrome, start with Chrome itself rather than the skill:

1. Open the Google Chrome window you want to automate.
2. Open `chrome://inspect/#remote-debugging` in that same Chrome session.
3. Turn on remote debugging there.
4. If Chrome prompts you to allow Chrome DevTools MCP to connect, click Allow.
5. Re-run `node dist/scripts/capture.js --tab-ref main`.

The compiled scripts now surface this guidance automatically when Chrome DevTools MCP reports that Chrome is not attachable.

## What Gets Stored

- runtime temp state: `~/.sasiki/browser-skill/tmp/`
  - session metadata and daemon socket
  - tab bindings and cached snapshots
- durable page knowledge: `skill/knowledge/page-knowledge.jsonl`

The temp directory is disposable runtime state. The knowledge file is the durable artifact you keep with the skill.

## Quick Start

Start Chrome yourself first, make sure remote debugging is enabled for that session, and allow Chrome DevTools MCP to attach if Chrome asks. Then start with `capture`. That command starts the daemon if needed, establishes the current browser context, and gives you the handle that the rest of the browser task depends on. Later commands should reuse the same daemon-backed runtime instead of reconnecting from scratch.

The default workspace behavior is now:

- first `capture --tab-ref <tabRef>` creates a new workspace tab for that agent context
- later `capture --tab-ref <same-tabRef>` refreshes the already bound workspace tab
- binding an existing tab is explicit through `--page-id` on `capture` or `select-tab` afterward

Typical sequence:

```bash
node dist/scripts/capture.js --tab-ref main
node dist/scripts/query-snapshot.js --tab-ref main --mode auto
node dist/scripts/navigate.js --tab-ref main --url https://example.com
```

`knowledgeHits` are the normal reusable-knowledge surface. They auto-load from page identity during `capture`, mutation actions, and daemon-backed `query-snapshot`, so ordinary agent runs should consume those returned hits directly instead of calling a separate read step.

Use `query-snapshot.js --mode full` only when you explicitly need the full current snapshot, such as cold start inspection or debugging.

Before you give the final answer for a browser task, record one durable cue when either of these happened during execution:

- you needed full-snapshot exploration to find the correct element or recover context
- `query-snapshot` or a successful action exposed a stable reusable cue that should help a later run

For that write path, prefer `record-knowledge.js --tab-ref <tabRef> --guide ... --keywords ...` or the same pattern with `--snapshot-ref`; the daemon can now infer `origin`, `normalizedPath`, and `title` from the current runtime context.

Chrome DevTools MCP snapshots now come back as accessibility-tree text headed by `## Latest page snapshot`. Element handles in that snapshot are `uid=...`, and `query-snapshot.js` is the single front door for reading or narrowing that snapshot locally.

## Command Reference

The main command groups are:

- capture and rebinding
  - `node dist/scripts/capture.js --tab-ref <tabRef>`
  - `node dist/scripts/select-tab.js --tab-ref <tabRef> --page-id <page-id>`
- mutation
  - `node dist/scripts/navigate.js --tab-ref <tabRef> --url <absolute-url>`
  - `node dist/scripts/click.js --tab-ref <tabRef> --uid <element-uid>`
  - `node dist/scripts/type.js --tab-ref <tabRef> --uid <element-uid> --text <value>`
  - `node dist/scripts/press.js --tab-ref <tabRef> --key <key-name>`
- retrieval and durable write
  - `node dist/scripts/query-snapshot.js --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--uid <uid>]`
  - `node dist/scripts/record-knowledge.js --tab-ref <tabRef> --guide <text> --keywords <comma-separated>`

`read-knowledge.js` remains available only for manual inspection or debugging. It is not part of the normal agent workflow because page-matched reusable guidance should already arrive in `knowledgeHits`.

## Argument Glossary

- `tabRef`
  - agent-facing logical workspace name
  - points to one bound Chrome tab plus its latest snapshot
  - examples: `main`, `checkout_worker`, `support_inbox`
- `snapshotRef`
  - daemon-generated handle for a stored snapshot
  - use this when another command should consume a specific captured state without relying on `tabRef`
- `uid`
  - element handle from the Chrome DevTools accessibility snapshot
  - use this for `click` and `type`
- `page-id`
  - Chrome DevTools page handle from `list_pages`
  - use this with `select-tab` and as the canonical explicit override for `capture`
- `tab-index`
  - legacy alias for `capture --page-id`
  - keep it only for migration compatibility

- `capture.js`
  - purpose: create or refresh a browser workspace
  - optional but recommended: `--tab-ref <tabRef>`
  - optional: `--page-id <page-id>`
  - alias: `--tab-index`
  - behavior:
    - with a new `--tab-ref`, opens a new workspace tab by default
    - with an existing `--tab-ref`, refreshes that binding
    - with `--page-id`, binds the specified already open tab instead of creating a new one
  - example:

```bash
node dist/scripts/capture.js --tab-ref main
node dist/scripts/capture.js --tab-ref support --page-id 3
```

- `navigate.js`
  - required: `--tab-ref`, `--url`
  - purpose: move the bound browser task to a new URL
  - example:

```bash
node dist/scripts/navigate.js --tab-ref main --url https://example.com/dashboard
```

- `click.js`
  - required: `--tab-ref`, `--uid`
  - alias: `--ref`
  - purpose: click a known element in the current bound page
  - example:

```bash
node dist/scripts/click.js --tab-ref main --uid 7_14
```

- `type.js`
  - required: `--tab-ref`, `--uid`, `--text`
  - alias: `--ref`
  - purpose: type into a known element in the current bound page
  - note: `submit` is still not part of the daemon-backed success path; press Enter explicitly with `press.js`
  - example:

```bash
node dist/scripts/type.js --tab-ref main --uid 7_18 --text "hello"
node dist/scripts/press.js --tab-ref main --key Enter
```

- `press.js`
  - required: `--tab-ref`, `--key`
  - purpose: send a keyboard action in the current bound page
- `select-tab.js`
  - required: `--tab-ref`, `--page-id`
  - aliases: `--index`, `--tab-index`
  - purpose: rebind the task to another browser tab
  - example:

```bash
node dist/scripts/select-tab.js --tab-ref main --page-id 4
```

- `query-snapshot.js`
  - required: `--mode`, plus one snapshot source such as `--tab-ref`
  - accepted snapshot sources:
    - `--tab-ref`
    - `--snapshot-ref`
    - `--snapshot-text` for local standalone querying
  - in `search` mode, also require at least one selector such as `--query` / `--text`, `--role`, `--uid`, or `--ref`
  - purpose: retrieve a focused slice of the latest bound snapshot
  - note: normal query results intentionally omit runtime file paths; `snapshotPath` is no longer an accepted query argument
  - examples:

```bash
node dist/scripts/query-snapshot.js --tab-ref main --mode auto
node dist/scripts/query-snapshot.js --tab-ref main --mode search --query "Buy now"
node dist/scripts/query-snapshot.js --tab-ref main --mode search --role button
node dist/scripts/query-snapshot.js --snapshot-ref snapshot_demo --mode full
```

- `record-knowledge.js`
  - required: `--guide`, `--keywords`, plus either `--tab-ref`, `--snapshot-ref`, or `--origin` + `--normalized-path`
  - optional: `--tab-ref`, `--snapshot-ref`, `--knowledge-ref`, `--rationale`
  - standalone compatibility: `--knowledge-file` only when there is no runtime hint
  - purpose: save a durable reusable page cue
  - example:

```bash
node dist/scripts/record-knowledge.js \
  --tab-ref main \
  --guide "The promo code field is below the order summary." \
  --keywords "checkout,promo,summary"
```

## Manual Knowledge Inspection

`read-knowledge.js` is for explicit manual inspection or debugging, not for the normal browser-task loop.

- daemon path: `--knowledge-ref`, `--tab-ref`, `--snapshot-ref`, or `--origin` plus `--normalized-path`
- standalone compatibility: `--knowledge-file` only when you intentionally want to inspect a file without runtime state

Example:

```bash
node dist/scripts/read-knowledge.js --tab-ref main
node dist/scripts/read-knowledge.js --origin https://example.com --normalized-path /checkout
```

## Invocation Notes

- Use one `--tab-ref` consistently for one browser task context.
- Capture first if you are unsure what the current browser context is.
- First capture now creates a new workspace tab by default, so it should not hijack the user's current active tab unless you explicitly pass `--page-id`.
- Normal CLI calls reuse one healthy `browser-sessiond`, and the next request should automatically replace an older daemon when the installed runtime changes.
- `tabRef` bindings are durable workspace pointers, not magic live handles. If the bound Chrome tab is manually closed, re-run `capture` or `select-tab` to rebind that workspace.
- `knowledgeHits` are the normal reusable-knowledge input for a run; do not add a separate `read-knowledge` step unless you are explicitly inspecting or debugging.
- If `query-snapshot --mode full` was needed, or a query/action exposed a stable reusable cue, the run should end with a successful `record-knowledge` write before the final answer.
- Treat returned `tabRef` and `snapshotRef` as the main runtime contract. Normal agent flows should not depend on runtime file paths.
- Normal CLI command output intentionally omits runtime file paths. Even if you know the temp files exist, use `tabRef` / `snapshotRef` and the CLI front door instead of directly reading runtime files during normal agent execution.
- `query-snapshot.js --mode search` should include at least one selector such as `--query`, `--role`, or `--uid`.
- `query-snapshot.js --mode auto` is the normal retrieval path.
- `query-snapshot.js --mode full` is the fallback path when targeted retrieval is not enough.
- `query-snapshot.js` only returns full `snapshotText` for `full` results, or when `auto` legitimately falls back to a full snapshot. `search` results should stay compact.
- `query-snapshot.js` reads Chrome DevTools MCP accessibility snapshots. The canonical element handle is `uid`, and legacy `--ref` still works as a compatibility alias during migration.
- `query-snapshot.js` no longer accepts `--knowledge-file`; runtime-owned knowledge hits come from the daemon-backed page identity, not a caller-supplied file path.
- `click.js` and `type.js` also accept legacy `--ref` as a compatibility alias, but `--uid` is the canonical handle name you should prefer.
- `select-tab.js` accepts legacy `--index` and `--tab-index` aliases, but `--page-id` is the canonical argument name.
- `read-knowledge.js` and `record-knowledge.js` work on `origin + normalizedPath`, not on arbitrary files.
- On the first run, `node dist/scripts/capture.js --tab-ref main` is a valid cold-start command.

## Notes For Agents

- Do not guess browser context. If you are unsure, capture first.
- Do not treat this as a knowledge-harvesting skill. Its job is to finish browser work.
- But once a full-snapshot recovery or a high-signal query uncovered a stable reusable cue, record that cue once before you finish.
- Use `query-snapshot.js` as a local retrieval tool, not as a reason to inline whole snapshots into the chat.
- Do not bypass the daemon by reading runtime temp files directly unless you are explicitly debugging. Query and knowledge commands are meant to go through the same runtime owner as capture and mutation actions.
