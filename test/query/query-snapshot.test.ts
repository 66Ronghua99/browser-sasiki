import assert from "node:assert/strict";
import test from "node:test";

import { querySnapshotText, type SnapshotQuerySearchResult } from "../../lib/knowledge-query.js";

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

function assertSearchResult(result: ReturnType<typeof querySnapshotText>): asserts result is SnapshotQuerySearchResult {
  assert.equal(result.mode, "search");
}

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

  assertSearchResult(result);
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

  assertSearchResult(result);
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

  assertSearchResult(result);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].ref, "invite");
  assert.equal(result.matches[0].role, "button");
  assert.equal(result.matches[0].text, "Invite [Beta]");
});

test("querySnapshotText parses role-only bare nodes and trims structural colons", () => {
  const roleOnlySnapshotText = [
    "### Page",
    "- Page URL: https://example.com/notes",
    "- Page Title: Notes",
    "### Snapshot",
    "```yaml",
    "- img [ref=e1]",
    "- button [ref=e109]:",
    "- text [ref=t1]: 测试笔记标题",
    "```",
  ].join("\n");

  const imgResult = querySnapshotText({
    snapshotText: roleOnlySnapshotText,
    mode: "search",
    role: "img",
  });

  assertSearchResult(imgResult);
  assert.equal(imgResult.matches.length, 1);
  assert.equal(imgResult.matches[0].role, "img");
  assert.equal(imgResult.matches[0].text, "");
  assert.equal(imgResult.matches[0].ref, "e1");

  const buttonResult = querySnapshotText({
    snapshotText: roleOnlySnapshotText,
    mode: "search",
    ref: "e109",
  });

  assertSearchResult(buttonResult);
  assert.equal(buttonResult.matches.length, 1);
  assert.equal(buttonResult.matches[0].role, "button");
  assert.equal(buttonResult.matches[0].text, "");

  const textResult = querySnapshotText({
    snapshotText: roleOnlySnapshotText,
    mode: "search",
    ref: "t1",
  });

  assertSearchResult(textResult);
  assert.equal(textResult.matches.length, 1);
  assert.equal(textResult.matches[0].role, "text");
  assert.equal(textResult.matches[0].text, "测试笔记标题");
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

  assertSearchResult(result);
  assert.equal(result.matches.length, 2);
  assert.equal(result.knowledgeHits.length, 1);
});
