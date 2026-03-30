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
- Playwright MCP available through `npx @playwright/mcp@latest`, or equivalent custom command via:
  - `SASIKI_BROWSER_MCP_COMMAND`
  - `SASIKI_BROWSER_MCP_ARGS`
- a browser session that Playwright MCP can attach to

There is not yet a dedicated `help` command in the package. For now, this README is the install document and the concise command reference. After `npm install`, call the compiled scripts in `dist/scripts/` rather than the `.ts` source files.

## What Gets Stored

- runtime temp state: `~/.sasiki/browser-skill/tmp/`
- durable page knowledge: `skill/knowledge/page-knowledge.jsonl`

The temp directory is disposable runtime state. The knowledge file is the durable artifact you keep with the skill.

## Quick Start

Start with `capture`. That command establishes the current browser context and gives you the handle that the rest of the browser task depends on.

Typical sequence:

```bash
node dist/scripts/capture.js --tab-ref main
node dist/scripts/query-snapshot.js --tab-ref main --mode auto
node dist/scripts/navigate.js --tab-ref main --url https://example.com
```

Use `query-snapshot.js --mode full` only when you explicitly need the full current snapshot, such as cold start inspection or debugging.

## Command Reference

The main command groups are:

- capture and rebinding
  - `node dist/scripts/capture.js --tab-ref <tabRef>`
  - `node dist/scripts/select-tab.js --tab-ref <tabRef> --index <tab-index>`
- mutation
  - `node dist/scripts/navigate.js --tab-ref <tabRef> --url <absolute-url>`
  - `node dist/scripts/click.js --tab-ref <tabRef> --ref <element-ref>`
  - `node dist/scripts/type.js --tab-ref <tabRef> --ref <element-ref> --text <value>`
  - `node dist/scripts/press.js --tab-ref <tabRef> --key <key-name>`
- retrieval and knowledge
  - `node dist/scripts/query-snapshot.js --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--ref <ref>]`
  - `node dist/scripts/read-knowledge.js --origin <origin> --normalized-path <path>`
  - `node dist/scripts/record-knowledge.js --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]`

- `capture.js`
  - required: `--tab-ref`
  - purpose: establish or refresh the current browser task context
- `navigate.js`
  - required: `--tab-ref`, `--url`
  - purpose: move the bound browser task to a new URL
- `click.js`
  - required: `--tab-ref`, `--ref`
  - purpose: click a known element in the current bound page
- `type.js`
  - required: `--tab-ref`, `--ref`, `--text`
  - purpose: type into a known element in the current bound page
- `press.js`
  - required: `--tab-ref`, `--key`
  - purpose: send a keyboard action in the current bound page
- `select-tab.js`
  - required: `--tab-ref`, `--index`
  - purpose: rebind the task to another browser tab
- `query-snapshot.js`
  - required: `--mode`, plus one snapshot source such as `--tab-ref`
  - in `search` mode, also require at least one selector such as `--query`, `--role`, or `--ref`
  - purpose: retrieve a focused slice of the latest bound snapshot
- `read-knowledge.js`
  - required: either `--id`, or `--origin` plus `--normalized-path`
  - purpose: read durable page knowledge
- `record-knowledge.js`
  - required: `--origin`, `--normalized-path`, `--guide`
  - optional: `--keywords`
  - purpose: save a durable reusable page cue

## Invocation Notes

- Use one `--tab-ref` consistently for one browser task context.
- Capture first if you are unsure what the current browser context is.
- `query-snapshot.js --mode search` should include at least one selector such as `--query`, `--role`, or `--ref`.
- `query-snapshot.js --mode auto` is the normal retrieval path.
- `query-snapshot.js --mode full` is the fallback path when targeted retrieval is not enough.
- `read-knowledge.js` and `record-knowledge.js` work on `origin + normalizedPath`, not on arbitrary files.
- On the first run, `node dist/scripts/capture.js --tab-ref main` is a valid cold-start command.

## Notes For Agents

- Do not guess browser context. If you are unsure, capture first.
- Do not treat this as a knowledge-harvesting skill. Its job is to finish browser work.
- Use `query-snapshot.js` as a local retrieval tool, not as a reason to inline whole snapshots into the chat.
