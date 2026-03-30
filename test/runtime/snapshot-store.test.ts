import assert from "node:assert/strict";
import { mkdtemp, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SnapshotStore } from "../../lib/snapshot-store.js";

test("snapshot store writes files and deletes expired files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-snapshots-"));
  const store = new SnapshotStore(path.join(root, "snapshots"), { ttlMs: 10 });

  const fresh = await store.write("### Fresh Snapshot\n");
  const expired = await store.write("### Expired Snapshot\n");

  const staleTime = new Date(Date.now() - 60_000);
  await utimes(expired.snapshotPath, staleTime, staleTime);

  await store.cleanupExpired();

  assert.equal(await store.exists(fresh.snapshotPath), true);
  assert.equal(await store.exists(expired.snapshotPath), false);
});
