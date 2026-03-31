import assert from "node:assert/strict";
import { mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SnapshotStore } from "../../lib/snapshot-store.mjs";

test("snapshot store writes files and deletes expired files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-snapshots-"));
  const store = new SnapshotStore(path.join(root, "snapshots"), { ttlMs: 1_000 });

  const fresh = await store.write("### Fresh Snapshot\n");
  const expired = await store.write("### Expired Snapshot\n");

  const staleTime = new Date(Date.now() - 60_000);
  await utimes(expired.snapshotPath, staleTime, staleTime);

  await store.cleanupExpired();

  assert.equal(await store.exists(fresh.snapshotPath), true);
  assert.equal(await store.exists(expired.snapshotPath), false);
});

test("snapshot store cleanup surfaces unrelated filesystem errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-snapshots-"));
  const fileRoot = path.join(root, "snapshots-root-as-file");
  await writeFile(fileRoot, "not a directory", "utf8");
  const store = new SnapshotStore(fileRoot, { ttlMs: 1_000 });

  await assert.rejects(() => store.cleanupExpired(), /ENOTDIR|not a directory/i);
});

test("snapshot store exists surfaces unrelated filesystem errors", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-snapshots-"));
  const store = new SnapshotStore(path.join(root, "snapshots"), { ttlMs: 1_000 });

  await assert.rejects(() => store.exists("invalid\0path"), /ERR_INVALID_ARG_VALUE|invalid argument/i);
});
