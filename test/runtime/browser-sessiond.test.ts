import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import { assertSessionMetadata, type SessionMetadata } from "../../runtime/session-metadata.js";
import { BrowserSessionDaemon, type BrowserSessionDaemonOptions } from "../../runtime/browser-sessiond.js";
import { sendSessionSocketRequest } from "../../runtime/socket-client.js";

test("browser-sessiond prefers explicit MCP args over browserUrl and discovery", async () => {
  const harness = await createDaemonHarness({
    env: {
      SASIKI_BROWSER_MCP_COMMAND: "node",
      SASIKI_BROWSER_MCP_ARGS: "/tmp/devtools.js --browserUrl http://127.0.0.1:9555",
      SASIKI_BROWSER_URL: "http://127.0.0.1:9222",
    },
    runningChromeCommands: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9333",
    ],
  });

  try {
    await harness.daemon.start();
    const metadata = await harness.readMetadata();

    assert.equal(metadata.connectionMode, "browserUrl");
    assert.equal(metadata.browserUrl, "http://127.0.0.1:9555");
    assert.deepEqual(harness.launches, [
      {
        command: "node",
        args: ["/tmp/devtools.js", "--browserUrl", "http://127.0.0.1:9555"],
      },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("browser-sessiond prefers an explicit browser URL over auto-discovery", async () => {
  const harness = await createDaemonHarness({
    env: {
      SASIKI_BROWSER_URL: "http://127.0.0.1:9555",
    },
    runningChromeCommands: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9333",
    ],
  });

  try {
    await harness.daemon.start();
    const metadata = await harness.readMetadata();

    assert.equal(metadata.connectionMode, "browserUrl");
    assert.equal(metadata.browserUrl, "http://127.0.0.1:9555");
    assert.deepEqual(harness.launches, [
      {
        command: "npx",
        args: ["chrome-devtools-mcp@latest", "--browserUrl", "http://127.0.0.1:9555"],
      },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("browser-sessiond auto-detects a running remote-debugging Chrome before autoConnect fallback", async () => {
  const harness = await createDaemonHarness({
    runningChromeCommands: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-address=0.0.0.0 --remote-debugging-port=9333",
    ],
  });

  try {
    await harness.daemon.start();
    const metadata = await harness.readMetadata();

    assert.equal(metadata.connectionMode, "browserUrl");
    assert.equal(metadata.browserUrl, "http://0.0.0.0:9333");
    assert.deepEqual(harness.launches, [
      {
        command: "npx",
        args: ["chrome-devtools-mcp@latest", "--browserUrl", "http://0.0.0.0:9333"],
      },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("browser-sessiond falls back to autoConnect when no explicit or discovered browser URL exists", async () => {
  const harness = await createDaemonHarness();

  try {
    await harness.daemon.start();
    const metadata = await harness.readMetadata();

    assert.equal(metadata.connectionMode, "autoConnect");
    assert.equal(metadata.browserUrl, null);
    assert.deepEqual(harness.launches, [
      {
        command: "npx",
        args: ["chrome-devtools-mcp@latest", "--autoConnect"],
      },
    ]);
  } finally {
    await harness.cleanup();
  }
});

test("browser-sessiond writes metadata, serves health, and refreshes lastSeenAt", async () => {
  const harness = await createDaemonHarness();

  try {
    await harness.daemon.start();
    const initialMetadata = await harness.readMetadata();
    const health = await harness.daemon.handleRequest("health", {});
    const updatedMetadata = await harness.readMetadata();
    assertSessionMetadata(health);

    assert.equal(health.pid, process.pid);
    assert.equal(health.socketPath, harness.socketPath);
    assert.equal(health.runtimeVersion, "0.1.0");
    assert.equal(initialMetadata.pid, process.pid);
    assert.equal(initialMetadata.socketPath, harness.socketPath);
    assert.ok(Date.parse(updatedMetadata.lastSeenAt) >= Date.parse(initialMetadata.lastSeenAt));
  } finally {
    await harness.cleanup();
  }
});

test("browser-sessiond recreates stale socket state before listening again", async () => {
  const harness = await createDaemonHarness();

  try {
    await mkdir(path.dirname(harness.socketPath), { recursive: true });
    await writeFile(harness.socketPath, "stale", "utf8");

    await harness.daemon.start();

    const socketStat = await stat(harness.socketPath);
    assert.equal(socketStat.isSocket(), true);
    assert.equal(net.isIP(harness.socketPath), 0);
  } finally {
    await harness.cleanup();
  }
});

test("browser-sessiond shortens socket paths when a custom session root exceeds unix socket limits", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-long-root-"));
  const sessionRoot = path.join(root, "nested", "runtime", "segment".repeat(8), "session");
  let daemon: BrowserSessionDaemon | null = null;

  try {
    daemon = new BrowserSessionDaemon({
      env: {},
      sessionRoot,
      runtimeVersion: "0.1.0",
      createMcpBridge: async () => ({
        close: async () => {},
        listPages: async () => "## Pages\n1: https://example.com [selected]",
        newPage: async () => "## Pages\n1: chrome://newtab/ [selected]",
        captureSnapshot: async () => "## Snapshot\nuid=1_0 RootWebArea \"Example\"",
        callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
      }),
    } satisfies BrowserSessionDaemonOptions);

    const metadata = await daemon.start();
    const directSocketPath = path.join(sessionRoot, "browser-sessiond.sock");

    assert.equal(Buffer.byteLength(directSocketPath, "utf8") > 100, true);
    assert.equal(metadata.socketPath === directSocketPath, false);
    assert.equal(metadata.socketPath.endsWith(".sock"), true);
    assert.equal(Buffer.byteLength(metadata.socketPath, "utf8") <= 100, true);

    const health = await daemon.handleRequest("health", {});
    assert.equal((health as SessionMetadata).socketPath, metadata.socketPath);
  } finally {
    if (daemon) {
      await daemon.stop().catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond discards stale metadata that points to a dead pid and missing socket", async () => {
  const harness = await createDaemonHarness();

  try {
    await mkdir(path.dirname(harness.metadataPath), { recursive: true });
    await writeFile(
      harness.metadataPath,
      `${JSON.stringify({
        pid: 999999,
        socketPath: harness.socketPath,
        browserUrl: null,
        connectionMode: "autoConnect",
        startedAt: "2026-03-30T00:00:00.000Z",
        lastSeenAt: "2026-03-30T00:00:00.000Z",
        runtimeVersion: "0.0.0-stale",
      })}\n`,
      "utf8",
    );

    await harness.daemon.start();
    const metadata = await harness.readMetadata();

    assert.equal(metadata.pid, process.pid);
    assert.equal(metadata.runtimeVersion, "0.1.0");
    assert.equal(metadata.socketPath, harness.socketPath);
  } finally {
    await harness.cleanup();
  }
});

test("browser-sessiond shuts down cleanly and removes metadata artifacts", async () => {
  const harness = await createDaemonHarness();

  try {
    await harness.daemon.start();
    await harness.daemon.handleRequest("shutdown", {});

    await waitFor(async () => {
      await assert.rejects(() => readFile(harness.metadataPath, "utf8"));
      await assert.rejects(() => readFile(harness.socketPath, "utf8"));
    });
  } finally {
    await harness.cleanup();
  }
});

test("browser-sessiond shutdown over the session socket returns before teardown completes", async () => {
  const harness = await createDaemonHarness();

  try {
    await harness.daemon.start();

    const result = await sendSessionSocketRequest(harness.socketPath, {
      requestId: "req_shutdown",
      method: "shutdown",
      params: {},
    });

    assert.deepEqual(result, { ok: true });

    await waitFor(async () => {
      await assert.rejects(() => readFile(harness.metadataPath, "utf8"));
      await assert.rejects(() => readFile(harness.socketPath, "utf8"));
    });
  } finally {
    await harness.cleanup();
  }
});

interface DaemonHarness {
  daemon: BrowserSessionDaemon;
  launches: Array<{ command: string; args: string[] }>;
  metadataPath: string;
  socketPath: string;
  readMetadata(): Promise<SessionMetadata>;
  cleanup(): Promise<void>;
}

async function createDaemonHarness(options?: {
  env?: Record<string, string | undefined>;
  runningChromeCommands?: string[];
}): Promise<DaemonHarness> {
  const root = await mkdtemp(path.join("/tmp", "browser-sessiond-"));
  const sessionRoot = path.join(root, "session");
  const metadataPath = path.join(sessionRoot, "session.json");
  const socketPath = path.join(sessionRoot, "browser-sessiond.sock");
  const launches: Array<{ command: string; args: string[] }> = [];
  const daemon = new BrowserSessionDaemon({
    env: options?.env ?? {},
    sessionRoot,
    runtimeVersion: "0.1.0",
    runningChromeCommands: options?.runningChromeCommands ?? [],
    createMcpBridge: async ({ launchOptions }) => {
      launches.push({
        command: launchOptions.command,
        args: [...launchOptions.args],
      });
      return {
        close: async () => {},
        listPages: async () => "## Pages\n1: https://example.com [selected]",
        newPage: async () => "## Pages\n1: chrome://newtab/ [selected]",
        captureSnapshot: async () => "## Snapshot\nuid=1_0 RootWebArea \"Example\"",
        callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
      };
    },
  } satisfies BrowserSessionDaemonOptions);

  return {
    daemon,
    launches,
    metadataPath,
    socketPath,
    readMetadata: async () => JSON.parse(await readFile(metadataPath, "utf8")) as SessionMetadata,
    cleanup: async () => {
      await daemon.stop().catch(() => {});
      await unlink(socketPath).catch(() => {});
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function waitFor(
  fn: () => Promise<void>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("timed out waiting for browser-sessiond cleanup");
}
