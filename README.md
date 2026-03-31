# Browser Skill

Browser Skill is a browser automation skill for coding agents. Its front door is HTTP-only: one long-lived daemon owns the browser session, and agents interact with it through `curl`-friendly JSON endpoints instead of per-command CLI wrappers.

## Runtime Requirements

- Node `>=20`
- Google Chrome already running in the session you want to automate
- remote debugging enabled for that running Chrome session
- Chrome DevTools MCP available through `npx chrome-devtools-mcp@latest --autoConnect`, or equivalent custom command via:
  - `SASIKI_BROWSER_MCP_COMMAND`
  - `SASIKI_BROWSER_MCP_ARGS`
- approval for Chrome DevTools MCP to attach when Chrome prompts for confirmation

## Quick Start

Start the daemon:

```bash
node skill/server/browser-sessiond.mjs
```

Check health:

```bash
curl -s http://127.0.0.1:3456/health
```

Create or refresh a workspace tab:

```bash
curl -s -X POST http://127.0.0.1:3456/capture \
  -H 'content-type: application/json' \
  -d '{"tabRef":"main"}'
```

Inspect the current page:

```bash
curl -s -X POST http://127.0.0.1:3456/query-snapshot \
  -H 'content-type: application/json' \
  -d '{"tabRef":"main","mode":"auto"}'
```

Navigate:

```bash
curl -s -X POST http://127.0.0.1:3456/navigate \
  -H 'content-type: application/json' \
  -d '{"tabRef":"main","url":"https://example.com"}'
```

## Active Endpoints

- `GET /health`
- `POST /capture`
- `POST /navigate`
- `POST /click`
- `POST /type`
- `POST /press`
- `POST /select-tab`
- `POST /query-snapshot`
- `POST /record-knowledge`
- `POST /shutdown`

## Request Fields

- `tabRef`: logical workspace tab name
- `snapshotRef`: daemon-generated snapshot handle
- `url`: absolute navigation target for `/navigate`
- `uid`: element handle from the latest snapshot
- `text`: text content for `/type`
- `key`: keyboard key for `/press`
- `pageId`: explicit existing Chrome tab id for `/select-tab`
- `mode`: one of `search`, `auto`, or `full` for `/query-snapshot`
- `query`, `role`: query selectors for `/query-snapshot`
- `guide`, `keywords`, `rationale`: durable knowledge fields for `/record-knowledge`

## Runtime Truth

- `browser-sessiond` is the single owner of Chrome attachment, tab bindings, snapshots, and knowledge hits.
- `knowledgeHits` are the normal reusable-knowledge surface during a task.
- `record-knowledge` is the only explicit durable write path.
- Normal responses expose `snapshotRef`, not `snapshotPath`.
- There is no active `read-knowledge` front door.

## Stored Data

- runtime temp state: `~/.sasiki/browser-skill/tmp/`
- durable page knowledge: `skill/knowledge/page-knowledge.jsonl`

## Verification

Current migration-period checks:

```bash
node --test skill/test/http/*.test.mjs
npx tsx --test skill/test/contracts/skill-contracts.test.ts
```
