import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertSessionCaptureResult,
  assertSessionRpcResult,
  assertSessionRpcRequest,
  SESSION_RPC_REQUEST_FIELDS,
  SESSION_RPC_METHODS,
} from "../../scripts/session-contract.mjs";
import {
  assertSessionMetadata,
  SESSION_METADATA_KEYS,
} from "../../scripts/session-metadata.mjs";
import { ensureSessionDaemon, sendSessionRpcRequest } from "../../scripts/session-client.mjs";
import { startBrowserSessionDaemon } from "../../scripts/http-client.mjs";

const sessionResult = {
  ok: true,
  tabRef: "tab_demo",
  snapshotRef: "snapshot_demo",
  page: {
    origin: "https://example.com",
    normalizedPath: "/dashboard",
    title: "Dashboard",
  },
  knowledgeHits: [],
  summary: "ready",
};

const captureResult = {
  ...sessionResult,
  tabs: [
    {
      index: 1,
      title: "Dashboard",
      url: "https://example.com/dashboard",
      active: true,
    },
  ],
};

const sessionMetadata = {
  pid: 12345,
  port: 9222,
  baseUrl: "http://127.0.0.1:9222",
  browserUrl: "http://127.0.0.1:9222",
  connectionMode: "http",
  startedAt: "2026-03-30T12:00:00.000Z",
  lastSeenAt: "2026-03-30T12:01:00.000Z",
  runtimeVersion: "0.1.0",
};

const navigateRequest = {
  requestId: "req_1",
  method: "navigate",
  params: {
    tabRef: "tab_demo",
    url: "https://example.com/dashboard",
  },
};

const captureRequest = {
  requestId: "req_2",
  method: "capture",
  params: {
    tabRef: "tab_demo",
  },
};

const captureByIndexRequest = {
  requestId: "req_2b",
  method: "capture",
  params: {
    pageId: 2,
  },
};

const captureEmptyRequest = {
  requestId: "req_2c",
  method: "capture",
  params: {},
};

const querySnapshotRequest = {
  requestId: "req_3",
  method: "querySnapshot",
  params: {
    snapshotRef: "snapshot_demo",
    mode: "search",
    uid: "1_1",
  },
};

const recordKnowledgeRequest = {
  requestId: "req_4",
  method: "recordKnowledge",
  params: {
    page: {
      origin: "https://example.com",
      normalizedPath: "/dashboard",
      title: "Dashboard",
    },
    guide: "use dashboard",
    keywords: ["dashboard"],
  },
};

const recordKnowledgeByTabRefRequest = {
  requestId: "req_4b",
  method: "recordKnowledge",
  params: {
    tabRef: "tab_demo",
    guide: "use dashboard",
    keywords: ["dashboard"],
  },
};

const recordKnowledgeBySnapshotRefRequest = {
  requestId: "req_4c",
  method: "recordKnowledge",
  params: {
    snapshotRef: "snapshot_demo",
    guide: "use dashboard",
    keywords: ["dashboard"],
  },
};

test("session rpc contract freezes the HTTP daemon method names and metadata keys", () => {
  assert.deepEqual(SESSION_RPC_METHODS, [
    "health",
    "capture",
    "navigate",
    "click",
    "type",
    "press",
    "selectTab",
    "querySnapshot",
    "recordKnowledge",
    "shutdown",
  ]);

  assert.deepEqual(SESSION_RPC_REQUEST_FIELDS, {
    health: [],
    capture: ["tabRef", "pageId"],
    navigate: ["tabRef", "url"],
    click: ["tabRef", "uid"],
    type: ["tabRef", "uid", "text", "submit", "slowly"],
    press: ["tabRef", "key"],
    selectTab: ["tabRef", "pageId"],
    querySnapshot: ["tabRef", "snapshotRef", "mode", "query", "role", "uid"],
    recordKnowledge: ["tabRef", "snapshotRef", "page", "guide", "keywords", "rationale", "knowledgeRef"],
    shutdown: [],
  });

  assert.deepEqual(SESSION_METADATA_KEYS, [
    "pid",
    "port",
    "baseUrl",
    "browserUrl",
    "connectionMode",
    "startedAt",
    "lastSeenAt",
    "runtimeVersion",
  ]);
});

