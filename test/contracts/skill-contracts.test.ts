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
      index: 0,
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
  assert.throws(
    () =>
      assertCaptureResult({
        ...captureBase,
        tabs: [
          {
            title: "Dashboard",
            url: "https://example.com/dashboard",
            active: true,
          },
        ],
      }),
    /index/
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

test("mutation result requires explicit base fields and rejects invalid actions", () => {
  assert.throws(
    () => assertActionResult({ ok: true, action: "click" }),
    /tabRef/
  );
  assert.throws(
    () =>
      assertActionResult({
        ok: true as const,
        tabRef: "tab_demo",
        page: captureBase.page,
        snapshotPath: "/tmp/snapshot.md",
        knowledgeHits: [],
        summary: "ready",
        action: "drag" as never,
      }),
    /action/
  );
  assert.doesNotThrow(() =>
    assertActionResult({
      ok: true as const,
      tabRef: "tab_demo",
      page: captureBase.page,
      snapshotPath: "/tmp/snapshot.md",
      knowledgeHits: [],
      summary: "ready",
      action: "click",
    })
  );
});
