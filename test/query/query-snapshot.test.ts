import assert from "node:assert/strict";
import test from "node:test";

import { querySnapshotText } from "../../lib/knowledge-query.js";

const snapshotText = [
  "### Open tabs",
  "- 0: (current) [Inbox](https://example.com/chat/inbox/current)",
  "### Page",
  "- Page URL: https://example.com/chat/inbox/current",
  "- Page Title: Inbox",
  "### Snapshot",
  "```yaml",
  "- button \"Customer messages\" [ref=msg]",
  "- text \"No chats yet\"",
  "```",
].join("\n");

test("querySnapshotText full mode returns the raw snapshot content", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "full",
  });

  assert.equal(result.mode, "full");
  assert.equal(result.snapshotText, snapshotText);
  assert.equal(result.page.normalizedPath, "/chat/inbox/current");
});

test("querySnapshotText search mode finds matching snapshot elements", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "search",
    text: "Customer messages",
  });

  assert.equal(result.mode, "search");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].ref, "msg");
  assert.equal(result.matches[0].role, "button");
});

test("querySnapshotText auto mode falls back to full snapshot content without knowledge", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "auto",
  });

  assert.equal(result.mode, "full");
  assert.equal(result.snapshotText, snapshotText);
});

test("querySnapshotText auto mode narrows matches with knowledge cues", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "auto",
    knowledgeHits: [
      {
        guide: "Check the conversation list first.",
        keywords: ["Customer messages", "No chats yet"],
      },
    ],
  });

  assert.equal(result.mode, "search");
  assert.equal(result.matches.length, 2);
  assert.equal(result.knowledgeHits.length, 1);
});
