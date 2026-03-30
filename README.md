# Browser Skill

Portable browser automation skill for agents that need to drive a page, keep work bound to a `tabRef`, and optionally persist reusable page knowledge.

## Command Surface

Start with `capture.ts` to bind or refresh a `tabRef` for the current browser tab.

- `capture.ts --tab-ref <existing|new>` - establish or refresh a `tabRef`, capture a fresh snapshot, and load matching page knowledge
- `navigate.ts --tab-ref <tabRef> --url <absolute-url>` - go to a new URL and auto-capture the refreshed snapshot for that tab
- `click.ts --tab-ref <tabRef> --ref <element-ref>` - click a target element and auto-capture the refreshed snapshot
- `type.ts --tab-ref <tabRef> --ref <element-ref> --text <value>` - type text and auto-capture the refreshed snapshot
- `press.ts --tab-ref <tabRef> --key <key-name>` - send a key press and auto-capture the refreshed snapshot
- `select-tab.ts --tab-ref <tabRef> --index <tab-index>` - switch the binding to a different browser tab and auto-capture the refreshed snapshot
- `query-snapshot.ts --tab-ref <tabRef> --mode <search|auto|full> [--query <text|ref|role>]` - query the latest snapshot for a bound tab
- `read-knowledge.ts --origin <origin> --normalized-path <path>` - read durable page knowledge for a specific page identity
- `record-knowledge.ts --origin <origin> --normalized-path <path> --guide <text> [--keywords <comma-separated>]` - append or update durable page knowledge for a reusable cue

## Operating Notes

- Every mutation command is tied to an explicit `tabRef`.
- Check returned `knowledgeHits` first after capture or any mutation.
- Use `query-snapshot.ts` only when those hits are not enough and you still need a fresh `ref` or deeper structural lookup.
- Use `read-knowledge.ts` only for durable knowledge, not as a generic folder scan.
- Use `record-knowledge.ts` only when a page-level cue is clearly reusable and worth keeping for later runs.
- Runtime temp state lives outside `skill/`; durable knowledge lives under `skill/knowledge/`.

## Minimal Flow

1. Run `capture.ts` to bind the page and get the initial snapshot path.
2. Use the action scripts against that `tabRef`; they auto-capture after each action.
3. Check `knowledgeHits` before opening `query-snapshot.ts`.
4. Record knowledge only when the discovered cue is stable enough to help future runs.
