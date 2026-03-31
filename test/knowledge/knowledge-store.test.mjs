import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { KnowledgeStore } from "../../scripts/knowledge-store.mjs";

test("KnowledgeStore appends page knowledge and reads it back by exact page", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-knowledge-"));
  const storePath = path.join(root, "page-knowledge.jsonl");
  const store = new KnowledgeStore(storePath);

  await store.append({
    id: "k1",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current/",
    },
    guide: "Check the queue header first.",
    keywords: ["Customer messages", "No chats yet"],
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    sourceSnapshotPath: "/tmp/snapshot.md",
    sourceAction: "capture",
  });

  await store.append({
    id: "k2",
    page: {
      origin: "https://example.com",
      normalizedPath: "/dashboard",
    },
    guide: "Dashboard guide should not leak into the inbox.",
    keywords: ["dashboard"],
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    sourceSnapshotPath: "/tmp/dashboard.md",
    sourceAction: "capture",
  });

  const reopenedStore = new KnowledgeStore(storePath);
  const allRecords = await reopenedStore.readAll();
  assert.equal(allRecords[0].page.normalizedPath, "/chat/inbox/current");

  const matches = await reopenedStore.queryByPage({
    origin: "https://example.com",
    normalizedPath: "/chat/inbox/current",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "k1");
  assert.equal(matches[0].guide, "Check the queue header first.");
  assert.deepEqual(matches[0].keywords, ["Customer messages", "No chats yet"]);
});

test("KnowledgeStore reads a record by id and fails for a missing id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-knowledge-"));
  const storePath = path.join(root, "page-knowledge.jsonl");
  const store = new KnowledgeStore(storePath);

  await store.append({
    id: "k-read-1",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current/",
    },
    guide: "Inspect the message list first.",
    keywords: ["inbox", "message list"],
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
  });

  const idReadResult = await store.readById("k-read-1");
  assert.equal(idReadResult.id, "k-read-1");
  assert.equal(idReadResult.page.normalizedPath, "/chat/inbox/current");

  await assert.rejects(() => store.readById("missing-id"), /Knowledge record not found for id missing-id/);
});

test("normalized-path alias is accepted when records are appended", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-knowledge-"));
  const storePath = path.join(root, "page-knowledge.jsonl");
  const store = new KnowledgeStore(storePath);

  await store.append({
    id: "alias-1",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current/",
    },
    guide: "Alias guidance.",
    keywords: ["alias"],
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
  });

  const matches = await store.queryByPage({
    origin: "https://example.com",
    normalizedPath: "/chat/inbox/current",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].guide, "Alias guidance.");
  assert.equal(matches[0].page.normalizedPath, "/chat/inbox/current");
});

test("recording the same knowledge id replaces stale duplicates for id and page reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-knowledge-"));
  const storePath = path.join(root, "page-knowledge.jsonl");
  const store = new KnowledgeStore(storePath);

  await store.append({
    id: "k-duplicate",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current/",
    },
    guide: "Initial queue guidance.",
    keywords: ["inbox", "initial"],
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
  });

  await store.append({
    id: "k-duplicate",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current",
    },
    guide: "Updated queue guidance.",
    keywords: ["inbox", "updated"],
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
  });

  const idReadResult = await store.readById("k-duplicate");
  assert.equal(idReadResult.guide, "Updated queue guidance.");
  assert.equal(idReadResult.page.normalizedPath, "/chat/inbox/current");

  const pageReadResult = await store.queryByPage({
    origin: "https://example.com",
    normalizedPath: "/chat/inbox/current/",
  });

  assert.equal(pageReadResult.length, 1);
  assert.equal(pageReadResult[0].guide, "Updated queue guidance.");

  const allRecords = await store.readAll();
  assert.equal(allRecords.length, 1);
  assert.equal(allRecords[0].guide, "Updated queue guidance.");
});

test("semantic duplicate knowledge on the same page collapses into one reusable hit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-knowledge-"));
  const storePath = path.join(root, "page-knowledge.jsonl");
  const store = new KnowledgeStore(storePath);

  await store.append({
    id: "k-semantic-1",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current",
    },
    guide: "Check the queue header first.",
    keywords: ["header", "inbox"],
    rationale: "The header confirms the inbox context.",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
  });

  await store.append({
    id: "k-semantic-2",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current/",
    },
    guide: "Check the queue header first.",
    keywords: ["inbox", "header"],
    rationale: "The queue header confirms the inbox context again.",
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T00:00:00.000Z",
  });

  const matches = await store.queryByPage({
    origin: "https://example.com",
    normalizedPath: "/chat/inbox/current",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].guide, "Check the queue header first.");
  assert.deepEqual(matches[0].keywords, ["inbox", "header"]);

  const allRecords = await store.readAll();
  assert.equal(allRecords.length, 1);
  assert.equal(allRecords[0].id, "k-semantic-2");
});

test("legacy JSONL records are normalized on read for both id and page lookups", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-knowledge-"));
  const storePath = path.join(root, "page-knowledge.jsonl");

  await writeFile(
    storePath,
    [
      JSON.stringify({
        id: "legacy-1",
        page: {
          origin: "https://example.com",
          normalizedPath: "/chat/inbox/current/",
        },
        guide: "Legacy guidance.",
        keywords: ["legacy"],
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z",
        sourceSnapshotPath: "/tmp/legacy.md",
        sourceAction: "capture",
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const store = new KnowledgeStore(storePath);
  const byId = await store.readById("legacy-1");
  assert.equal(byId.page.normalizedPath, "/chat/inbox/current");

  const byPage = await store.queryByPage({
    origin: "https://example.com",
    normalizedPath: "/chat/inbox/current",
  });

  assert.equal(byPage.length, 1);
  assert.equal(byPage[0].id, "legacy-1");
  assert.equal(byPage[0].page.normalizedPath, "/chat/inbox/current");
});
