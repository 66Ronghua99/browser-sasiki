# Browser Sasiki

Browser Sasiki is a workspace-first browser automation skill for coding agents. Its front door is HTTP-only: one long-lived daemon owns the attached Chrome session, and agents interact with it through direct DevTools-backed JSON endpoints instead of per-command CLI wrappers.

## Runtime Requirements

- Node `>=20`
- Google Chrome already running in the session you want to automate
- remote debugging enabled for that running Chrome session
- approval for Chrome to allow the daemon to attach if the browser prompts for confirmation

## Quick Start

Start or reuse the daemon through the startup helper:

```bash
node skill/scripts/ensure-browser-session.mjs
```

That command prints session metadata. Read `baseUrl` from the JSON output and use it for the remaining HTTP calls. The default is usually `http://127.0.0.1:3456`.

If you need an explicit health read after that:

```bash
curl -s "$BASE_URL/health"
```

Open a workspace:

```bash
curl -s -X POST "$BASE_URL/workspaces" \
  -H 'content-type: application/json' \
  -d '{}'
```

List the tabs for that workspace:

```bash
curl -s "$BASE_URL/tabs?workspaceRef=workspace_demo"
```

Select a tab:

```bash
curl -s -X POST "$BASE_URL/select-tab?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_demo" \
  -H 'content-type: application/json' \
  -d '{}'
```

Inspect the current page:

```bash
curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"mode":"search","query":"Search"}'
```

Inspect the full current page snapshot:

```bash
curl -s -X POST "$BASE_URL/query?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
  -d '{"mode":"full"}'
```

Navigate:

```bash
curl -s -X POST "$BASE_URL/navigate?workspaceRef=workspace_demo" \
  -H 'content-type: application/json' \
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
- Use `mode: "search"` when you want compact `matches`. Search results return concise match objects instead of duplicating the raw snapshot line.
- Use `mode: "full"` when you want the entire `snapshotText`.
- With `mode: "search"`, send at least one of `query`, `role`, or `uid`.
- With `mode: "full"`, do not send selector fields.

## Runtime Truth

- `browser-sessiond` is the single owner of Chrome attachment, workspace state, snapshots, and knowledge hits.
- `ensure-browser-session.mjs` is the startup-only shell front door; it starts or reuses the daemon and prints session metadata.
- HTTP remains the action surface after startup; there is no separate shell RPC layer for `/workspaces`, `/tabs`, `/query`, or mutations.
- `knowledgeHits` are the normal reusable-knowledge surface during a task.
- `record-knowledge` is the only explicit durable write path, and repeated writes for the same page + cue are treated idempotently.
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
