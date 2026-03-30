import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { TabBindingStore } from "../../lib/tab-binding-store.js";

test("tab binding store round-trips the latest snapshot per tabRef", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-tabs-"));
  const store = new TabBindingStore(path.join(root, "tab-state"));

  await store.write({
    tabRef: "tab_demo",
    browserTabIndex: 1,
    snapshotPath: "/tmp/one.md",
    page: { origin: "https://example.com", normalizedPath: "/one", title: "One" },
  });

  const record = await store.read("tab_demo");

  assert.equal(record.tabRef, "tab_demo");
  assert.equal(record.browserTabIndex, 1);
  assert.equal(record.snapshotPath, "/tmp/one.md");
  assert.deepEqual(record.page, {
    origin: "https://example.com",
    normalizedPath: "/one",
    title: "One",
  });
});

test("tab binding store rejects malformed on-disk records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-tabs-"));
  const store = new TabBindingStore(path.join(root, "tab-state"));
  await mkdir(path.join(root, "tab-state"), { recursive: true });
  await writeFile(
    path.join(root, "tab-state", "tab_demo.json"),
    JSON.stringify({
      tabRef: "tab_demo",
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
    () => store.read("tab_demo"),
    /page\.title/i
  );
});
