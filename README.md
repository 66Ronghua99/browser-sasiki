# Browser Skill

Browser Skill is a browser automation skill for coding agents. Its core job is to help you finish browser tasks through a stable CLI surface instead of dumping full Playwright snapshots into the model context on every turn.

This skill is browser automation first, knowledge second:

- every action is bound to an explicit `tabRef`
- every mutation auto-captures a fresh snapshot after the action
- snapshots live in temp files instead of being inlined into the conversation
- page knowledge is a reusable byproduct that helps later runs spend fewer tokens

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

## Runtime Requirements

- Node `>=20`
- Playwright MCP available through `npx @playwright/mcp@latest`, or equivalent custom command via:
  - `SASIKI_BROWSER_MCP_COMMAND`
  - `SASIKI_BROWSER_MCP_ARGS`
- a browser session that Playwright MCP can attach to

## What Gets Stored

- runtime temp state: `~/.sasiki/browser-skill/tmp/`
- durable page knowledge: `skill/knowledge/page-knowledge.jsonl`

The temp directory is disposable runtime state. The knowledge file is the durable artifact you keep with the skill.

## Command Surface

Start with `capture.ts` to establish or refresh a `tabRef`.

- `capture.ts --tab-ref <tabRef>`  
  Bind or refresh a `tabRef`, capture a fresh snapshot, and load matching page knowledge.
- `navigate.ts --tab-ref <tabRef> --url <absolute-url>`  
  Navigate that bound tab and auto-capture the refreshed snapshot.
- `click.ts --tab-ref <tabRef> --ref <element-ref>`  
  Click a target element and auto-capture the refreshed snapshot.
- `type.ts --tab-ref <tabRef> --ref <element-ref> --text <value>`  
  Type into an element and auto-capture the refreshed snapshot.
- `press.ts --tab-ref <tabRef> --key <key-name>`  
  Send a key press and auto-capture the refreshed snapshot.
- `select-tab.ts --tab-ref <tabRef> --index <tab-index>`  
  Rebind that logical task context to another browser tab and auto-capture the refreshed snapshot.
- `query-snapshot.ts --tab-ref <tabRef> --mode <search|auto|full> [--query <text>] [--role <role>] [--ref <ref>]`  
  Query the latest snapshot currently bound to that `tabRef`.
- `read-knowledge.ts --origin <origin> --normalized-path <path>`  
  Read durable page knowledge for a specific page identity.
- `record-knowledge.ts --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]`  
  Append or update durable page knowledge for a reusable page cue.

## Recommended Flow

1. Run `capture.ts` first.
2. Keep using the returned `tabRef` for every mutation.
3. After each action, check `knowledgeHits` before asking for deeper snapshot lookup.
4. Use `query-snapshot.ts` only when you still need a fresh `ref` or a narrower page slice.
5. Use `record-knowledge.ts` only when the page cue is stable enough to help a future run.

## Notes For Agents

- Do not guess tab ownership. If you do not have a `tabRef`, capture first.
- Do not treat this as a knowledge-harvesting skill. Its job is to finish browser work.
- Use `query-snapshot.ts` as a local retrieval tool, not as a reason to inline whole snapshots into the chat.
