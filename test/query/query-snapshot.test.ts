import assert from "node:assert/strict";
import test from "node:test";

import { querySnapshotText } from "../../lib/knowledge-query.mjs";

type SnapshotQuerySearchResult = Extract<ReturnType<typeof querySnapshotText>, { mode: "search" }>;

const snapshotText = [
  "## Latest page snapshot",
  'uid=1_0 RootWebArea "Inbox" url="https://example.com/chat/inbox/current"',
  '  uid=1_1 button "Customer messages"',
  '  uid=1_2 button "Invite [Beta]"',
  '  uid=1_3 tab "未分配"',
  '  uid=1_4 StaticText "No chats yet"',
  "  uid=1_5 textbox",
].join("\n");

const waitForSnapshotText = [
  'Element matching one of ["Customer messages"] found.',
  snapshotText,
].join("\n");

function assertSearchResult(result: ReturnType<typeof querySnapshotText>): asserts result is SnapshotQuerySearchResult {
  assert.equal(result.mode, "search");
}

test("querySnapshotText full mode parses page identity from a Chrome DevTools snapshot envelope", () => {
  const result = querySnapshotText({
    snapshotText: waitForSnapshotText,
    mode: "full",
  });

  assert.equal(result.mode, "full");
  assert.equal(result.snapshotText, waitForSnapshotText);
  assert.equal(result.page.normalizedPath, "/chat/inbox/current");
  assert.equal(result.page.title, "Inbox");
});

test("querySnapshotText search mode finds matching snapshot elements", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "search",
    text: "Customer messages",
  });

  assertSearchResult(result);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].uid, "1_1");
  assert.equal(result.matches[0].role, "button");
});

test("querySnapshotText search mode parses uid selectors from accessibility-tree lines", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "search",
    uid: "1_3",
  });

  assertSearchResult(result);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].uid, "1_3");
  assert.equal(result.matches[0].role, "tab");
  assert.equal(result.matches[0].text, "未分配");
});

test("querySnapshotText search mode preserves bracket text inside quoted labels", () => {
  const result = querySnapshotText({
    snapshotText,
    mode: "search",
    uid: "1_2",
  });

  assertSearchResult(result);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].uid, "1_2");
  assert.equal(result.matches[0].role, "button");
  assert.equal(result.matches[0].text, "Invite [Beta]");
});

test("querySnapshotText parses role-only accessibility nodes without labels", () => {
  const roleOnlySnapshotText = [
    "## Latest page snapshot",
    'uid=1_0 RootWebArea "Notes" url="https://example.com/notes"',
    "  uid=1_1 image",
    "  uid=1_2 button",
    '  uid=1_3 StaticText "测试笔记标题"',
  ].join("\n");

  const imgResult = querySnapshotText({
    snapshotText: roleOnlySnapshotText,
    mode: "search",
    role: "image",
  });

  assertSearchResult(imgResult);
  assert.equal(imgResult.matches.length, 1);
  assert.equal(imgResult.matches[0].role, "image");
  assert.equal(imgResult.matches[0].text, "");
  assert.equal(imgResult.matches[0].uid, "1_1");

  const buttonResult = querySnapshotText({
    snapshotText: roleOnlySnapshotText,
    mode: "search",
    uid: "1_2",
  });

  assertSearchResult(buttonResult);
  assert.equal(buttonResult.matches.length, 1);
  assert.equal(buttonResult.matches[0].role, "button");
  assert.equal(buttonResult.matches[0].text, "");
  assert.equal(buttonResult.matches[0].uid, "1_2");

  const textResult = querySnapshotText({
    snapshotText: roleOnlySnapshotText,
    mode: "search",
    uid: "1_3",
  });

  assertSearchResult(textResult);
  assert.equal(textResult.matches.length, 1);
  assert.equal(textResult.matches[0].role, "StaticText");
  assert.equal(textResult.matches[0].text, "测试笔记标题");
  assert.equal(textResult.matches[0].uid, "1_3");
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
