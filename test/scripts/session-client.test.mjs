import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertWorkspaceResult,
  assertWorkspaceTabResult,
  assertWorkspaceTabsResult,
  assertSessionRpcRequest,
  SESSION_RPC_REQUEST_FIELDS,
  SESSION_RPC_METHODS,
} from "../../scripts/session-contract.mjs";
import {
  assertSessionMetadata,
  SESSION_METADATA_KEYS,
} from "../../scripts/session-metadata.mjs";
import { ensureSessionDaemon, sendSessionRpcRequest } from "../../scripts/session-client.mjs";

const workspaceResult = {
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

const workspaceListResult = {
  ...workspaceResult,
  tabs: [
    {
      workspaceTabRef: "workspace_tab_demo",
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

const openWorkspaceRequest = {
  requestId: "req_1",
  method: "openWorkspace",
  params: {},
};

const listTabsRequest = {
  requestId: "req_2",
  method: "listTabs",
  params: {
    workspaceRef: "workspace_demo",
  },
};

const workspaceTabResult = {
  ...workspaceResult,
  workspaceTabRef: "workspace_tab_demo",
};

const navigateRequest = {
  requestId: "req_3",
  method: "navigate",
  params: {
    workspaceRef: "workspace_demo",
    url: "https://example.com/dashboard",
  },
};

const queryRequest = {
  requestId: "req_4",
  method: "query",
  params: {
    workspaceRef: "workspace_demo",
    mode: "search",
    query: "Submit",
  },
};

const recordKnowledgeRequest = {
  requestId: "req_5",
  method: "recordKnowledge",
  params: {
    workspaceRef: "workspace_demo",
    guide: "use dashboard",
    keywords: ["dashboard"],
    rationale: "The dashboard header confirms the page is ready.",
  },
};

const selectTabRequest = {
  requestId: "req_6",
  method: "selectTab",
  params: {
    workspaceRef: "workspace_demo",
    workspaceTabRef: "workspace_tab_demo",
  },
};

test("session rpc contract freezes the workspace-first method names and metadata keys", () => {
  assert.deepEqual(SESSION_RPC_METHODS, [
    "health",
    "openWorkspace",
    "listTabs",
    "selectTab",
    "navigate",
    "click",
    "type",
    "press",
    "query",
    "recordKnowledge",
    "shutdown",
  ]);

  assert.deepEqual(SESSION_RPC_REQUEST_FIELDS, {
    health: [],
    openWorkspace: [],
    listTabs: ["workspaceRef"],
    selectTab: ["workspaceRef", "workspaceTabRef"],
    navigate: ["workspaceRef", "workspaceTabRef", "url"],
    click: ["workspaceRef", "workspaceTabRef", "uid"],
    type: ["workspaceRef", "workspaceTabRef", "uid", "text", "submit", "slowly"],
    press: ["workspaceRef", "workspaceTabRef", "key"],
    query: ["workspaceRef", "workspaceTabRef", "mode", "query", "role", "uid"],
    recordKnowledge: [
      "workspaceRef",
      "workspaceTabRef",
      "guide",
      "keywords",
      "rationale",
    ],
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

test("session rpc requests and results keep the workspace contract explicit", () => {
  assert.doesNotThrow(() => assertSessionRpcRequest(openWorkspaceRequest));
  assert.doesNotThrow(() => assertSessionRpcRequest(listTabsRequest));
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...listTabsRequest,
        params: {
          tabRef: "tab_demo",
        },
      }),
    /workspaceRef/,
  );

  assert.doesNotThrow(() => assertSessionRpcRequest(navigateRequest));
  assert.doesNotThrow(() =>
    assertSessionRpcRequest({
      ...navigateRequest,
      params: {
        ...navigateRequest.params,
        workspaceTabRef: "workspace_tab_demo",
      },
    }),
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...navigateRequest,
        params: {
          workspaceRef: "workspace_demo",
        },
      }),
    /url/,
  );

  assert.doesNotThrow(() => assertSessionRpcRequest(queryRequest));
  assert.doesNotThrow(() =>
    assertSessionRpcRequest({
      ...queryRequest,
      params: {
        ...queryRequest.params,
        workspaceTabRef: "workspace_tab_demo",
      },
    }),
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...queryRequest,
        params: {
          workspaceRef: "workspace_demo",
          mode: "search",
          query: "Submit",
          snapshotRef: "snapshot_demo",
        },
      }),
    /unknown field snapshotRef|allowed fields/i,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...queryRequest,
        params: {
          workspaceRef: "workspace_demo",
          workspaceTabRef: "workspace_tab_demo",
          mode: "full",
          query: "Submit",
        },
      }),
    /full.*query|full.*selector/i,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...queryRequest,
        params: {
          workspaceRef: "workspace_demo",
          workspaceTabRef: "workspace_tab_demo",
          mode: "search",
        },
      }),
    /search.*query|search.*role|search.*uid/i,
  );

  assert.doesNotThrow(() => assertSessionRpcRequest(recordKnowledgeRequest));
  assert.doesNotThrow(() =>
    assertSessionRpcRequest({
      ...recordKnowledgeRequest,
      params: {
        ...recordKnowledgeRequest.params,
        workspaceTabRef: "workspace_tab_demo",
      },
    }),
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...recordKnowledgeRequest,
        params: {
          workspaceRef: "workspace_demo",
          guide: "use dashboard",
          keywords: [],
          rationale: "The dashboard header confirms the page is ready.",
        },
      }),
    /keywords/i,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...recordKnowledgeRequest,
        params: {
          workspaceRef: "workspace_demo",
          guide: "use dashboard",
          keywords: ["dashboard"],
          rationale: "The dashboard header confirms the page is ready.",
          page: {
            origin: "https://example.com",
            normalizedPath: "/dashboard",
            title: "Dashboard",
          },
        },
      }),
    /unknown field page|allowed fields/i,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...recordKnowledgeRequest,
        params: {
          workspaceRef: "workspace_demo",
          guide: "use dashboard",
          keywords: ["dashboard"],
          rationale: "The dashboard header confirms the page is ready.",
          tabRef: "tab_demo",
        },
      }),
      /unknown field tabRef|allowed fields/i,
  );
  assert.throws(
    () =>
      assertSessionRpcRequest({
        ...recordKnowledgeRequest,
        params: {
          workspaceRef: "workspace_demo",
          guide: "use dashboard",
          keywords: ["dashboard"],
        },
      }),
    /rationale/i,
  );

  assert.doesNotThrow(() => assertWorkspaceResult(workspaceListResult));
  assert.doesNotThrow(() => assertWorkspaceTabsResult(workspaceListResult));
  assert.doesNotThrow(() => assertWorkspaceTabResult(workspaceTabResult));
  assert.throws(
    () =>
      assertWorkspaceTabResult({
        ...workspaceResult,
      }),
    /workspaceTabRef/i,
  );
  assert.throws(
    () =>
      assertWorkspaceTabsResult({
        ...workspaceResult,
        tabs: [
          {
            title: "Dashboard",
            url: "https://example.com/dashboard",
            active: true,
          },
        ],
      }),
    /workspaceTabRef/i,
  );
  assert.throws(
    () =>
      assertWorkspaceTabsResult({
        ...workspaceResult,
        tabs: [
          {
            workspaceTabRef: "workspace_tab_demo",
            title: "Dashboard",
            url: "https://example.com/dashboard",
            active: true,
            index: 1,
          },
        ],
      }),
    /index/i,
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
  assert.throws(
    () =>
      assertSessionMetadata({
        ...sessionMetadata,
        connectionMode: "autoConnect",
      }),
    /connectionMode/,
  );
});