test("session rpc requests and results keep the HTTP contract explicit", () => {
  assert.doesNotThrow(() => assertSessionRpcRequest(navigateRequest));
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...navigateRequest,
        params: {
          tabRef: "tab_demo",
        },
      }),
    /url/,
  );

  assert.doesNotThrow(() => assertSessionRpcRequest(captureRequest));
  assert.doesNotThrow(() => assertSessionRpcRequest(captureByIndexRequest));
  assert.doesNotThrow(() => assertSessionRpcRequest(captureEmptyRequest));
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...captureRequest,
        params: {
          tabRef: "",
        },
      }),
    /tabRef/,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...captureByIndexRequest,
        params: {
          pageId: 1.5,
        },
      }),
    /pageId/,
  );

  assert.throws(
    () =>
      assertSessionRpcRequest({
        requestId: "req_legacy",
        method: "readKnowledge",
        params: {},
      }),
    /supported session rpc method/,
  );

  assert.doesNotThrow(() => assertSessionRpcRequest(querySnapshotRequest));
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...querySnapshotRequest,
        params: {
          snapshotRef: "snapshot_demo",
          mode: "full",
          query: "Submit",
        },
      }),
    /full.*query|full.*selector/i,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...querySnapshotRequest,
        params: {
          snapshotRef: "snapshot_demo",
          mode: "search",
        },
      }),
    /search.*query|search.*role|search.*uid/i,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...querySnapshotRequest,
        params: {
          snapshotRef: "snapshot_demo",
          mode: "search",
          ref: "legacy_ref",
        },
      }),
    /unknown field ref|allowed fields/i,
  );
  assert.doesNotThrow(() => assertSessionRpcRequest(recordKnowledgeRequest));
  assert.doesNotThrow(() => assertSessionRpcRequest(recordKnowledgeByTabRefRequest));
  assert.doesNotThrow(() => assertSessionRpcRequest(recordKnowledgeBySnapshotRefRequest));
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...recordKnowledgeRequest,
        params: {
          ...recordKnowledgeRequest.params,
          keywords: [],
        },
      }),
    /keywords/,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...recordKnowledgeByTabRefRequest,
        params: {
          guide: "use dashboard",
          keywords: ["dashboard"],
        },
      }),
    /recordKnowledge.*page|recordKnowledge.*tabRef|recordKnowledge.*snapshotRef/i,
  );

  assert.doesNotThrow(() => assertSessionRpcResult(sessionResult));
  assert.doesNotThrow(() => assertSessionCaptureResult(captureResult));
  assert.throws(
    () =>
      assertSessionRpcResult({
        ...sessionResult,
        snapshotRef: "",
      }),
    /snapshotRef/,
  );
  assert.throws(
    () =>
      assertSessionRpcResult({
        ...sessionResult,
        snapshotPath: "/tmp/legacy.md",
      }),
    /snapshotPath/,
  );
  assert.throws(
    () =>
      assertSessionRpcResult({
        ...sessionResult,
        page: {
          origin: "",
          normalizedPath: "/dashboard",
          title: "Dashboard",
        },
      }),
    /page\.origin/,
  );
  assert.throws(
    () =>
      assertSessionCaptureResult({
        ...sessionResult,
      }),
    /tabs/,
  );

  assert.doesNotThrow(() => assertSessionMetadata(sessionMetadata));
  assert.throws(
    () =>
      assertSessionMetadata({
        ...sessionMetadata,
        socketPath: "/tmp/legacy.sock",
      }),
    /socketPath/,
  );
  assert.throws(
    () =>
      assertSessionMetadata({
        ...sessionMetadata,
        baseUrl: "",
      }),
    /baseUrl/,
  );
  assert.throws(
    () =>
      assertSessionMetadata({
        ...sessionMetadata,
        runtimeVersion: "",
      }),
    /runtimeVersion/,
  );
  assert.throws(
    () =>
      assertSessionMetadata({
        ...sessionMetadata,
        connectionMode: "browserUrl",
        browserUrl: null,
      }),
    /browserUrl/,
  );
});

