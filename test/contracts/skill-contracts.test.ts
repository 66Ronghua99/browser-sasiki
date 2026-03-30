import assert from "node:assert/strict";
import test from "node:test";

import {
  assertActionResult,
  assertCaptureResult,
} from "../../lib/types.js";
import { defaultRuntimeRoots } from "../../lib/paths.js";

const captureBase = {
  ok: true as const,
  tabRef: "tab_demo",
  page: {
    origin: "https://example.com",
    normalizedPath: "/dashboard",
    title: "Dashboard",
  },
  snapshotPath: "/tmp/snapshot.md",
  knowledgeHits: [],
  tabs: [
    {
      tabRef: "tab_demo",
      title: "Dashboard",
      url: "https://example.com/dashboard",
      active: true,
    },
  ],
  summary: "ready",
};

test("capture result requires tabRef, snapshotPath, and page identity", () => {
  assert.doesNotThrow(() =>
    assertCaptureResult(captureBase)
  );

  assert.throws(() => assertCaptureResult({ ok: true }), /tabRef/);
  assert.throws(
    () =>
      assertCaptureResult({
        ...captureBase,
        tabs: undefined,
      }),
    /tabs/
  );
});

test("default runtime roots keep temp state outside the portable skill folder", () => {
  const originalCwd = process.cwd();
  try {
    process.chdir("/");
    const roots = defaultRuntimeRoots();
    assert.match(roots.tempRoot, /\.sasiki\/browser-skill\/tmp$/);
    assert.match(roots.knowledgeFile, /skill\/knowledge\/page-knowledge\.jsonl$/);
    assert.doesNotMatch(roots.knowledgeFile, /skill\/dist\/knowledge\/page-knowledge\.jsonl$/);
  } finally {
    process.chdir(originalCwd);
  }
});

test("mutation result requires explicit tabRef and snapshotPath", () => {
  assert.throws(
    () => assertActionResult({ ok: true, action: "click" }),
    /snapshotPath/
  );
  assert.throws(
    () =>
      assertActionResult({
        ...captureBase,
        action: "drag" as never,
      }),
    /action/
  );
  assert.doesNotThrow(() =>
    assertActionResult({
      ...captureBase,
      action: "click",
    })
  );
});
