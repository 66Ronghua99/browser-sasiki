# Browser Skill

Portable browser automation skill for agents that need to drive a page, keep work bound to a `tabRef`, and optionally persist reusable page knowledge.

## Command Surface

Start with `capture.ts` to bind or refresh a `tabRef` for the current browser tab.

- `capture.ts` - establish or refresh `tabRef`, capture a fresh snapshot, and load matching page knowledge
- `navigate.ts` - go to a new URL for an existing `tabRef`
- `click.ts` - click a target element for an existing `tabRef`
- `type.ts` - type text for an existing `tabRef`
- `press.ts` - send a key press for an existing `tabRef`
- `select-tab.ts` - switch the skill binding to a different browser tab
- `query-snapshot.ts` - query the latest snapshot for a bound tab
- `read-knowledge.ts` - read durable page knowledge for a specific page identity
- `record-knowledge.ts` - append or update durable page knowledge when a reusable cue is worth keeping

## Operating Notes

- Every mutation command is tied to an explicit `tabRef`.
- `query-snapshot.ts` is the default way to inspect the latest snapshot.
- Use `read-knowledge.ts` only for durable knowledge, not as a generic folder scan.
- Use `record-knowledge.ts` only when a page-level cue is clearly reusable and worth keeping for later runs.
- Runtime temp state lives outside `skill/`; durable knowledge lives under `skill/knowledge/`.

## Minimal Flow

1. Run `capture.ts` to bind the page and get the initial snapshot path.
2. Use the action scripts against that `tabRef`.
3. Query the latest snapshot with `query-snapshot.ts` when you need structure-level lookup.
4. Record knowledge only when the discovered cue is stable enough to help future runs.
