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

function createStubBrowserBridge() {
  return {
    listPages: async () => "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
    newPage: async () => "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
    captureSnapshot: async () => "uid=root RootWebArea \"Workspace\" url=\"chrome://newtab/\"",
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
  };
}

function createDisconnectableBrowserBridge() {
  let disconnectListener = null;

  return {
    onDisconnect(listener) {
      disconnectListener = listener;
    },
    disconnect() {
      disconnectListener?.(new Error("CDP disconnected"));
    },
    listPages: async () => "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
    newPage: async () => "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
    captureSnapshot: async () => "uid=root RootWebArea \"Workspace\" url=\"chrome://newtab/\"",
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    close: async () => {},
  };
}

function createDirectOpenWorkspaceBridge() {
  return {
    listPages: async () => "## Pages\n- 1 [Workspace](chrome://newtab/)",
    newPage: async () => "## Pages\n- 1 [Workspace](chrome://newtab/)",
    listLivePageInventory: async () => [
      {
        pageId: 1,
        targetId: "target-workspace",
        openerId: "",
        url: "chrome://newtab/",
        title: "Workspace",
      },
    ],
    openWorkspaceTab: async () => ({
      pageId: 1,
      pageListText: "## Pages\n- 1 [Workspace](chrome://newtab/)",
    }),
    captureSnapshot: async () => "uid=root RootWebArea \"Workspace\" url=\"chrome://newtab/\"",
    captureSnapshotForPage: async () => "uid=root RootWebArea \"Workspace\" url=\"chrome://newtab/\"",
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    close: async () => {},
  };
}

function createBlockingBrowserBridge() {
  const events = [];
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let startFirstCall;
  const started = new Promise((resolve) => {
    startFirstCall = resolve;
  });
  let firstClickInProgress = false;

  return {
    events,
    async waitForFirstToolCall() {
      return started;
    },
    releaseFirstToolCall() {
      releaseGate();
    },
    listPages: async () => "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
    newPage: async () => "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
    openWorkspaceTab: async () => ({
      pageId: 1,
      pageListText: "## Pages\n- 1 (current) [Workspace](chrome://newtab/)",
    }),
    captureSnapshot: async () => "uid=root RootWebArea \"Workspace\" url=\"chrome://newtab/\"",
    captureSnapshotForPage: async () => "uid=root RootWebArea \"Workspace\" url=\"chrome://newtab/\"",
    listLivePageInventory: async () => [
      {
        pageId: 1,
        targetId: "target-workspace",
        openerId: "",
        url: "chrome://newtab/",
        title: "Workspace",
      },
    ],
    async callTool(name) {
      if (name === "click" && !firstClickInProgress) {
        firstClickInProgress = true;
        events.push("click:start");
        startFirstCall?.();
        await gate;
        events.push("click:end");
        return { content: [{ type: "text", text: "ok" }] };
      }

      return { content: [{ type: "text", text: `${name} complete` }] };
    },
    close: async () => {},
  };
}

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
    createBrowserBridge: async () => createStubBrowserBridge(),
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
    createBrowserBridge: async () => createStubBrowserBridge(),
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
    createBrowserBridge: async () => createStubBrowserBridge(),
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

test("browser-sessiond stops serving health after the browser bridge disconnects", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const bridge = createDisconnectableBrowserBridge();
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    createBrowserBridge: async () => bridge,
  });

  try {
    const health = await requestJson("GET", `${metadata.baseUrl}/health`);
    assert.equal(health.ok, true);

    bridge.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 20));

    await assert.rejects(() => requestJson("GET", `${metadata.baseUrl}/health`));
  } finally {
    await daemon.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond opens a workspace from a bridge-provided pageId even when new_page output lacks an active marker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    createBrowserBridge: async () => createDirectOpenWorkspaceBridge(),
  });

  try {
    const workspace = await requestJson("POST", `${metadata.baseUrl}/workspaces`, {});

    assert.equal(workspace.ok, true);
    assert.equal(typeof workspace.workspaceRef, "string");
    assert.equal(Array.isArray(workspace.tabs), true);
    assert.equal(workspace.tabs[0]?.active, true);
    assert.equal(workspace.tabs[0]?.title, "Workspace");
  } finally {
    await daemon.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond serializes overlapping workspace-scoped daemon requests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  let clickInProgress = false;
  let clickGateResolve;
  const clickGate = new Promise((resolve) => {
    clickGateResolve = resolve;
  });
  let clickStarted;
  const waitForClickStart = new Promise((resolve) => {
    clickStarted = resolve;
  });

  const daemon = new BrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    createBrowserBridge: async () => createStubBrowserBridge(),
  });
  daemon.touch = async () => {};

  const requestCalls = [];

  daemon.browserAction = async (action) => {
    requestCalls.push(`${action}:start`);
    if (action === "click") {
      clickStarted?.();
      clickInProgress = true;
      await clickGate;
      clickInProgress = false;
    }
    requestCalls.push(`${action}:end`);

    return {
      ok: true,
      workspaceRef: "workspace-det",
    };
  };

  daemon.queryWorkspace = async () => {
    if (clickInProgress) {
      requestCalls.push("queryWorkspace:interleaving");
    }
    requestCalls.push("queryWorkspace:start");
    requestCalls.push("queryWorkspace:end");

    return {
      ok: true,
      workspaceRef: "workspace-det",
      mode: "full",
    };
  };

  try {
    await daemon.start();

    const clickRequest = daemon.handleHttpRequest("click", {
      workspaceRef: "workspace-det",
      uid: "submit_button",
    });

    await waitForClickStart;

    const queryRequest = daemon.handleHttpRequest("queryWorkspace", {
      workspaceRef: "workspace-det",
      mode: "full",
    });

    await Promise.resolve();

    clickGateResolve();

    const [clickResult, queryResult] = await Promise.all([clickRequest, queryRequest]);

    assert.equal(clickResult.ok, true);
    assert.equal(queryResult.ok, true);
    assert.equal(clickResult.workspaceRef, "workspace-det");
    assert.equal(queryResult.workspaceRef, "workspace-det");
    assert.equal(requestCalls.includes("queryWorkspace:interleaving"), false);
    assert.deepEqual(requestCalls, [
      "click:start",
      "click:end",
      "queryWorkspace:start",
      "queryWorkspace:end",
    ]);
  } finally {
    await daemon.stop().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
