import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { requestJson, startBrowserSessionDaemon } from "../../scripts/http-client.mjs";

function createFakeBrowserBridge() {
  const state = {
    activePageId: 1,
    nextSnapshotIndex: 0,
    tabs: [
      {
        index: 1,
        title: "Dashboard",
        url: "https://example.com/dashboard",
        active: true,
      },
    ],
  };

  return {
    async listPages() {
      return renderPageList(state.tabs);
    },
    async newPage(url) {
      state.activePageId = 1;
      state.tabs = [
        {
          index: 1,
          title: "Workspace",
          url,
          active: true,
        },
      ];
      return renderPageList(state.tabs);
    },
    async captureSnapshot() {
      state.nextSnapshotIndex += 1;
      const title = state.tabs.find((tab) => tab.active)?.title ?? "Unknown";
      const url = state.tabs.find((tab) => tab.active)?.url ?? "https://example.com/";
      return [
        "## Latest page snapshot",
        `uid=root RootWebArea "${title}" url="${url}"`,
        `- button [ref=submit_button] Submit ${state.nextSnapshotIndex}`,
        `- textbox [uid=query_input] Search`,
      ].join("\n");
    },
    async callTool(name, args) {
      if (name === "select_page") {
        const pageId = args.pageId;
        state.activePageId = pageId;
        state.tabs = state.tabs.map((tab) => ({
          ...tab,
          active: tab.index === pageId,
        }));
        return renderPageList(state.tabs);
      }

      if (name === "navigate_page") {
        state.tabs = state.tabs.map((tab) =>
          tab.active
            ? {
                ...tab,
                url: args.url,
                title: "Example dashboard",
              }
            : tab,
        );
        return { content: [{ type: "text", text: "navigation complete" }] };
      }

      if (name === "click" || name === "fill" || name === "press_key") {
        return { content: [{ type: "text", text: `${name} complete` }] };
      }

      throw new Error(`unexpected browser tool ${name}`);
    },
  };
}

function renderPageList(tabs) {
  return [
    "## Pages",
    ...tabs.map((tab) => `- ${tab.index} ${tab.active ? "(current) " : ""}[${tab.title}](${tab.url})`),
  ].join("\n");
}

function createIsolatedRuntimeRoots(root) {
  return {
    tempRoot: path.join(root, "runtime"),
    knowledgeFile: path.join(root, "knowledge", "page-knowledge.jsonl"),
  };
}

test("browser-sessiond serves /health over HTTP and refreshes lastSeenAt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createMcpBridge: async () => ({ ...createFakeBrowserBridge() }),
  });

  try {
    const firstHealth = await requestJson("GET", `${metadata.baseUrl}/health`);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const secondHealth = await requestJson("GET", `${metadata.baseUrl}/health`);

    assert.equal(firstHealth.ok, true);
    assert.equal(firstHealth.runtimeVersion, "test-http");
    assert.equal(firstHealth.baseUrl, metadata.baseUrl);
    assert.equal(firstHealth.port, metadata.port);
    assert.equal(typeof firstHealth.lastSeenAt, "string");
    assert.equal(secondHealth.lastSeenAt > firstHealth.lastSeenAt, true);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond routes capture over HTTP and strips snapshotPath from public responses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createMcpBridge: async () => ({ ...createFakeBrowserBridge() }),
  });

  try {
    const result = await requestJson("POST", `${metadata.baseUrl}/capture`, {
      tabRef: "tab_demo",
    });

    assert.equal(result.ok, true);
    assert.equal(result.tabRef, "tab_demo");
    assert.equal(typeof result.snapshotRef, "string");
    assert.equal(result.snapshotRef.length > 0, true);
    assert.equal(typeof result.summary, "string");
    assert.equal(result.summary.includes("tab_demo"), true);
    assert.equal("snapshotPath" in result, false);
    assert.equal(result.tabs[0].active, true);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond routes actions, query-snapshot, and record-knowledge through the runtime helpers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createMcpBridge: async () => ({ ...createFakeBrowserBridge() }),
  });

  try {
    const capture = await requestJson("POST", `${metadata.baseUrl}/capture`, {
      tabRef: "main",
    });
    assert.equal(capture.ok, true);

    const navigate = await requestJson("POST", `${metadata.baseUrl}/navigate`, {
      tabRef: "main",
      url: "https://example.com/dashboard",
    });
    assert.equal(navigate.ok, true);
    assert.equal("snapshotPath" in navigate, false);

    const record = await requestJson("POST", `${metadata.baseUrl}/record-knowledge`, {
      tabRef: "main",
      guide: "Submit button is in the page body.",
      keywords: ["submit", "dashboard"],
    });
    assert.equal(record.ok, true);
    assert.equal(record.record.guide, "Submit button is in the page body.");
    assert.equal(record.record.page.normalizedPath, "/dashboard");

    const query = await requestJson("POST", `${metadata.baseUrl}/query-snapshot`, {
      tabRef: "main",
      mode: "auto",
      query: "Submit",
    });
    assert.equal(query.ok, true);
    assert.equal(query.page.normalizedPath, "/dashboard");
    assert.equal(query.knowledgeHits.length > 0, true);
    assert.equal("snapshotPath" in query, false);

    const repeatQuery = await requestJson("POST", `${metadata.baseUrl}/query-snapshot`, {
      tabRef: "main",
      mode: "auto",
      query: "Submit",
    });
    assert.equal(repeatQuery.ok, true);
    assert.equal(repeatQuery.knowledgeHits.length > 0, true);
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
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createMcpBridge: async () => ({ ...createFakeBrowserBridge() }),
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
