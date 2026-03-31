import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceBindingStore } from "../../scripts/workspace-binding-store.mjs";

test("workspace binding store round-trips the latest snapshot per workspaceRef", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-tabs-"));
  const store = new WorkspaceBindingStore(path.join(root, "workspace-bindings"));

  await store.write({
    workspaceRef: "workspace_demo",
    browserTabIndex: 1,
    snapshotPath: "/tmp/one.md",
    page: { origin: "https://example.com", normalizedPath: "/one", title: "One" },
  });

  const record = await store.read("workspace_demo");

  assert.equal(record.workspaceRef, "workspace_demo");
  assert.equal(record.browserTabIndex, 1);
  assert.equal(record.snapshotPath, "/tmp/one.md");
  assert.deepEqual(record.page, {
    origin: "https://example.com",
    normalizedPath: "/one",
    title: "One",
  });
});

test("workspace binding store rejects malformed on-disk records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-tabs-"));
  const store = new WorkspaceBindingStore(path.join(root, "workspace-bindings"));
  await mkdir(path.join(root, "workspace-bindings"), { recursive: true });
  await writeFile(
    path.join(root, "workspace-bindings", "workspace_demo.json"),
    JSON.stringify({
      workspaceRef: "workspace_demo",
      browserTabIndex: 1,
      snapshotPath: "/tmp/one.md",
      page: {
        origin: "https://example.com",
        normalizedPath: "/one",
      },
    }),
    "utf8"
  );

  await assert.rejects(
    () => store.read("workspace_demo"),
    /page\.title/i
  );
});
