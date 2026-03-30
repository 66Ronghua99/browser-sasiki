# Browser Skill

Browser Skill is a browser automation skill for coding agents. Its core job is to help you finish browser tasks through a stable CLI surface instead of dumping full Playwright snapshots into the model context on every turn.

The mental model is straightforward: browser automation comes first, and page knowledge exists to make later automation cheaper and more reliable. Every action is anchored to a `tabRef`, every mutation captures a fresh snapshot, snapshots stay in temp storage instead of being pasted into chat, and durable page knowledge is recorded only when it clearly helps future runs.

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

There is not yet a dedicated `help` command in the package. For now, treat this README as the detailed command reference. That is deliberate: the main thing this skill still needs is a clear operating model and clear install/use documentation, not another layer of wrapper commands.

## What Gets Stored

- runtime temp state: `~/.sasiki/browser-skill/tmp/`
- durable page knowledge: `skill/knowledge/page-knowledge.jsonl`

The temp directory is disposable runtime state. The knowledge file is the durable artifact you keep with the skill.

## Command Surface

Start with `capture.ts`. That command establishes the current browser context and gives you the `tabRef` that the rest of the flow depends on.

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

In practice:

- `capture.ts` binds or refreshes a `tabRef`, captures a fresh snapshot, and loads matching page knowledge
- every mutation command auto-captures after the action and updates the latest snapshot bound to that `tabRef`
- `query-snapshot.ts` is the detailed retrieval front door when `knowledgeHits` are not enough
- `read-knowledge.ts` and `record-knowledge.ts` are for durable page-level knowledge, not for temporary page inspection

## Detailed CLI Notes

`capture.ts` is how you enter the skill. If you are unsure which page state the agent should trust, capture again and keep using the returned `tabRef`.

`navigate.ts`, `click.ts`, `type.ts`, `press.ts`, and `select-tab.ts` are the mutation surface. They all require `--tab-ref`, and they all assume that the caller already knows which task context they are operating in.

`query-snapshot.ts` is the detailed lookup tool. You give it a `--tab-ref`, a required `--mode`, and then one or more selectors such as `--query`, `--role`, or `--ref` when using `search`. In other words, it is meant to retrieve a specific slice of the latest bound snapshot, not to become another excuse to dump whole page state into chat unless you deliberately use `--mode full`.

`read-knowledge.ts` and `record-knowledge.ts` both work at the level of page identity, which means `origin + normalizedPath`. They are not generic file readers or append-only notes commands; they are the durable interface for reusable page cues.

## Recommended Flow

The intended flow is to capture first, keep using the returned `tabRef` for every mutation, and only go deeper into snapshot retrieval when the returned `knowledgeHits` are not enough to continue. The more you treat `query-snapshot.ts` as a precise retrieval tool instead of a generic “show me everything” tool, the more value you get from the skill’s token-efficiency model.

When a page reveals something stable and obviously reusable, record it. When it does not, keep moving. The skill is designed so that browser work can still succeed even if nothing new gets written to durable knowledge.

## Notes For Agents

- Do not guess tab ownership. If you do not have a `tabRef`, capture first.
- Do not treat this as a knowledge-harvesting skill. Its job is to finish browser work.
- Use `query-snapshot.ts` as a local retrieval tool, not as a reason to inline whole snapshots into the chat.