test("session client starts from cached metadata and reuses the same HTTP session", async () => {
  const harness = await createSessionClientHarness();

  try {
    const first = await ensureSessionDaemon(harness.options);
    const second = await sendSessionRpcRequest("health", {}, harness.options);
    assertSessionMetadata(second);

    assert.equal(harness.launchCount(), 0);
    assert.equal(first.pid, second.pid);
    assert.equal(first.port, second.port);
    assert.equal(first.baseUrl, second.baseUrl);
  } finally {
    await harness.cleanup();
  }
});

test("session client sends workspace identity through query params and strips it from JSON bodies", async () => {
  const harness = await createSessionClientHarness();

  try {
    const openWorkspace = await sendSessionRpcRequest("openWorkspace", {}, harness.options);
    const listTabs = await sendSessionRpcRequest(
      "listTabs",
      {
        workspaceRef: "workspace_demo",
      },
      harness.options,
    );
    const navigate = await sendSessionRpcRequest(
      "navigate",
      {
        workspaceRef: "workspace_demo",
        url: "https://example.com/dashboard",
      },
      harness.options,
    );
    const query = await sendSessionRpcRequest(
      "query",
      {
        workspaceRef: "workspace_demo",
        mode: "search",
        query: "Submit",
      },
      harness.options,
    );
    const selectTab = await sendSessionRpcRequest(
      "selectTab",
      {
        workspaceRef: "workspace_demo",
        workspaceTabRef: "workspace_tab_demo",
      },
      harness.options,
    );
    const recordKnowledge = await sendSessionRpcRequest(
      "recordKnowledge",
      {
        workspaceRef: "workspace_demo",
        guide: "use dashboard",
        keywords: ["dashboard"],
        rationale: "The dashboard header confirms the page is ready.",
      },
      harness.options,
    );

    assert.doesNotThrow(() => assertWorkspaceTabsResult(openWorkspace));
    assert.doesNotThrow(() => assertWorkspaceTabsResult(listTabs));
    assert.equal(openWorkspace.workspaceRef, "workspace_demo");
    assert.equal(openWorkspace.workspaceTabRef, undefined);
    assert.equal(listTabs.workspaceRef, "workspace_demo");
    assert.equal(listTabs.workspaceTabRef, undefined);
    assert.equal(navigate.workspaceRef, "workspace_demo");
    assert.equal(navigate.workspaceTabRef, undefined);
    assert.equal(query.workspaceRef, "workspace_demo");
    assert.equal(query.workspaceTabRef, undefined);
    assert.equal(selectTab.workspaceRef, "workspace_demo");
    assert.equal(selectTab.workspaceTabRef, "workspace_tab_demo");
    assert.equal(recordKnowledge.workspaceRef, "workspace_demo");
    assert.equal(recordKnowledge.workspaceTabRef, undefined);

    const contractRequests = harness.requests
      .filter((request) => request.path !== "/health")
      .map((request) => ({
        method: request.method,
        path: request.path,
        body: request.body,
      }));

    assert.deepEqual(
      contractRequests,
      [
        {
          method: "POST",
          path: "/workspaces",
          body: {},
        },
        {
          method: "GET",
          path: "/tabs?workspaceRef=workspace_demo",
          body: null,
        },
        {
          method: "POST",
          path: "/navigate?workspaceRef=workspace_demo",
          body: {
            url: "https://example.com/dashboard",
          },
        },
        {
          method: "POST",
          path: "/query?workspaceRef=workspace_demo",
          body: {
            mode: "search",
            query: "Submit",
          },
        },
        {
          method: "POST",
          path: "/select-tab?workspaceRef=workspace_demo&workspaceTabRef=workspace_tab_demo",
          body: {},
        },
        {
          method: "POST",
          path: "/record-knowledge?workspaceRef=workspace_demo",
          body: {
            guide: "use dashboard",
            keywords: ["dashboard"],
            rationale: "The dashboard header confirms the page is ready.",
          },
        },
      ],
    );
  } finally {
    await harness.cleanup();
  }
});

