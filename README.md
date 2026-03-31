# Browser Skill

Browser Skill is a workspace-first browser automation skill for coding agents. Its front door is HTTP-only: one long-lived daemon owns the attached Chrome session, and agents interact with it through direct DevTools-backed JSON endpoints instead of per-command CLI wrappers.

## Runtime Requirements

- Node `>=20`
- Google Chrome already running in the session you want to automate
- remote debugging enabled for that running Chrome session
- approval for Chrome to allow the daemon to attach if the browser prompts for confirmation

## Quick Start

Start the daemon:

```bash
node skill/scripts/browser-sessiond.mjs
```

Check health:

```bash
curl -s http://127.0.0.1:3456/health
```

Open a workspace:

```bash
curl -s -X POST http://127.0.0.1:3456/workspaces
```

List the tabs for that workspace:

```bash
curl -s "http://127.0.0.1:3456/tabs?workspaceRef=workspace_demo"
```

Select a tab:

```bash
curl -s -X POST "http://127.0.0.1:3456/select-tab?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_demo"
```

Inspect the current page:

```bash
curl -s -X POST "http://127.0.0.1:3456/query?workspaceRef=workspace_demo" \
  -d '{"mode":"search","query":"Search"}'
```

Inspect the full current page snapshot:

```bash
curl -s -X POST "http://127.0.0.1:3456/query?workspaceRef=workspace_demo" \
  -d '{"mode":"full"}'
```

Navigate:

```bash
curl -s -X POST "http://127.0.0.1:3456/navigate?workspaceRef=workspace_demo" \
  -d '{"url":"https://example.com"}'
```

## Active Endpoints

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

## Request Fields

- `workspaceRef`: logical workspace name
- `workspaceTabRef`: opaque tab handle inside a workspace
- `url`: absolute navigation target for `/navigate`
- `uid`: element handle from the latest snapshot
- `text`: text content for `/type`
- `key`: keyboard key for `/press`
- `mode`: required for `/query`; use `search` or `full`
- `query`, `role`, `uid`: search selectors for `/query`
- `guide`, `keywords`, `rationale`: durable knowledge fields for `/record-knowledge`

## `query` Usage

- `workspaceRef` means live workspace access.
- `workspaceTabRef` means an explicit tab inside the workspace.
- Use exactly one workspace scope at a time.
- Use `mode: "search"` when you want compact `matches`.
- Use `mode: "full"` when you want the entire `snapshotText`.
- With `mode: "search"`, send at least one of `query`, `role`, or `uid`.
- With `mode: "full"`, do not send selector fields.

## Runtime Truth

- `browser-sessiond` is the single owner of Chrome attachment, workspace state, snapshots, and knowledge hits.
- `knowledgeHits` are the normal reusable-knowledge surface during a task.
- `record-knowledge` is the only explicit durable write path.
- Normal responses expose workspace identity and page identity, not local snapshot paths.
- `uid` is the only public element handle for browser actions and `/query`.

## Stored Data

- runtime temp state: `~/.sasiki/browser-skill/tmp/`
- durable page knowledge: `skill/knowledge/page-knowledge.jsonl`

## Verification

Current migration-period checks:

```bash
npm --prefix skill test
```
