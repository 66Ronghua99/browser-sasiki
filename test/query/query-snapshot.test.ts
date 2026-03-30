import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { querySnapshotText, type SnapshotQuerySearchResult } from "../../lib/knowledge-query.js";
import { TabBindingStore } from "../../lib/tab-binding-store.js";
import { parseQuerySnapshotCliArgs, runQuerySnapshotCommand } from "../../scripts/query-snapshot.js";

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

async function createQueryHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-query-"));
  const homeDir = path.join(root, "home");
  const runtimeRoot = path.join(homeDir, ".sasiki", "browser-skill", "tmp");
  const snapshotsDir = path.join(runtimeRoot, "snapshots");
  const tabStateDir = path.join(runtimeRoot, "tab-state");
  const knowledgeFile = path.join(root, "skill", "knowledge", "page-knowledge.jsonl");
  await mkdir(snapshotsDir, { recursive: true });
  await mkdir(tabStateDir, { recursive: true });

  return {
    homeDir,
    knowledgeFile,
    snapshotsDir,
    tabBindings: new TabBindingStore(tabStateDir),
  };
}

test("query-snapshot resolves the latest bound snapshot from --tab-ref", async () => {
  const harness = await createQueryHarness();
  const snapshotPath = path.join(harness.snapshotsDir, "latest.md");
  await writeFile(snapshotPath, snapshotText, "utf8");
  await harness.tabBindings.write({
    tabRef: "tab_demo",
    browserTabIndex: 1,
    snapshotPath,
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current",
      title: "Inbox",
    },
  });

  const previousHome = process.env.HOME;
  process.env.HOME = harness.homeDir;

  try {
    const result = await runQuerySnapshotCommand(
      parseQuerySnapshotCliArgs({
        "tab-ref": "tab_demo",
        mode: "search",
        query: "Customer messages",
        "knowledge-file": harness.knowledgeFile,
      }),
    );

    assertSearchResult(result);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.ref, "msg");
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

test("query-snapshot rejects invalid --mode values explicitly", () => {
  assert.throws(
    () =>
      parseQuerySnapshotCliArgs({
        "snapshot-text": snapshotText,
        mode: "invalid",
      }),
    /mode.*search.*auto.*full/i,
  );
});

test("query-snapshot rejects bare --mode instead of defaulting silently", () => {
  assert.throws(
    () =>
      parseQuerySnapshotCliArgs({
        "snapshot-text": snapshotText,
        mode: true,
      }),
    /mode.*requires a value|mode.*search.*auto.*full/i,
  );
});

test("query-snapshot rejects omitted --mode explicitly", () => {
  assert.throws(
    () =>
      parseQuerySnapshotCliArgs({
        "snapshot-text": snapshotText,
        query: "Customer messages",
      }),
    /mode.*required|mode.*--mode/i,
  );
});

test("query-snapshot rejects --mode search without a selector", () => {
  assert.throws(
    () =>
      parseQuerySnapshotCliArgs({
        "snapshot-text": snapshotText,
        mode: "search",
      }),
    /search.*requires.*text|query|role|ref/i,
  );
});

test("query-snapshot maps the documented --query alias to text search", async () => {
  const harness = await createQueryHarness();
  const result = await runQuerySnapshotCommand(
    parseQuerySnapshotCliArgs({
      "snapshot-text": snapshotText,
      mode: "search",
      query: "Customer messages",
      "knowledge-file": harness.knowledgeFile,
    }),
  );

  assertSearchResult(result);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.ref, "msg");
});

test("query-snapshot still supports explicit --snapshot-path after parser validation", async () => {
  const harness = await createQueryHarness();
  const snapshotPath = path.join(harness.snapshotsDir, "explicit.md");
  await writeFile(snapshotPath, snapshotText, "utf8");

  const result = await runQuerySnapshotCommand(
    parseQuerySnapshotCliArgs({
      "snapshot-path": snapshotPath,
      mode: "search",
      query: "Customer messages",
      "knowledge-file": harness.knowledgeFile,
    }),
  );

  assertSearchResult(result);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.ref, "msg");
});
