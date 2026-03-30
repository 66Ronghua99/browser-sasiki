# Browser Skill

Browser Skill is a browser automation skill for coding agents. Its core job is to give browser work one stable skill surface, while allowing reusable page-level knowledge to accumulate over time. Browser automation comes first. Self-improvement exists to make later browser automation cheaper and faster.

## Install

Treat this directory as if it were an independent GitHub repo and install the whole folder as one skill package.

### Codex

Copy or clone the repo into your Codex skills directory. A common target is:

```bash
mkdir -p "$CODEX_HOME/skills"
git clone <this-repo-url> "$CODEX_HOME/skills/browser-skill"
cd "$CODEX_HOME/skills/browser-skill/skill"
npm install
```

If your Codex setup uses a different skills root, keep the folder name as `browser-skill` and place the repo there.

### Claude Code

Copy or clone the repo into your Claude Code skills directory:

```bash
mkdir -p ~/.claude/skills
git clone <this-repo-url> ~/.claude/skills/browser-skill
cd ~/.claude/skills/browser-skill/skill
npm install
```

After install, the files that matter most are:

- `skill/SKILL.md`, which explains the operating model for the agent
- `skill/README.md`, which acts as the install and operator-facing reference
- `skill/scripts/*.ts`, which are the actual commands the agent runs

## Runtime Requirements

- Node `>=20`
- Playwright MCP available through `npx @playwright/mcp@latest`, or equivalent custom command via:
  - `SASIKI_BROWSER_MCP_COMMAND`
  - `SASIKI_BROWSER_MCP_ARGS`
- a browser session that Playwright MCP can attach to

There is not yet a dedicated `help` command in the package. For now, this README is the install document and the concise command reference.

## What Gets Stored

- runtime temp state: `~/.sasiki/browser-skill/tmp/`
- durable page knowledge: `skill/knowledge/page-knowledge.jsonl`

The temp directory is disposable runtime state. The knowledge file is the durable artifact you keep with the skill.

## Quick Start

Start with `capture.ts`. That command establishes the current browser context and gives you the handle that the rest of the browser task depends on.

Typical sequence:

```bash
npx tsx skill/scripts/capture.ts --tab-ref main
npx tsx skill/scripts/query-snapshot.ts --tab-ref main --mode auto
npx tsx skill/scripts/navigate.ts --tab-ref main --url https://example.com
```

Use `query-snapshot.ts --mode full` only when you explicitly need the full current snapshot, such as cold start inspection or debugging.

## Command Reference

The main command groups are:

- capture and rebinding
  - `capture.ts --tab-ref <tabRef>`
  - `select-tab.ts --tab-ref <tabRef> --index <tab-index>`
- mutation
  - `navigate.ts --tab-ref <tabRef> --url <absolute-url>`
  - `click.ts --tab-ref <tabRef> --ref <element-ref>`
  - `type.ts --tab-ref <tabRef> --ref <element-ref> --text <value>`
  - `press.ts --tab-ref <tabRef> --key <key-name>`
- retrieval and knowledge
  - `query-snapshot.ts --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--ref <ref>]`
  - `read-knowledge.ts --origin <origin> --normalized-path <path>`
  - `record-knowledge.ts --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]`

- `capture.ts`
  - required: `--tab-ref`
  - purpose: establish or refresh the current browser task context
- `navigate.ts`
  - required: `--tab-ref`, `--url`
  - purpose: move the bound browser task to a new URL
- `click.ts`
  - required: `--tab-ref`, `--ref`
  - purpose: click a known element in the current bound page
- `type.ts`
  - required: `--tab-ref`, `--ref`, `--text`
  - purpose: type into a known element in the current bound page
- `press.ts`
  - required: `--tab-ref`, `--key`
  - purpose: send a keyboard action in the current bound page
- `select-tab.ts`
  - required: `--tab-ref`, `--index`
  - purpose: rebind the task to another browser tab
- `query-snapshot.ts`
  - required: `--mode`, plus one snapshot source such as `--tab-ref`
  - in `search` mode, also require at least one selector such as `--query`, `--role`, or `--ref`
  - purpose: retrieve a focused slice of the latest bound snapshot
- `read-knowledge.ts`
  - required: either `--id`, or `--origin` plus `--normalized-path`
  - purpose: read durable page knowledge
- `record-knowledge.ts`
  - required: `--origin`, `--normalized-path`, `--guide`
  - optional: `--keywords`
  - purpose: save a durable reusable page cue

## Invocation Notes

- Use one `--tab-ref` consistently for one browser task context.
- Capture first if you are unsure what the current browser context is.
- `query-snapshot.ts --mode search` should include at least one selector such as `--query`, `--role`, or `--ref`.
- `query-snapshot.ts --mode auto` is the normal retrieval path.
- `query-snapshot.ts --mode full` is the fallback path when targeted retrieval is not enough.
- `read-knowledge.ts` and `record-knowledge.ts` work on `origin + normalizedPath`, not on arbitrary files.

## Notes For Agents

- Do not guess browser context. If you are unsure, capture first.
- Do not treat this as a knowledge-harvesting skill. Its job is to finish browser work.
- Use `query-snapshot.ts` as a local retrieval tool, not as a reason to inline whole snapshots into the chat.
