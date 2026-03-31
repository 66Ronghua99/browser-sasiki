import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  formatCliError,
  isDirectCliInvocation,
  readCliArgs,
  sendSessionRpcRequest,
  setSessionRpcRequestSenderForTesting,
} from "../../lib/cli.js";
import {
  optionalCliStringArgWithAliases,
  readCliStringArgWithAliases,
} from "../../lib/browser-action.js";

test("readCliArgs parses key-value pairs and bare flags", () => {
  assert.deepEqual(readCliArgs(["--tab-ref", "main", "--submit"]), {
    "tab-ref": "main",
    submit: true,
  });
});

test("shared CLI alias readers normalize canonical and legacy keys in one place", () => {
  assert.equal(
    readCliStringArgWithAliases(
      { "page-id": "7", "tab-index": "2", index: "1" },
      "page-id",
      "tab-index",
      "index",
    ),
    "7",
  );

  assert.equal(
    optionalCliStringArgWithAliases(
      { index: "3" },
      "pageId",
      "page-id",
      "tab-index",
      "index",
    ),
    "3",
  );

  assert.throws(
    () =>
      optionalCliStringArgWithAliases(
        { "tab-index": true },
        "pageId",
        "page-id",
        "tab-index",
        "index",
      ),
    /pageId.*--tab-index/i,
  );
});

test("isDirectCliInvocation treats symlinked argv1 as the same entry file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-cli-"));
  const realDir = path.join(root, "real");
  const linkDir = path.join(root, "link");
  const realFile = path.join(realDir, "capture.js");
  const linkedFile = path.join(linkDir, "capture.js");

  await mkdir(realDir, { recursive: true });
  await writeFile(realFile, "export {};\n", "utf8");
  await symlink(realDir, linkDir);

  assert.equal(isDirectCliInvocation(pathToFileURL(realFile).href, linkedFile), true);
});

test("isDirectCliInvocation returns false when argv1 targets a different file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-cli-"));
  const one = path.join(root, "one.js");
  const two = path.join(root, "two.js");

  await writeFile(one, "export {};\n", "utf8");
  await writeFile(two, "export {};\n", "utf8");

  assert.equal(isDirectCliInvocation(pathToFileURL(one).href, two), false);
  assert.equal(isDirectCliInvocation(pathToFileURL(one).href, undefined), false);
});

test("formatCliError prefers readable messages over stack traces", () => {
  const error = new Error("human-friendly failure");
  error.stack = "Error: human-friendly failure\n    at noisy-stack";

  assert.equal(formatCliError(error), "human-friendly failure");
  assert.equal(formatCliError("plain failure"), "plain failure");
});

test("sendSessionRpcRequest forwards one frozen RPC request envelope to the injected sender", async () => {
  const requests: Array<{ requestId: string; method: string; params: unknown }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push(request);
    return {
      ok: true as const,
      tabRef: "tab_demo",
      page: {
        origin: "https://example.com",
        normalizedPath: "/dashboard",
        title: "Dashboard",
      },
      knowledgeHits: [],
      summary: "ready",
      snapshotPath: "/tmp/snapshot.md",
      snapshotRef: "snapshot_demo",
    };
  });

  const result = await sendSessionRpcRequest("capture", {
    tabRef: "tab_demo",
    pageId: 2,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "capture");
  assert.ok(typeof requests[0]?.requestId === "string" && String(requests[0]?.requestId).length > 0);
  assert.deepEqual(requests[0]?.params, {
    tabRef: "tab_demo",
    pageId: 2,
  });
  assert.equal((result as { snapshotRef?: string }).snapshotRef, "snapshot_demo");
});
