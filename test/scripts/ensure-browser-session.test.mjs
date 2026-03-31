import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
  assertSessionMetadata,
  SESSION_METADATA_KEYS,
} from "../../scripts/session-metadata.mjs";
import {
  ensureBrowserSession,
  runEnsureBrowserSessionCli,
} from "../../scripts/ensure-browser-session.mjs";

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

test("ensure-browser-session keeps the session metadata contract stable", () => {
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
  assert.throws(
    () =>
      assertSessionMetadata({
        ...sessionMetadata,
        connectionMode: "autoConnect",
      }),
    /connectionMode/,
  );
});

test("ensure-browser-session reuses healthy session metadata without relaunching the daemon", async () => {
  const harness = await createEnsureBrowserSessionHarness();

  try {
    const first = await ensureBrowserSession(harness.options);
    const second = await ensureBrowserSession(harness.options);

    assertSessionMetadata(first);
    assertSessionMetadata(second);
    assert.equal(harness.launchCount(), 0);
    assert.equal(first.pid, second.pid);
    assert.equal(first.port, second.port);
    assert.equal(first.baseUrl, second.baseUrl);
  } finally {
    await harness.cleanup();
  }
});

test("ensure-browser-session tolerates slow daemon cold starts before reporting timeout", async () => {
  const root = await mkdtemp(path.join("/tmp", "browser-session-slow-startup-"));
  const sessionRoot = path.join(root, "session");
  await mkdir(sessionRoot, { recursive: true });

  let fakeNow = 0;
  let server = null;

  try {
    const result = await ensureBrowserSession({
      env: {},
      sessionRoot,
      runtimeVersion: "0.1.0-test",
      launchDaemon: async () => {},
      now: () => fakeNow,
      sleep: async (ms) => {
        fakeNow += Math.max(ms, 1_000);

        if (fakeNow < 6_000 || server) {
          return;
        }

        server = createServer((req, res) => {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          if (url.pathname === "/health") {
            return writeJson(res, 200, {
              ...sessionMetadataResponse(server.address().port, process.pid),
              ok: true,
            });
          }
          if (url.pathname === "/shutdown") {
            return writeJson(res, 200, { ok: true });
          }
          return writeJson(res, 404, { ok: false });
        });

        await new Promise((resolve) => {
          server.listen(0, "127.0.0.1", resolve);
        });

        await writeFile(
          path.join(sessionRoot, "session.json"),
          `${JSON.stringify(sessionMetadataResponse(server.address().port, process.pid), null, 2)}\n`,
          "utf8",
        );
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.runtimeVersion, "0.1.0-test");
  } finally {
    await new Promise((resolve) => server?.close(resolve) ?? resolve());
    await rm(root, { recursive: true, force: true });
  }
});

test("ensure-browser-session CLI only accepts startup options and delegates to ensureBrowserSession", async () => {
  const calls = [];
  const result = await runEnsureBrowserSessionCli(
    ["--session-root", "/tmp/browser-skill-session", "--runtime-version", "0.1.0-test"],
    {
      ensureBrowserSession: async (options) => {
        calls.push(options);
        return sessionMetadata;
      },
    },
  );

  assert.deepEqual(result, sessionMetadata);
  assert.deepEqual(calls, [
    {
      sessionRoot: "/tmp/browser-skill-session",
      runtimeVersion: "0.1.0-test",
    },
  ]);

  await assert.rejects(
    () =>
      runEnsureBrowserSessionCli(
        ["query"],
        {
          ensureBrowserSession: async () => sessionMetadata,
        },
      ),
    /does not accept positional commands|HTTP/i,
  );
});

async function createEnsureBrowserSessionHarness() {
  const root = await mkdtemp(path.join("/tmp", "browser-session-startup-"));
  const sessionRoot = path.join(root, "session");
  await mkdir(sessionRoot, { recursive: true });
  let launches = 0;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/health") {
      return writeJson(res, 200, {
        ...sessionMetadataResponse(server.address().port, process.pid),
        ok: true,
      });
    }

    if (url.pathname === "/shutdown") {
      return writeJson(res, 200, { ok: true });
    }

    return writeJson(res, 404, {
      ok: false,
      error: `Unexpected path ${url.pathname}`,
    });
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const port = server.address().port;
  await writeFile(
    path.join(sessionRoot, "session.json"),
    `${JSON.stringify(sessionMetadataResponse(port, process.pid), null, 2)}\n`,
    "utf8",
  );

  const options = {
    env: {},
    sessionRoot,
    runtimeVersion: "0.1.0-test",
    startupTimeoutMs: 2_000,
    launchDaemon: async () => {
      launches += 1;
    },
  };

  return {
    options,
    sessionRoot,
    launchCount: () => launches,
    cleanup: async () => {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    },
  };
}

function sessionMetadataResponse(port, pid) {
  return {
    pid,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    browserUrl: `http://127.0.0.1:${port}`,
    connectionMode: "http",
    startedAt: "2026-03-30T12:00:00.000Z",
    lastSeenAt: "2026-03-30T12:01:00.000Z",
    runtimeVersion: "0.1.0-test",
  };
}

function writeJson(res, statusCode, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(payload);
}