async function createSessionClientHarness() {
  const root = await mkdtemp(path.join("/tmp", "browser-session-client-"));
  const sessionRoot = path.join(root, "session");
  await mkdir(sessionRoot, { recursive: true });
  const requests = [];
  let launches = 0;

  const server = createServer(async (req, res) => {
    const body = await readRequestBody(req);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    requests.push({
      method: req.method,
      path: `${url.pathname}${url.search}`,
      body,
    });

    if (url.pathname === "/health") {
      return writeJson(res, 200, {
        ...sessionMetadataResponse(server.address().port, process.pid),
        ok: true,
      });
    }

    if (url.pathname === "/workspaces") {
      return writeJson(res, 200, workspaceListResult);
    }

    if (url.pathname === "/tabs") {
      return writeJson(res, 200, workspaceListResult);
    }

    if (url.pathname === "/select-tab") {
      return writeJson(res, 200, workspaceTabResult);
    }

    if (url.pathname === "/record-knowledge") {
      return writeJson(res, 200, workspaceResult);
    }

    if (url.pathname === "/shutdown") {
      return writeJson(res, 200, { ok: true });
    }

    return writeJson(res, 200, workspaceResult);
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
    requests,
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

async function readRequestBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }

  if (raw.length === 0) {
    return null;
  }

  return JSON.parse(raw);
}

function writeJson(res, statusCode, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(payload);
}
