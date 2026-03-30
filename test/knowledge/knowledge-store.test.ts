import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";

import { KnowledgeStore } from "../../lib/knowledge-store.js";
import { runReadKnowledgeCommand } from "../../scripts/read-knowledge.js";
import { runRecordKnowledgeCommand } from "../../scripts/record-knowledge.js";

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

test("read knowledge can fetch a record by id and fails for a missing id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-knowledge-"));
  const storePath = path.join(root, "page-knowledge.jsonl");

  const recordResult = await runRecordKnowledgeCommand({
    "knowledge-file": storePath,
    id: "k-read-1",
    origin: "https://example.com",
    path: "/chat/inbox/current/",
    guide: "Inspect the message list first.",
    keywords: "inbox,message list",
  });

  assert.equal(recordResult.ok, true);
  assert.equal(recordResult.record.page.normalizedPath, "/chat/inbox/current");

  const idReadResult = await runReadKnowledgeCommand({
    "knowledge-file": storePath,
    id: "k-read-1",
  });

  assert.equal(idReadResult.ok, true);
  assert.equal(idReadResult.mode, "id");
  assert.equal(idReadResult.knowledge.id, "k-read-1");
  assert.equal(idReadResult.knowledge.page.normalizedPath, "/chat/inbox/current");

  const readResult = await runReadKnowledgeCommand({
    "knowledge-file": storePath,
    origin: "https://example.com",
    path: "/chat/inbox/current",
  });

  assert.equal(readResult.ok, true);
  assert.equal(readResult.mode, "page");
  assert.equal(readResult.page.normalizedPath, "/chat/inbox/current");
  assert.equal(readResult.knowledge.length, 1);
  assert.equal(readResult.knowledge[0].page.normalizedPath, "/chat/inbox/current");

  await assert.rejects(
    () =>
      runReadKnowledgeCommand({
        "knowledge-file": storePath,
        id: "missing-id",
      }),
    /Knowledge record not found for id missing-id/
  );
});

test("recording the same knowledge id replaces stale duplicates for id and page reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-knowledge-"));
  const storePath = path.join(root, "page-knowledge.jsonl");

  await runRecordKnowledgeCommand({
    "knowledge-file": storePath,
    id: "k-duplicate",
    origin: "https://example.com",
    path: "/chat/inbox/current/",
    guide: "Initial queue guidance.",
    keywords: "inbox,initial",
  });

  await runRecordKnowledgeCommand({
    "knowledge-file": storePath,
    id: "k-duplicate",
    origin: "https://example.com",
    path: "/chat/inbox/current",
    guide: "Updated queue guidance.",
    keywords: "inbox,updated",
  });

  const idReadResult = await runReadKnowledgeCommand({
    "knowledge-file": storePath,
    id: "k-duplicate",
  });

  assert.equal(idReadResult.mode, "id");
  assert.equal(idReadResult.knowledge.guide, "Updated queue guidance.");
  assert.equal(idReadResult.knowledge.page.normalizedPath, "/chat/inbox/current");

  const pageReadResult = await runReadKnowledgeCommand({
    "knowledge-file": storePath,
    origin: "https://example.com",
    path: "/chat/inbox/current/",
  });

  assert.equal(pageReadResult.mode, "page");
  assert.equal(pageReadResult.knowledge.length, 1);
  assert.equal(pageReadResult.knowledge[0].guide, "Updated queue guidance.");

  const store = new KnowledgeStore(storePath);
  const allRecords = await store.readAll();
  assert.equal(allRecords.length, 1);
  assert.equal(allRecords[0].guide, "Updated queue guidance.");
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
    "utf8"
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