test("session client starts the daemon once and follow-up requests reuse the same HTTP session metadata", async () => {
  const harness = await createSessionClientHarness();

  try {
    const first = await ensureSessionDaemon(harness.options);
    const second = await sendSessionRpcRequest("health", {}, harness.options);
    assertSessionMetadata(second);

    assert.equal(harness.launchCount(), 1);
    assert.equal(first.pid, second.pid);
    assert.equal(first.port, second.port);
    assert.equal(first.baseUrl, second.baseUrl);
  } finally {
    await harness.cleanup();
  }
});

test("session client ensureSessionDaemon discards stale metadata and recreates the daemon session", async () => {
  const harness = await createSessionClientHarness();

  try {
    await writeFile(
      path.join(harness.sessionRoot, "session.json"),
      `${JSON.stringify({
        pid: 999999,
        port: 9222,
        baseUrl: "http://127.0.0.1:9222",
        browserUrl: null,
        connectionMode: "http",
        startedAt: "2026-03-30T00:00:00.000Z",
        lastSeenAt: "2026-03-30T00:00:00.000Z",
        runtimeVersion: "0.0.0-stale",
      })}\n`,
      "utf8",
    );

    const metadata = await ensureSessionDaemon(harness.options);

    assert.equal(harness.launchCount(), 1);
    assert.equal(metadata.runtimeVersion, "0.1.0-test");
    assert.equal(metadata.pid > 0, true);
    assert.equal(metadata.port > 0, true);
    assert.equal(metadata.baseUrl.startsWith("http://"), true);
  } finally {
    await harness.cleanup();
  }
});

test("session client restarts a healthy daemon when the requested runtimeVersion changes", async () => {
  const harness = await createSessionClientHarness();

  try {
    const first = await ensureSessionDaemon(harness.options);
    const second = await ensureSessionDaemon({
      ...harness.options,
      runtimeVersion: "0.2.0-test",
    });

    assert.equal(first.runtimeVersion, "0.1.0-test");
    assert.equal(second.runtimeVersion, "0.2.0-test");
    assert.equal(harness.launchCount(), 2);
  } finally {
    await harness.cleanup();
  }
});

test("session client exposes a narrow HTTP request API for other lanes", async () => {
  const harness = await createSessionClientHarness();

  try {
    const health = await sendSessionRpcRequest("health", {}, harness.options);

    assert.equal(health.runtimeVersion, "0.1.0-test");
    assert.equal(typeof health.port, "number");
    assert.equal(typeof health.baseUrl, "string");
    assert.equal("snapshotPath" in health, false);
  } finally {
    await harness.cleanup();
  }
});

async function createSessionClientHarness() {
  const root = await mkdtemp(path.join("/tmp", "browser-session-client-"));
  const sessionRoot = path.join(root, "session");
  await mkdir(sessionRoot, { recursive: true });
  let launches = 0;
  let daemon = null;

  const options = {
    env: {},
    sessionRoot,
    runtimeVersion: "0.1.0-test",
    startupTimeoutMs: 2_000,
    launchDaemon: async (daemonOptions) => {
      launches += 1;
      daemon = await startBrowserSessionDaemon({
        sessionRoot: daemonOptions.sessionRoot,
        port: 0,
        runtimeVersion: daemonOptions.runtimeVersion,
      });
    },
  };

  return {
    options,
    sessionRoot,
    launchCount: () => launches,
    cleanup: async () => {
      if (daemon) {
        await daemon.daemon.stop().catch(() => {});
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
