import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertSessionMetadata } from "../../scripts/session-metadata.mjs";
import { requestJson, startBrowserSessionDaemon } from "../../scripts/http-client.mjs";

test("browser-sessiond publishes HTTP metadata and health without socket fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
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
