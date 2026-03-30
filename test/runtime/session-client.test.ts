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
} from "../../runtime/session-rpc-types.js";
import {
  assertSessionMetadata,
  SESSION_METADATA_KEYS,
} from "../../runtime/session-metadata.js";
import { BrowserSessionDaemon, type BrowserSessionDaemonOptions } from "../../runtime/browser-sessiond.js";
import { sendSessionSocketRequest } from "../../runtime/socket-client.js";
import { ensureSessionDaemon, sendSessionRpcRequest, type SessionClientOptions } from "../../runtime/session-client.js";

const sessionResult = {
  ok: true as const,
  tabRef: "tab_demo",
  snapshotRef: "snapshot_demo",
  snapshotPath: "/tmp/snapshot.md",
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
  socketPath: "/tmp/browser-sessiond.sock",
  browserUrl: "http://127.0.0.1:9222",
  connectionMode: "autoConnect" as const,
  startedAt: "2026-03-30T12:00:00.000Z",
  lastSeenAt: "2026-03-30T12:01:00.000Z",
  runtimeVersion: "0.1.0",
};

const navigateRequest = {
  requestId: "req_1",
  method: "navigate" as const,
  params: {
    tabRef: "tab_demo",
    url: "https://example.com/dashboard",
  },
};

const captureRequest = {
  requestId: "req_2",
  method: "capture" as const,
  params: {
    tabRef: "tab_demo",
  },
};

const captureByIndexRequest = {
  requestId: "req_2b",
  method: "capture" as const,
  params: {
    tabIndex: 2,
  },
};

const captureEmptyRequest = {
  requestId: "req_2c",
  method: "capture" as const,
  params: {},
};

const querySnapshotRequest = {
  requestId: "req_3",
  method: "querySnapshot" as const,
  params: {
    snapshotRef: "snapshot_demo",
    mode: "auto" as const,
  },
};

const recordKnowledgeRequest = {
  requestId: "req_4",
  method: "recordKnowledge" as const,
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

test("session rpc contract freezes the daemon method names and metadata keys", () => {
  assert.deepEqual(SESSION_RPC_METHODS, [
    "health",
    "capture",
    "navigate",
    "click",
    "type",
    "press",
    "selectTab",
    "querySnapshot",
    "readKnowledge",
    "recordKnowledge",
    "shutdown",
  ]);

  assert.deepEqual(SESSION_RPC_REQUEST_FIELDS, {
    health: [],
    capture: ["tabRef", "tabIndex"],
    navigate: ["tabRef", "url"],
    click: ["tabRef", "uid"],
    type: ["tabRef", "uid", "text"],
    press: ["tabRef", "key"],
    selectTab: ["tabRef", "pageId"],
    querySnapshot: ["tabRef", "snapshotRef", "snapshotPath", "mode", "query", "uid", "includeSnapshot"],
    readKnowledge: ["tabRef", "snapshotRef", "snapshotPath", "knowledgeRef", "page"],
    recordKnowledge: ["tabRef", "snapshotRef", "snapshotPath", "page", "guide", "keywords", "rationale", "knowledgeRef"],
    shutdown: [],
  });

  assert.deepEqual(SESSION_METADATA_KEYS, [
    "pid",
    "socketPath",
    "browserUrl",
    "connectionMode",
    "startedAt",
    "lastSeenAt",
    "runtimeVersion",
  ]);
});

test("session rpc requests and results keep the runtime ref contract explicit", () => {
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
          tabIndex: 1.5,
        },
      }),
    /tabIndex/,
  );

  assert.doesNotThrow(() => assertSessionRpcRequest(querySnapshotRequest));
  assert.doesNotThrow(() => assertSessionRpcRequest(recordKnowledgeRequest));
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
        snapshotPath: "",
      }),
    /snapshotPath/,
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
        socketPath: "",
      }),
    /socketPath/,
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

test("session client starts the daemon once and follow-up requests reuse the same session metadata", async () => {
  const harness = await createSessionClientHarness();

  try {
    const first = await ensureSessionDaemon(harness.options);
    const second = await sendSessionSocketRequest(first.socketPath, {
      requestId: "req_followup_health",
      method: "health",
      params: {},
    });
    assertSessionMetadata(second);

    assert.equal(harness.launchCount(), 1);
    assert.equal(first.pid, second.pid);
    assert.equal(first.socketPath, second.socketPath);
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
        socketPath: path.join(harness.sessionRoot, "browser-sessiond.sock"),
        browserUrl: null,
        connectionMode: "autoConnect",
        startedAt: "2026-03-30T00:00:00.000Z",
        lastSeenAt: "2026-03-30T00:00:00.000Z",
        runtimeVersion: "0.0.0-stale",
      })}\n`,
      "utf8",
    );

    const metadata = await ensureSessionDaemon(harness.options);

    assert.equal(harness.launchCount(), 1);
    assert.equal(metadata.runtimeVersion, "0.1.0");
    assert.equal(metadata.pid > 0, true);
  } finally {
    await harness.cleanup();
  }
});

test("session client exports a narrow method-plus-params request API for other lanes", async () => {
  const harness = await createSessionClientHarness();

  try {
    const health = await sendSessionRpcRequest("health", {}, harness.options);

    assert.equal(health.runtimeVersion, "0.1.0");
    assert.equal(typeof health.socketPath, "string");
    assert.equal(health.socketPath.endsWith("browser-sessiond.sock"), true);
  } finally {
    await harness.cleanup();
  }
});

async function createSessionClientHarness(): Promise<{
  options: SessionClientOptions;
  sessionRoot: string;
  launchCount(): number;
  cleanup(): Promise<void>;
}> {
  const root = await mkdtemp(path.join("/tmp", "browser-session-client-"));
  const sessionRoot = path.join(root, "session");
  await mkdir(sessionRoot, { recursive: true });
  let launches = 0;
  let daemon: BrowserSessionDaemon | null = null;

  const options: SessionClientOptions = {
    env: {},
    sessionRoot,
    startupTimeoutMs: 2_000,
    launchDaemon: async (daemonOptions) => {
      launches += 1;
      daemon = new BrowserSessionDaemon({
        ...daemonOptions,
        createMcpBridge: async () => ({
          close: async () => {},
          listPages: async () => "## Pages\n1: https://example.com [selected]",
          captureSnapshot: async () => "## Snapshot\nuid=1_0 RootWebArea \"Example\"",
          callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
        }),
      } satisfies BrowserSessionDaemonOptions);
      await daemon.start();
    },
  };

  return {
    options,
    sessionRoot,
    launchCount: () => launches,
    cleanup: async () => {
      if (daemon) {
        await daemon.stop().catch(() => {});
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}
