import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertActionResult,
  assertCaptureResult,
} from "../../scripts/types.mjs";
import { defaultRuntimeRoots } from "../../scripts/paths.mjs";

const captureBase = {
  ok: true,
  tabRef: "tab_demo",
  page: {
    origin: "https://example.com",
    normalizedPath: "/dashboard",
    title: "Dashboard",
  },
  snapshotRef: "snapshot_demo",
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

test("capture result requires tabRef, snapshotRef, and page identity", () => {
  assert.doesNotThrow(() =>
    assertCaptureResult(captureBase)
  );

  assert.throws(() => assertCaptureResult({ ok: true }), /tabRef/);
  assert.throws(
    () =>
      assertCaptureResult({
        ...captureBase,
        snapshotRef: undefined,
      }),
    /snapshotRef/
  );
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

test("legacy browser-skill TypeScript and runtime front doors are deleted", () => {
  const removedPaths = [
    "../../lib/browser-action.ts",
    "../../lib/knowledge-query.ts",
    "../../lib/knowledge-store.ts",
    "../../lib/mcp-browser-client.ts",
    "../../lib/page-identity.ts",
    "../../lib/paths.ts",
    "../../lib/snapshot-parser.ts",
    "../../lib/snapshot-store.ts",
    "../../lib/tab-binding-store.ts",
    "../../lib/types.ts",
    "../../runtime/session-client.ts",
    "../../runtime/session-metadata.ts",
    "../../runtime/session-paths.ts",
    "../../runtime/session-rpc-types.ts",
    "../../server/browser-sessiond.mjs",
    "../../server/http-client.mjs",
    "../../server/http-contract.mjs",
    "../../server/http-routes.mjs",
    "../../server/session-client.mjs",
    "../../server/session-contract.mjs",
    "../../server/session-metadata.mjs",
  ];

  for (const relativePath of removedPaths) {
    const legacyPath = fileURLToPath(new URL(relativePath, import.meta.url));
    assert.equal(
      existsSync(legacyPath),
      false,
      `${relativePath} should be removed once the HTTP-only .mjs truth is in place`,
    );
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
        ok: true,
        tabRef: "tab_demo",
        page: captureBase.page,
        snapshotRef: "snapshot_demo",
        knowledgeHits: [],
        summary: "ready",
        action: "drag",
      }),
    /action/
  );
  assert.doesNotThrow(() =>
    assertActionResult({
      ok: true,
      tabRef: "tab_demo",
      page: captureBase.page,
      snapshotRef: "snapshot_demo",
      knowledgeHits: [],
      summary: "ready",
      action: "click",
    })
  );
  assert.throws(
    () =>
      assertActionResult({
        ok: true,
        tabRef: "tab_demo",
        page: captureBase.page,
        snapshotRef: "snapshot_demo",
        snapshotPath: "/tmp/legacy.md",
        knowledgeHits: [],
        summary: "ready",
        action: "click",
      }),
    /snapshotPath/
  );
});

test("SKILL front door teaches curl-based http usage, automatic knowledge hits, and no read-knowledge path", async () => {
  const skillPath = fileURLToPath(new URL("../../SKILL.md", import.meta.url));
  const content = await readFile(skillPath, "utf8");

  assert.match(content, /curl -s .*\/health/i);
  assert.match(content, /curl -s -X POST .*\/capture/i);
  assert.match(content, /node skill\/scripts\/browser-sessiond\.mjs/i);
  assert.match(content, /knowledgeHits auto-load/i);
  assert.match(content, /must successfully call `record-knowledge` before the final answer/i);
  assert.doesNotMatch(content, /read-knowledge/i);
  assert.doesNotMatch(content, /skill\/server\//i);
  assert.doesNotMatch(content, /dist\/scripts/i);
});
