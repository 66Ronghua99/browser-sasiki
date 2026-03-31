import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { setSessionRpcRequestSenderForTesting } from "../../lib/cli.js";
import { querySnapshotText, type SnapshotQuerySearchResult } from "../../lib/knowledge-query.js";
import { TabBindingStore } from "../../lib/tab-binding-store.js";
import { runReadKnowledgeCommand } from "../../scripts/read-knowledge.js";
import { parseQuerySnapshotCliArgs, runQuerySnapshotCommand } from "../../scripts/query-snapshot.js";
import { runRecordKnowledgeCommand } from "../../scripts/record-knowledge.js";

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

  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push({ method: request.method, params: request.params as Record<string, unknown> });

    return {
      ok: true as const,
      mode: "search" as const,
      tabRef: "tab_demo",
      snapshotRef: "snapshot_demo",
      snapshotPath,
      page: {
        origin: "https://example.com",
        normalizedPath: "/chat/inbox/current",
        title: "Inbox",
      },
      knowledgeHits: [],
      summary: "resolved from the session",
      matches: [
        {
          lineNumber: 2,
          raw: '  uid=1_1 button "Customer messages"',
          role: "button",
          text: "Customer messages",
          uid: "1_1",
          ref: "1_1",
        },
      ],
    };
  });

  try {
    const result = await runQuerySnapshotCommand(
      parseQuerySnapshotCliArgs({
        "tab-ref": "tab_demo",
        mode: "search",
        query: "Customer messages",
      }),
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "querySnapshot");
    assert.equal(requests[0]?.params.tabRef, "tab_demo");
    assert.equal("includeSnapshot" in (requests[0]?.params ?? {}), false);
    assertSearchResult(result);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.uid, "1_1");
    assert.equal("snapshotText" in result, false);
    assert.equal("snapshotPath" in result, false);
  } finally {
    setSessionRpcRequestSenderForTesting(undefined);
  }
});

test("query-snapshot accepts --snapshot-ref and delegates to the session seam", async () => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push({ method: request.method, params: request.params as Record<string, unknown> });

    return {
      ok: true as const,
      mode: "search" as const,
      tabRef: "tab_demo",
      snapshotRef: "snapshot_demo",
      snapshotPath: "/tmp/browser-skill/snapshots/snapshot-demo.md",
      page: {
        origin: "https://example.com",
        normalizedPath: "/chat/inbox/current",
        title: "Inbox",
      },
      knowledgeHits: [],
      summary: "resolved by the daemon",
      matches: [
        {
          lineNumber: 2,
          raw: '  uid=1_1 button "Customer messages"',
          role: "button",
          text: "Customer messages",
          uid: "1_1",
          ref: "1_1",
        },
      ],
    };
  });

  try {
    const result = await runQuerySnapshotCommand(
      parseQuerySnapshotCliArgs({
        "snapshot-ref": "snapshot_demo",
        mode: "search",
        query: "Customer messages",
      }),
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "querySnapshot");
    assert.equal(requests[0]?.params.snapshotRef, "snapshot_demo");
    assert.equal("includeSnapshot" in (requests[0]?.params ?? {}), false);
    assertSearchResult(result);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0]?.uid, "1_1");
    assert.equal(result.page.normalizedPath, "/chat/inbox/current");
    assert.equal("snapshotText" in result, false);
    assert.equal("snapshotPath" in result, false);
  } finally {
    setSessionRpcRequestSenderForTesting(undefined);
  }
});

