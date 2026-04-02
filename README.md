# Browser Sasiki

Browser Sasiki is a browser automation skill for coding agents. It attaches to an existing Google Chrome session through direct DevTools and exposes a small HTTP API for opening workspaces, inspecting live pages, interacting with elements, and recording reusable page knowledge.

This README is shared by the Sasiki `skill/` directory, which remains the source of truth, and the published mirror repo, so the instructions below are written to work in both places.

For local development from the Sasiki repo, work from `Sasiki/skill`: run `cd skill`, then `npm install`, and `npm test`. Do not keep a second local `browser-sasiki` checkout for development; publish the `skill/` subtree from this repo instead.

## What It Does

- Starts or reuses a local browser daemon.
- Opens logical workspaces and tracks tabs inside each workspace.
- Queries the live page in `search` or `full` mode.
- Performs browser actions such as `navigate`, `click`, `type`, and `press`.
- Records reusable page knowledge and returns `knowledgeHits` during later runs.

## Advantages

- Persistent session: one daemon keeps the Chrome attachment and workspace state alive across multiple actions.
- Workspace-first model: agents can work with tabs and pages without rebuilding context on every command.
- Live page querying: results come from the current page state instead of a stale exported snapshot.
- Stable tab identity: agents target `workspaceTabRef`, while the runtime binds that logical tab to a live Chrome `targetId`.
- Serialized workspace requests: workspace-scoped HTTP requests run one at a time inside the daemon and sync live tab state before and after execution.
- Simple integration: the action surface is plain HTTP plus JSON, so it is easy to call from Codex, Claude Code, or custom tooling.
- Reusable knowledge: stable page cues can be stored once and reused in later tasks.

## Install

### Install into a coding agent

If your agent can install a skill from a GitHub repository, install `browser-sasiki` from:

- repo: `66Ronghua99/browser-sasiki`
- path: `.`

Send this to your coding agent:

```text
Please install the `browser-sasiki` skill from the GitHub repo `66Ronghua99/browser-sasiki` at path `.`, restart your agent if needed, and then use that skill for browser automation tasks.
```

### Manual local install for Codex

```bash
git clone https://github.com/66Ronghua99/browser-sasiki.git ~/codes/browser-sasiki
mkdir -p ~/.codex/skills
rm -rf ~/.codex/skills/browser-sasiki
ln -s ~/codes/browser-sasiki ~/.codex/skills/browser-sasiki
cd ~/codes/browser-sasiki
npm install
```

Restart Codex after installation so the new skill is loaded.


## Usage

### Requirements

- Node `>=20`
- Google Chrome already running
- Chrome remote debugging enabled for that session
- Permission to attach if Chrome shows a confirmation prompt

### Start or reuse the daemon

```bash
node scripts/ensure-browser-session.mjs
```

The command prints JSON session metadata. Read `baseUrl` from the output. The default is usually `http://127.0.0.1:3456`.

For the curl examples below, the explicit `content-type: application/json` header is optional. The daemon parses the JSON body directly, so the minimal examples omit it.

### Open a workspace

```bash
curl -s -X POST "$BASE_URL/workspaces" \
  -d '{}'
```

### List workspace tabs

```bash
curl -s "$BASE_URL/tabs?workspaceRef=workspace_demo"
```

Use the returned `workspaceTabRef` when you need to target or preselect a specific workspace tab via `POST /select-tab` or any workspace-scoped action. The response lists currently open workspace tabs only; closed tabs stay in internal state for reconciliation but are not exposed in public tab inventories.

### Query the current page

Search for a target on the live page:

```bash
curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -d '{"mode":"search","query":"Search"}'
```

`uid` is the only public selector handle for `/query`, `/click`, and `/type`.

In `search` mode, text lookups now prefer the actionable target uid instead of a raw text-only node when the current page exposes a better DOM-backed action target. In `full` mode, snapshot lines can include `interactive=true` for a directly actionable node or `actionableUid=<uid>` when a text node should be routed to an actionable ancestor.

Get the full page snapshot:

```bash
curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -d '{"mode":"full"}'
```

### Act on the page

Navigate:

```bash
curl -s -X POST "$BASE_URL/navigate?workspaceRef=workspace_demo" \
  -d '{"url":"https://example.com"}'
```

Click an element by `uid` from a previous query result:

```bash
curl -s -X POST "$BASE_URL/click?workspaceRef=workspace_demo" \
  -d '{"uid":"uid_demo"}'
```

Type into a specific element by `uid`:

```bash
curl -s -X POST "$BASE_URL/type?workspaceRef=workspace_demo" \
  -d '{"uid":"uid_demo","text":"hello"}'
```

### Available endpoints

- `GET /health`
- `POST /workspaces`
- `GET /tabs`
- `POST /select-tab`
- `POST /navigate`
- `POST /click`
- `POST /type`
- `POST /press`
- `POST /query`
- `POST /record-knowledge`
- `POST /shutdown`

## Local development

If you are contributing from the main Sasiki repo rather than installing the published skill, use:

```bash
cd skill
npm install
npm test
```

Install from the GitHub repository if you want a standalone copy, but do not keep a second local `browser-sasiki` checkout for development.

## License

Released under the [MIT License](LICENSE).
