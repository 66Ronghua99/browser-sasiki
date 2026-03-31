import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertWorkspaceActionResult,
} from "../../scripts/types.mjs";
import { defaultRuntimeRoots } from "../../scripts/paths.mjs";

const workspaceActionBase = {
  ok: true,
  workspaceRef: "workspace_demo",
  page: {
    origin: "https://example.com",
    normalizedPath: "/dashboard",
    title: "Dashboard",
  },
  knowledgeHits: [],
  summary: "ready",
};

test("workspace action result requires workspaceRef and page identity", () => {
  assert.doesNotThrow(() =>
    assertWorkspaceActionResult({
      ...workspaceActionBase,
      action: "click",
    }),
  );

  assert.doesNotThrow(() =>
    assertWorkspaceActionResult({
      ...workspaceActionBase,
      workspaceTabRef: "workspace_tab_demo",
      action: "click",
    }),
  );

  assert.throws(() => assertWorkspaceActionResult({ ok: true }), /workspaceRef/);
  assert.throws(
    () =>
      assertWorkspaceActionResult({
        ...workspaceActionBase,
        action: "click",
        workspaceRef: undefined,
      }),
    /workspaceRef/
  );
  assert.throws(
    () =>
      assertWorkspaceActionResult({
        ...workspaceActionBase,
        action: "drag",
      }),
    /action/
  );
  assert.throws(
    () =>
      assertWorkspaceActionResult({
        ...workspaceActionBase,
        action: "click",
        workspaceTabRef: "",
      }),
    /workspaceTabRef/
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
    "../../scripts/mcp-browser-client.mjs",
    "../../scripts/session-client-cli.mjs",
    "../../scripts/session-client.mjs",
    "../../scripts/session-contract.mjs",
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

test("workspace action validator rejects invalid actions", () => {
  assert.throws(
    () =>
      assertWorkspaceActionResult({
        ...workspaceActionBase,
        action: "drag",
      }),
    /action/
  );
  assert.throws(
    () =>
      assertWorkspaceActionResult({
        ok: true,
        workspaceRef: "workspace_demo",
        page: workspaceActionBase.page,
        knowledgeHits: [],
        summary: "ready",
        action: "click",
        workspaceTabRef: 123,
      }),
    /workspaceTabRef/
  );
  assert.doesNotThrow(() =>
    assertWorkspaceActionResult({
      ok: true,
      workspaceRef: "workspace_demo",
      page: workspaceActionBase.page,
      knowledgeHits: [],
      summary: "ready",
      action: "click",
    })
  );
  assert.doesNotThrow(() =>
    assertWorkspaceActionResult({
      ok: true,
      workspaceRef: "workspace_demo",
      page: workspaceActionBase.page,
      knowledgeHits: [],
      summary: "ready",
      action: "select-tab",
      workspaceTabRef: "workspace_tab_demo",
    })
  );
  assert.throws(
    () =>
      assertWorkspaceActionResult({
        ok: true,
        workspaceRef: "workspace_demo",
        page: workspaceActionBase.page,
        knowledgeHits: [],
        summary: "ready",
        action: "select-tab",
        workspaceTabRef: 123,
      }),
    /workspaceTabRef/
  );
});

test("front-door docs teach the workspace-first direct-DevTools surface and exclude legacy public terms", async () => {
  const skillPath = fileURLToPath(new URL("../../SKILL.md", import.meta.url));
  const readmePath = fileURLToPath(new URL("../../README.md", import.meta.url));
  const [skillContent, readmeContent] = await Promise.all([
    readFile(skillPath, "utf8"),
    readFile(readmePath, "utf8"),
  ]);

  for (const content of [skillContent, readmeContent]) {
    assert.match(content, /browser-sasiki|Browser Sasiki/i);
    assert.match(content, /workspace-first/i);
    assert.match(content, /direct DevTools/i);
    assert.match(content, /ensure-browser-session\.mjs/i);
    assert.match(content, /GET \/health/i);
    assert.match(content, /POST \/workspaces/i);
    assert.match(content, /GET \/tabs/i);
    assert.match(content, /POST \/select-tab/i);
    assert.match(content, /POST \/navigate/i);
    assert.match(content, /POST \/query/i);
    assert.match(content, /POST \/record-knowledge/i);
    assert.match(content, /workspaceRef/i);
    assert.match(content, /workspaceTabRef/i);
    assert.match(content, /`uid` is the only/i);
    assert.match(content, /`search`.*`full`|`full`.*`search`/i);
    assert.match(content, /knowledgeHits/i);
    assert.doesNotMatch(content, /\/capture/i);
    assert.doesNotMatch(content, /\/query-snapshot/i);
    assert.doesNotMatch(content, /`tabRef`/i);
    assert.doesNotMatch(content, /`snapshotRef`/i);
    assert.doesNotMatch(content, /chrome-devtools-mcp/i);
    assert.doesNotMatch(content, /read-knowledge/i);
    assert.doesNotMatch(content, /session-client-cli\.mjs/i);
    assert.doesNotMatch(content, /sendSessionRpcRequest/i);
    assert.doesNotMatch(content, /node\s+(?:skill\/)?scripts\/browser-sessiond\.mjs/i);
    assert.match(content, /curl\s+-s\s+-X\s+POST/i);
  }

  assert.match(skillContent, /^name:\s*browser-sasiki$/m);
  assert.doesNotMatch(skillContent, /^name:\s*browser-skill$/m);
  assert.match(readmeContent, /cd skill/i);
  assert.match(readmeContent, /node scripts\/ensure-browser-session\.mjs/i);
  assert.doesNotMatch(readmeContent, /node skill\/scripts\/ensure-browser-session\.mjs/i);
  assert.match(readmeContent, /npm test/i);
  assert.doesNotMatch(readmeContent, /npm --prefix skill test/i);
  assert.match(readmeContent, /publish mirror|source of truth|single source of truth/i);
});
