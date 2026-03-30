# Browser Skill

Browser Skill is a browser automation skill for coding agents. The most important thing to understand is that this is not meant to be just a pile of helper scripts. It is meant to be the default way an agent performs browser automation work. The current run should be easier to control, and later runs should gradually become cheaper and faster because useful page-level knowledge can accumulate over time.

In other words, browser automation is the first goal and self-improvement is the second goal. If you keep using the skill the intended way, it should become better at repeated browser work without asking the agent to manually rediscover the same page structure every time.

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
- `skill/README.md`, which acts as the more detailed operator-facing reference
- `skill/scripts/*.ts`, which are the actual commands the agent runs

## Runtime Requirements

- Node `>=20`
- Playwright MCP available through `npx @playwright/mcp@latest`, or equivalent custom command via:
  - `SASIKI_BROWSER_MCP_COMMAND`
  - `SASIKI_BROWSER_MCP_ARGS`
- a browser session that Playwright MCP can attach to

There is not yet a dedicated `help` command in the package. For now, this README should be treated as the detailed command reference. That is intentional: right now the bigger need is a clear operating model and clear installation and usage documentation, not another wrapper command.

## What Gets Stored

- runtime temp state: `~/.sasiki/browser-skill/tmp/`
- durable page knowledge: `skill/knowledge/page-knowledge.jsonl`

The temp directory is disposable runtime state. The knowledge file is the durable artifact you keep with the skill.

## Command Surface

Start with `capture.ts`. That command establishes the current browser context and gives you the handle that the rest of the browser task depends on.

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

In practice, `capture.ts` establishes or refreshes the current bound context, every mutation command refreshes browser state after acting, `query-snapshot.ts` is the detailed retrieval front door when compact guidance is not enough, and the knowledge commands are the durable interface for reusable page-level cues.

## Detailed CLI Notes

`capture.ts` is how you enter the skill. If you are unsure which page state the agent should trust, capture again and keep using the returned bound context.

`navigate.ts`, `click.ts`, `type.ts`, `press.ts`, and `select-tab.ts` are the mutation surface. They all assume that the caller is staying inside one coherent browser task flow rather than firing disconnected browser commands.

`query-snapshot.ts` is the detailed lookup tool. You give it the current browser context, a required mode, and then the selectors you care about. In other words, it is meant to retrieve a specific slice of the latest bound snapshot, not to become another excuse to dump whole page state into chat unless you deliberately use `--mode full`.

`read-knowledge.ts` and `record-knowledge.ts` both work at the level of page identity, which means `origin + normalizedPath`. They are not generic file readers or append-only notes commands; they are the durable interface for reusable page cues.

If you want a more explicit parameter-level reference, use this table:

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

## Recommended Flow

The intended flow is to capture first, keep using the returned bound context for every mutation, and only go deeper into snapshot retrieval when the returned guidance is not enough to continue. The more you treat `query-snapshot.ts` as a precise retrieval tool instead of a generic “show me everything” tool, the more value you get from the skill’s token-efficiency model.

When a page reveals something stable and obviously reusable, record it. When it does not, keep moving. The skill is designed so that browser work can still succeed even if nothing new gets written to durable knowledge.

## Notes For Agents

- Do not guess browser context. If you are unsure, capture first.
- Do not treat this as a knowledge-harvesting skill. Its job is to finish browser work.
- Use `query-snapshot.ts` as a local retrieval tool, not as a reason to inline whole snapshots into the chat.
