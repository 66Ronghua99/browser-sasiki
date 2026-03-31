import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { requestJson, startBrowserSessionDaemon } from "../../scripts/http-client.mjs";

function createFakeBrowserBridge() {
  const calls = [];
  const state = {
    tabs: [
      {
        index: 1,
        title: "Dashboard",
        url: "https://example.com/dashboard",
        active: true,
      },
      {
        index: 2,
        title: "Details",
        url: "https://example.com/details",
        active: false,
      },
    ],
  };

  return {
    calls,
    async listPages() {
      return renderPageList(state.tabs);
    },
    async newPage(url) {
      state.tabs = state.tabs.map((tab) =>
        tab.index === 1
          ? {
              ...tab,
              title: "Workspace",
              url,
              active: true,
            }
          : tab,
      );
      return renderPageList(state.tabs);
    },
    async captureSnapshot() {
      const active = state.tabs.find((tab) => tab.active) ?? state.tabs[0];
      return [
        "## Latest page snapshot",
        `uid=root RootWebArea "${active.title}" url="${active.url}"`,
        "- button \"Submit\" [ref=submit_button]",
        "- textbox [uid=query_input] Search",
      ].join("\n");
    },
    async callTool(name, args) {
      calls.push({ name, args });

      if (name === "select_page") {
        state.tabs = state.tabs.map((tab) => ({
          ...tab,
          active: tab.index === args.pageId,
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
  const bridge = createFakeBrowserBridge();
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createBrowserBridge: async () => bridge,
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

test("browser-sessiond bridges workspace-first listing and tab-selection HTTP onto the browser runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const bridge = createFakeBrowserBridge();
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createBrowserBridge: async () => bridge,
  });

  try {
    const workspaces = await requestJson("POST", `${metadata.baseUrl}/workspaces`, {});
    const seededTabs = daemon.workspaceTabRefs.materializeTabs(workspaces.workspaceRef, [
      {
        index: 1,
        title: "Workspace",
        url: "about:blank",
        active: true,
      },
      {
        index: 2,
        title: "Details",
        url: "https://example.com/details",
        active: false,
      },
    ]);
    const detailsTab = seededTabs[1];
    await daemon.workspaceState.writeWorkspaceTab({
      workspaceRef: workspaces.workspaceRef,
      workspaceTabRef: detailsTab.workspaceTabRef,
      browserTabIndex: 2,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details",
        title: "Details",
      },
      snapshotPath: "/tmp/details.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    const tabs = await requestJson("GET", `${metadata.baseUrl}/tabs?workspaceRef=${workspaces.workspaceRef}`);
    const selectTab = await requestJson(
      "POST",
      `${metadata.baseUrl}/select-tab?workspaceRef=${workspaces.workspaceRef}&workspaceTabRef=${detailsTab.workspaceTabRef}`,
      {},
    );

    assert.equal(workspaces.ok, true);
    assert.equal(typeof workspaces.workspaceRef, "string");
    assert.equal(workspaces.workspaceTabRef, undefined);
    assert.equal(Array.isArray(workspaces.tabs), true);
    assert.equal(workspaces.tabs.length, 1);
    assert.match(workspaces.tabs[0].workspaceTabRef, /^workspace_tab_[0-9a-f-]+$/i);
    assert.equal(workspaces.tabs[0].title, "Workspace");

    assert.equal(tabs.ok, true);
    assert.equal(tabs.workspaceRef, workspaces.workspaceRef);
    assert.equal(tabs.tabs.length, 2);
    assert.equal(
      tabs.tabs.some((tab) => tab.workspaceTabRef === workspaces.tabs[0].workspaceTabRef && tab.title === "Workspace"),
      true,
    );
    assert.equal(
      tabs.tabs.some((tab) => tab.workspaceTabRef === detailsTab.workspaceTabRef && tab.title === "Details"),
      true,
    );

    assert.equal(selectTab.ok, true);
    assert.equal(selectTab.workspaceRef, workspaces.workspaceRef);
    assert.equal(selectTab.workspaceTabRef, detailsTab.workspaceTabRef);

    const selectPageIds = bridge.calls.filter((call) => call.name === "select_page").map((call) => call.args.pageId);
    assert.equal(selectPageIds.includes(2), true);
    assert.equal(selectPageIds.at(-1), 2);

    await assert.rejects(() =>
      requestJson(
        "POST",
        `${metadata.baseUrl}/navigate?workspaceRef=${workspaces.workspaceRef}&workspaceTabRef=workspace_tab_2`,
        {
          url: "https://example.com/dashboard",
        },
      ),
    );
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond stale workspace failures stay on workspace-first language after a session reset", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const runtimeRoots = createIsolatedRuntimeRoots(root);
  const bridge = createFakeBrowserBridge();
  const started = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots,
    createBrowserBridge: async () => bridge,
  });

  try {
    const workspace = await requestJson("POST", `${started.metadata.baseUrl}/workspaces`, {});
    await started.daemon.stop();

    const restarted = await startBrowserSessionDaemon({
      sessionRoot: path.join(root, "session"),
      port: 0,
      runtimeVersion: "test-http",
      runtimeRoots,
      createBrowserBridge: async () => createFakeBrowserBridge(),
    });

    try {
      await assert.rejects(
        () =>
          requestJson(
            "POST",
            `${restarted.metadata.baseUrl}/query?workspaceRef=${workspace.workspaceRef}`,
            {
              mode: "search",
              query: "Submit",
            },
          ),
        (error) => {
          assert.equal(error.status, 500);
          assert.match(error.body.error, /Workspace .*POST \/workspaces\./);
          assert.doesNotMatch(error.body.error, /\/capture/i);
          return true;
        },
      );
    } finally {
      await restarted.daemon.stop();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond record-knowledge returns the bridged workspace response and legacy record payload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const bridge = createFakeBrowserBridge();
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createBrowserBridge: async () => bridge,
  });

  try {
    const workspaces = await requestJson("POST", `${metadata.baseUrl}/workspaces`, {});
    const seededTabs = daemon.workspaceTabRefs.materializeTabs(workspaces.workspaceRef, [
      {
        index: 1,
        title: "Workspace",
        url: "about:blank",
        active: true,
      },
      {
        index: 2,
        title: "Details",
        url: "https://example.com/details",
        active: false,
      },
    ]);
    const detailsTab = seededTabs[1];
    await daemon.workspaceState.writeWorkspaceTab({
      workspaceRef: workspaces.workspaceRef,
      workspaceTabRef: detailsTab.workspaceTabRef,
      browserTabIndex: 2,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details",
        title: "Details",
      },
      snapshotPath: "/tmp/details.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    await requestJson(
      "POST",
      `${metadata.baseUrl}/navigate?workspaceRef=${workspaces.workspaceRef}&workspaceTabRef=${detailsTab.workspaceTabRef}`,
      {
        url: "https://example.com/dashboard",
      },
    );

    const recordKnowledge = await requestJson(
      "POST",
      `${metadata.baseUrl}/record-knowledge?workspaceRef=${workspaces.workspaceRef}&workspaceTabRef=${detailsTab.workspaceTabRef}`,
      {
        guide: "Submit button is in the page body.",
        keywords: ["submit", "dashboard"],
        rationale: "The dashboard heading confirms the page is loaded.",
      },
    );

    assert.equal(recordKnowledge.ok, true);
    assert.equal(recordKnowledge.workspaceRef, workspaces.workspaceRef);
    assert.equal(recordKnowledge.workspaceTabRef, detailsTab.workspaceTabRef);
    assert.equal(recordKnowledge.page.normalizedPath, "/dashboard");
    assert.equal(Array.isArray(recordKnowledge.knowledgeHits), true);
    assert.equal(recordKnowledge.summary.includes("Recorded knowledge for /dashboard"), true);
    assert.equal(recordKnowledge.record.guide, "Submit button is in the page body.");
    assert.equal(recordKnowledge.record.page.normalizedPath, "/dashboard");
    assert.equal(bridge.calls.some((call) => call.name === "select_page" && call.args.pageId === 2), true);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond shutdown closes the direct-run HTTP server", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const bridge = createFakeBrowserBridge();
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createBrowserBridge: async () => bridge,
  });

  try {
    const shutdown = await requestJson("POST", `${metadata.baseUrl}/shutdown`, {});
    assert.equal(shutdown.ok, true);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});