test("query-snapshot forwards --role to the daemon-backed session seam", async () => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push({ method: request.method, params: request.params as Record<string, unknown> });

    return {
      ok: true as const,
      mode: "search" as const,
      tabRef: "tab_demo",
      snapshotRef: "snapshot_demo",
      snapshotPath: "/tmp/browser-skill/snapshots/snapshot-demo.md",
      page: {
        origin: "https://example.com",
        normalizedPath: "/chat/inbox/current",
        title: "Inbox",
      },
      knowledgeHits: [],
      summary: "resolved by role selector",
      matches: [
        {
          lineNumber: 2,
          raw: '  uid=1_1 button "Customer messages"',
          role: "button",
          text: "Customer messages",
          uid: "1_1",
          ref: "1_1",
        },
      ],
    };
  });

  try {
    const result = await runQuerySnapshotCommand(
      parseQuerySnapshotCliArgs({
        "tab-ref": "tab_demo",
        mode: "search",
        role: "button",
      }),
    );

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "querySnapshot");
    assert.equal(requests[0]?.params.tabRef, "tab_demo");
    assert.equal(requests[0]?.params.role, "button");
    assertSearchResult(result);
    assert.equal(result.matches[0]?.role, "button");
  } finally {
    setSessionRpcRequestSenderForTesting(undefined);
  }
});

test("read-knowledge and record-knowledge can run through the session seam", async () => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push({ method: request.method, params: request.params as Record<string, unknown> });

    if (request.method === "readKnowledge") {
      return {
        ok: true as const,
        mode: "page" as const,
        page: {
          origin: "https://example.com",
          normalizedPath: "/chat/inbox/current",
        },
        knowledge: [
          {
            id: "knowledge_demo",
            page: {
              origin: "https://example.com",
              normalizedPath: "/chat/inbox/current",
            },
            guide: "Check the conversation list first.",
            keywords: ["inbox", "conversation"],
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
          },
        ],
      };
    }

    return {
      ok: true as const,
      record: {
        id: "knowledge_demo",
        page: {
          origin: "https://example.com",
          normalizedPath: "/chat/inbox/current",
        },
        guide: "Check the conversation list first.",
        keywords: ["inbox", "conversation"],
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z",
        sourceSnapshotPath: "/tmp/browser-skill/snapshots/snapshot-demo.md",
        sourceAction: "capture",
      },
    };
  });

  try {
    const readResult = await runReadKnowledgeCommand({
      "snapshot-ref": "snapshot_demo",
      origin: "https://example.com",
      "normalized-path": "/chat/inbox/current",
      "knowledge-file": path.join(os.tmpdir(), "ignored.jsonl"),
    });

    assert.equal(requests[0]?.method, "readKnowledge");
    assert.equal(requests[0]?.params.snapshotRef, "snapshot_demo");
    assert.equal(readResult.ok, true);
    assert.equal(readResult.mode, "page");
    assert.equal(readResult.page.normalizedPath, "/chat/inbox/current");
    assert.equal(readResult.knowledge.length, 1);

    const recordResult = await runRecordKnowledgeCommand({
      "snapshot-ref": "snapshot_demo",
      origin: "https://example.com",
      "normalized-path": "/chat/inbox/current",
      guide: "Check the conversation list first.",
      keywords: "inbox, conversation",
      "knowledge-file": path.join(os.tmpdir(), "ignored.jsonl"),
    });

    assert.equal(requests[1]?.method, "recordKnowledge");
    assert.equal(requests[1]?.params.snapshotRef, "snapshot_demo");
    assert.equal(recordResult.ok, true);
    assert.equal(recordResult.record.id, "knowledge_demo");
  } finally {
    setSessionRpcRequestSenderForTesting(undefined);
  }
});

test("record-knowledge allows tab-ref-only writes and lets the daemon infer page identity", async () => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push({ method: request.method, params: request.params as Record<string, unknown> });

    return {
      ok: true as const,
      record: {
        id: "knowledge_from_tab",
        page: {
          origin: "https://x.com",
          normalizedPath: "/zarazhang",
          title: "Zara Zhang",
        },
        guide: "Scroll to the lower navigation cluster to find Article on profile pages.",
        keywords: ["article", "profile", "scroll"],
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      },
    };
  });

  try {
    const recordResult = await runRecordKnowledgeCommand({
      "tab-ref": "x-work",
      guide: "Scroll to the lower navigation cluster to find Article on profile pages.",
      keywords: "article, profile, scroll",
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "recordKnowledge");
    assert.deepEqual(requests[0]?.params, {
      tabRef: "x-work",
      guide: "Scroll to the lower navigation cluster to find Article on profile pages.",
      keywords: ["article", "profile", "scroll"],
    });
    assert.equal(recordResult.ok, true);
    assert.equal(recordResult.record.id, "knowledge_from_tab");
    assert.equal(recordResult.record.page.normalizedPath, "/zarazhang");
  } finally {
    setSessionRpcRequestSenderForTesting(undefined);
  }
});

