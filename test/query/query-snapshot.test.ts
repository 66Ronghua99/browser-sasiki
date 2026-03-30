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
  "- button \"Invite [Beta]\" [active] [ref=invite] [cursor=pointer]:",
  "- tab \"未分配\" [active] [selected] [ref=e193] [cursor=pointer]:",
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

test("querySnapshotText search mode parses ref-bearing YAML lines with extra attributes", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "search",
    ref: "e193",
  });

  assert.equal(result.mode, "search");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].ref, "e193");
  assert.equal(result.matches[0].role, "tab");
  assert.equal(result.matches[0].text, "未分配");
});

test("querySnapshotText search mode preserves bracket text inside quoted labels", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "search",
    ref: "invite",
  });

  assert.equal(result.mode, "search");
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].ref, "invite");
  assert.equal(result.matches[0].role, "button");
  assert.equal(result.matches[0].text, "Invite [Beta]");
});

test("querySnapshotText auto mode falls back to full snapshot content without knowledge", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "auto",
  });

  assert.equal(result.mode, "full");
  assert.equal(result.snapshotText, snapshotText);
});

test("querySnapshotText auto mode falls back to full snapshot content when knowledge is stale", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "auto",
    knowledgeHits: [
      {
        guide: "Use the footer export button.",
        keywords: ["archive", "download"],
      },
    ],
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
