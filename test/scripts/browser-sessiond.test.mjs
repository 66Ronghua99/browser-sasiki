import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isDirectRunEntry } from "../../scripts/browser-sessiond.mjs";
import { BrowserSessionDaemon } from "../../scripts/browser-sessiond.mjs";
import { assertSessionMetadata } from "../../scripts/session-metadata.mjs";
import { requestJson, startBrowserSessionDaemon } from "../../scripts/http-client.mjs";

test("browser-sessiond treats symlinked script paths as direct-run entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-entry-"));
  const realEntryPath = fileURLToPath(new URL("../../scripts/browser-sessiond.mjs", import.meta.url));
  const symlinkedEntryPath = path.join(root, "browser-sessiond.mjs");

  try {
    await symlink(realEntryPath, symlinkedEntryPath);

    assert.equal(
      isDirectRunEntry(pathToFileURL(realEntryPath).href, symlinkedEntryPath),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond defaults to fixed HTTP port 3456", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const daemon = new BrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    runtimeVersion: "test-http",
    createMcpBridge: async () => ({
      listPages: async () => "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
      newPage: async () => "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
      captureSnapshot: async () => "uid=root RootWebArea \"Workspace\" url=\"chrome://newtab/\"",
      callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    }),
  });

  try {
    assert.equal(daemon.port, 3456);
    assert.equal(daemon.host, "127.0.0.1");
  } finally {
    await daemon.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond publishes HTTP metadata and health without socket fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
  });

  try {
    assertSessionMetadata(metadata);
    assert.equal(metadata.port > 0, true);
    assert.equal(metadata.baseUrl.startsWith("http://"), true);
    assert.equal(metadata.runtimeVersion, "test-http");
    assert.equal("socketPath" in metadata, false);

    const health = await requestJson("GET", `${metadata.baseUrl}/health`);
    assertSessionMetadata(health);
    assert.equal(health.port, metadata.port);
    assert.equal(health.baseUrl, metadata.baseUrl);
    assert.equal("socketPath" in health, false);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond shutdown closes the direct-run HTTP server", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
  });

  try {
    const shutdown = await requestJson("POST", `${metadata.baseUrl}/shutdown`, {});

    assert.equal(shutdown.ok, true);
    await assert.rejects(() => requestJson("GET", `${metadata.baseUrl}/health`));
  } finally {
    await daemon.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
