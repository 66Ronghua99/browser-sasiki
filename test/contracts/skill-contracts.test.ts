import assert from "node:assert/strict";
import test from "node:test";

import {
  assertActionResult,
  assertCaptureResult,
} from "../../lib/types.js";
import { defaultRuntimeRoots } from "../../lib/paths.js";

test("capture result requires tabRef, snapshotPath, and page identity", () => {
  assert.doesNotThrow(() =>
    assertCaptureResult({
      ok: true,
      tabRef: "tab_demo",
      page: {
        origin: "https://example.com",
        normalizedPath: "/dashboard",
        title: "Dashboard",
      },
      snapshotPath: "/tmp/snapshot.md",
      knowledgeHits: [],
      summary: "ready",
    })
  );

  assert.throws(() => assertCaptureResult({ ok: true }), /tabRef/);
});

test("default runtime roots keep temp state outside the portable skill folder", () => {
  const roots = defaultRuntimeRoots();
  assert.match(roots.tempRoot, /\.sasiki\/browser-skill\/tmp$/);
  assert.match(roots.knowledgeFile, /skill\/knowledge\/page-knowledge\.jsonl$/);
});

test("mutation result requires explicit tabRef and snapshotPath", () => {
  assert.throws(
    () => assertActionResult({ ok: true, action: "click" }),
    /snapshotPath/
  );
});