test("record-knowledge allows snapshot-ref-only writes and lets the daemon infer page identity", async () => {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push({ method: request.method, params: request.params as Record<string, unknown> });

    return {
      ok: true as const,
      record: {
        id: "knowledge_from_snapshot",
        page: {
          origin: "https://x.com",
          normalizedPath: "/search",
          title: "Search",
        },
        guide: "Search results often expose the profile entry directly from the people result cluster.",
        keywords: ["search", "profile", "people"],
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      },
    };
  });

  try {
    const recordResult = await runRecordKnowledgeCommand({
      "snapshot-ref": "snapshot_demo",
      guide: "Search results often expose the profile entry directly from the people result cluster.",
      keywords: "search, profile, people",
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.method, "recordKnowledge");
    assert.deepEqual(requests[0]?.params, {
      snapshotRef: "snapshot_demo",
      guide: "Search results often expose the profile entry directly from the people result cluster.",
      keywords: ["search", "profile", "people"],
    });
    assert.equal(recordResult.ok, true);
    assert.equal(recordResult.record.id, "knowledge_from_snapshot");
    assert.equal(recordResult.record.page.normalizedPath, "/search");
  } finally {
    setSessionRpcRequestSenderForTesting(undefined);
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

test("query-snapshot rejects legacy --knowledge-file because daemon-backed retrieval owns knowledge hits", () => {
  assert.throws(
    () =>
      parseQuerySnapshotCliArgs({
        "snapshot-text": snapshotText,
        mode: "search",
        query: "Customer messages",
        "knowledge-file": "/tmp/browser-skill/page-knowledge.jsonl",
      }),
    /knowledge-file.*daemon|knowledge-file.*supported/i,
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
    /search.*requires.*text|query|role|uid|ref/i,
  );
});

test("query-snapshot maps the documented --query alias to text search", async () => {
  const result = await runQuerySnapshotCommand(
    parseQuerySnapshotCliArgs({
      "snapshot-text": snapshotText,
      mode: "search",
      query: "Customer messages",
    }),
  );

  assertSearchResult(result);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0]?.uid, "1_1");
});

test("query-snapshot accepts the documented --uid selector and preserves legacy --ref as an alias", async () => {
  const uidResult = await runQuerySnapshotCommand(
    parseQuerySnapshotCliArgs({
      "snapshot-text": snapshotText,
      mode: "search",
      uid: "1_3",
    }),
  );

  assertSearchResult(uidResult);
  assert.equal(uidResult.matches.length, 1);
  assert.equal(uidResult.matches[0]?.uid, "1_3");

  const legacyAliasResult = await runQuerySnapshotCommand(
    parseQuerySnapshotCliArgs({
      "snapshot-text": snapshotText,
      mode: "search",
      ref: "1_3",
    }),
  );

  assertSearchResult(legacyAliasResult);
  assert.equal(legacyAliasResult.matches.length, 1);
  assert.equal(legacyAliasResult.matches[0]?.uid, "1_3");
});

test("query-snapshot rejects legacy --snapshot-path so agents stay on tabRef or snapshotRef", () => {
  assert.throws(
    () =>
      parseQuerySnapshotCliArgs({
        "snapshot-path": "/tmp/browser-skill/snapshots/explicit.md",
        mode: "search",
        query: "Customer messages",
      }),
    /no longer accepts --snapshot-path/i,
  );
});
