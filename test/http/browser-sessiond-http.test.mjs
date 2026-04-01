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
        targetId: "target-dashboard",
        openerId: "",
        title: "Dashboard",
        url: "https://example.com/dashboard",
        active: true,
      },
      {
        index: 2,
        targetId: "target-details",
        openerId: "",
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
    async listLivePageInventory() {
      return state.tabs.map((tab) => ({
        pageId: tab.index,
        targetId: tab.targetId,
        openerId: tab.openerId,
        url: tab.url,
        title: tab.title,
      }));
    },
    async newPage(url) {
      state.tabs = state.tabs.map((tab) =>
        tab.index === 1
          ? {
              ...tab,
              targetId: "target-workspace",
              openerId: "",
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
      return this.captureSnapshotForPage(active?.index ?? state.tabs[0]?.index ?? 0);
    },
    async captureSnapshotForPage(pageId) {
      const active = state.tabs.find((tab) => tab.index === pageId) ?? state.tabs[0];
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
          (Number.isInteger(args.pageId) ? tab.index === args.pageId : tab.active)
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
        if (Number.isInteger(args.pageId)) {
          state.tabs = state.tabs.map((tab) => ({
            ...tab,
            active: tab.index === args.pageId,
          }));
        }
        return { content: [{ type: "text", text: `${name} complete` }] };
      }

      throw new Error(`unexpected browser tool ${name}`);
    },
  };
}

function createPopupOpeningBrowserBridge() {
  const calls = [];
  const state = {
    tabs: [
      {
        index: 1,
        targetId: "target-inbox",
        openerId: "",
        title: "Inbox",
        url: "https://example.com/inbox",
        active: true,
      },
    ],
  };

  return {
    calls,
    async listPages() {
      return renderPageList(state.tabs);
    },
    async listLivePageInventory() {
      return state.tabs.map((tab) => ({
        pageId: tab.index,
        targetId: tab.targetId,
        openerId: tab.openerId,
        url: tab.url,
        title: tab.title,
      }));
    },
    async newPage(url) {
      state.tabs = [
        {
          index: 1,
          targetId: "target-workspace",
          openerId: "",
          title: "Workspace",
          url,
          active: true,
        },
      ];
      return renderPageList(state.tabs);
    },
    async captureSnapshot() {
      const active = state.tabs.find((tab) => tab.active) ?? state.tabs[0];
      return this.captureSnapshotForPage(active?.index ?? state.tabs[0]?.index ?? 0);
    },
    async captureSnapshotForPage(pageId) {
      const active = state.tabs.find((tab) => tab.index === pageId) ?? state.tabs[0];
      return [
        "## Latest page snapshot",
        `uid=root RootWebArea "${active.title}" url="${active.url}"`,
        `- heading "${active.title}" [uid=page_heading]`,
      ].join("\n");
    },
    async callTool(name, args) {
      calls.push({ name, args });

      if (name === "select_page") {
        state.tabs = state.tabs.map((tab) => ({
          ...tab,
          active: tab.index === args.pageId,
        }));
        return { content: [{ type: "text", text: renderPageList(state.tabs) }] };
      }

      if (name === "click") {
        state.tabs = [
          {
            index: 1,
            targetId: "target-workspace",
            openerId: "",
            title: "Inbox",
            url: "https://example.com/inbox",
            active: false,
          },
          {
            index: 2,
            targetId: "target-conversation",
            openerId: "target-workspace",
            title: "Conversation",
            url: "https://example.com/conversation/42",
            active: true,
          },
        ];
        return { content: [{ type: "text", text: "click complete" }] };
      }

      if (name === "list_pages") {
        return { content: [{ type: "text", text: renderPageList(state.tabs) }] };
      }

      throw new Error(`unexpected browser tool ${name}`);
    },
  };
}

function createActivePopupWithoutOpenerBrowserBridge() {
  const calls = [];
  const state = {
    tabs: [
      {
        index: 1,
        targetId: "target-inbox",
        openerId: "",
        title: "Inbox",
        url: "https://example.com/inbox",
        active: true,
      },
    ],
  };

  return {
    calls,
    async listPages() {
      return renderPageList(state.tabs);
    },
    async listLivePageInventory() {
      return state.tabs.map((tab) => ({
        pageId: tab.index,
        targetId: tab.targetId,
        openerId: tab.openerId,
        url: tab.url,
        title: tab.title,
      }));
    },
    async newPage(url) {
      state.tabs = [
        {
          index: 1,
          targetId: "target-workspace",
          openerId: "",
          title: "Workspace",
          url,
          active: true,
        },
      ];
      return renderPageList(state.tabs);
    },
    async captureSnapshot() {
      const active = state.tabs.find((tab) => tab.active) ?? state.tabs[0];
      return this.captureSnapshotForPage(active?.index ?? state.tabs[0]?.index ?? 0);
    },
    async captureSnapshotForPage(pageId) {
      const active = state.tabs.find((tab) => tab.index === pageId) ?? state.tabs[0];
      return [
        "## Latest page snapshot",
        `uid=root RootWebArea "${active.title}" url="${active.url}"`,
        `- heading "${active.title}" [uid=page_heading]`,
      ].join("\n");
    },
    async callTool(name, args) {
      calls.push({ name, args });

      if (name === "select_page") {
        state.tabs = state.tabs.map((tab) => ({
          ...tab,
          active: tab.index === args.pageId,
        }));
        return { content: [{ type: "text", text: renderPageList(state.tabs) }] };
      }

      if (name === "click") {
        state.tabs = [
          {
            index: 1,
            targetId: "target-workspace",
            openerId: "",
            title: "Inbox",
            url: "https://example.com/inbox",
            active: false,
          },
          {
            index: 2,
            targetId: "target-conversation",
            openerId: "",
            title: "Conversation",
            url: "https://example.com/conversation/42",
            active: true,
          },
        ];
        return { content: [{ type: "text", text: "click complete" }] };
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
      targetId: "target-details",
      status: "open",
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

test("browser-sessiond GET /tabs fails explicitly for an unknown workspaceRef", async () => {
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
    await assert.rejects(
      () => requestJson("GET", `${metadata.baseUrl}/tabs?workspaceRef=workspace_missing`),
      (error) => {
        assert.equal(error.status, 500);
        assert.match(error.body.error, /Workspace workspace_missing is not available; create a new workspace with POST \/workspaces\./);
        return true;
      },
    );
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond query full only returns workspace-local open tabs in the public snapshot envelope", async () => {
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
    const fullQuery = await requestJson(
      "POST",
      `${metadata.baseUrl}/query?workspaceRef=${workspaces.workspaceRef}`,
      {
        mode: "full",
      },
    );

    assert.equal(fullQuery.ok, true);
    assert.equal(fullQuery.workspaceRef, workspaces.workspaceRef);
    assert.match(fullQuery.snapshotText, /### Open tabs/);
    assert.match(fullQuery.snapshotText, /Workspace/);
    assert.doesNotMatch(fullQuery.snapshotText, /Details/);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond filters closed workspace tabs out of public tab lists and rewritten open-tab envelopes", async () => {
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
    await daemon.workspaceState.writeWorkspaceTab({
      workspaceRef: workspaces.workspaceRef,
      workspaceTabRef: "workspace_tab_closed",
      targetId: "target-closed",
      status: "closed",
      browserTabIndex: undefined,
      page: {
        origin: "https://example.com",
        normalizedPath: "/closed",
        title: "Closed tab",
      },
      snapshotPath: "/tmp/closed.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const tabs = await requestJson("GET", `${metadata.baseUrl}/tabs?workspaceRef=${workspaces.workspaceRef}`);
    const fullQuery = await requestJson(
      "POST",
      `${metadata.baseUrl}/query?workspaceRef=${workspaces.workspaceRef}`,
      {
        mode: "full",
      },
    );

    assert.equal(tabs.ok, true);
    assert.equal(tabs.tabs.some((tab) => tab.title === "Closed tab"), false);
    assert.equal(fullQuery.ok, true);
    assert.doesNotMatch(fullQuery.snapshotText, /Closed tab/);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond keeps workspaceTabRef preselect + action atomic in one transaction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const requestCalls = [];
  const workspaceRef = "workspace_tab_ref_test";
  const detailsTabRef = "workspace_tab_2";
  let clickInProgress = false;
  let releaseClick;
  const clickGate = new Promise((resolve) => {
    releaseClick = resolve;
  });
  let releaseQuery;
  const queryGate = new Promise((resolve) => {
    releaseQuery = resolve;
  });
  let clickStarted;
  const waitForClickStart = new Promise((resolve) => {
    clickStarted = resolve;
  });
  let queryStarted;
  const waitForQueryStart = new Promise((resolve) => {
    queryStarted = resolve;
  });
  let selectTabStarted;
  const waitForSelectTabStart = new Promise((resolve) => {
    selectTabStarted = resolve;
  });
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createBrowserBridge: async () => createFakeBrowserBridge(),
  });

  daemon.resolveWorkspaceTabPageId = () => 2;

  let queryRequestPromise;
  const startQueryRequest = () => {
    if (queryRequestPromise) {
      return queryRequestPromise;
    }

    queryRequestPromise = fetch(`${metadata.baseUrl}/query?workspaceRef=${workspaceRef}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ mode: "full" }),
    }).then(async (response) => ({
      status: response.status,
      body: response.ok ? await response.json() : await response.text(),
    }));

    return queryRequestPromise;
  };

  daemon.browserAction = async (action, toolName, toolArgs, actionWorkspaceRef) => {
    const detailsPage = {
      origin: "https://example.com",
      normalizedPath: "/details",
      title: "Details",
    };

    if (action === "select-tab") {
      requestCalls.push("select-tab:start");
      selectTabStarted();
      startQueryRequest();
      await Promise.race([
        waitForQueryStart,
        new Promise((resolve) => {
          setTimeout(resolve, 20);
        }),
      ]);
      requestCalls.push("select-tab:end");
      return {
        ok: true,
        workspaceRef: actionWorkspaceRef,
        workspaceTabRef: `workspace_tab_${toolArgs.pageId}`,
        page: detailsPage,
        tabs: [
          {
            workspaceTabRef: `workspace_tab_${toolArgs.pageId}`,
            title: "Details",
            url: "https://example.com/details",
            active: true,
          },
        ],
        knowledgeHits: [],
        summary: "selected tab",
      };
    }

    if (action === "click") {
      requestCalls.push("click:start");
      clickInProgress = true;
      clickStarted();
      startQueryRequest();
      await clickGate;
      clickInProgress = false;
      requestCalls.push("click:end");
      return {
        ok: true,
        workspaceRef: actionWorkspaceRef,
        workspaceTabRef: detailsTabRef,
        page: detailsPage,
        tabs: [
          {
            workspaceTabRef: detailsTabRef,
            title: "Details",
            url: "https://example.com/details",
            active: true,
          },
        ],
        toolName,
        knowledgeHits: [],
        summary: "clicked",
      };
    }

    throw new Error(`unexpected browser action ${action}`);
  };

  daemon.queryWorkspace = async (params) => {
    queryStarted();
    if (clickInProgress) {
      requestCalls.push("queryWorkspace:interleaving");
    }
    requestCalls.push("queryWorkspace:start");
    await queryGate;
    requestCalls.push("queryWorkspace:end");
    return {
      ok: true,
      workspaceRef: params.workspaceRef,
      snapshotText: "uid=root RootWebArea \"Workspace\" url=\"https://example.com/dashboard\"",
      page: {
        origin: "https://example.com",
        normalizedPath: "/dashboard",
        title: "Workspace",
      },
      knowledgeHits: [],
      summary: "queried workspace",
    };
  };

  try {
    const clickRequest = fetch(
      `${metadata.baseUrl}/click?workspaceRef=${workspaceRef}&workspaceTabRef=${detailsTabRef}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ uid: "submit_button" }),
      },
    ).then(async (response) => ({
      status: response.status,
      body: response.ok ? await response.json() : await response.text(),
    }));

    await Promise.race([
      waitForSelectTabStart,
      waitForClickStart,
    ]);

    if (!queryRequestPromise) {
      startQueryRequest();
    }

    await Promise.race([
      waitForClickStart,
      waitForQueryStart,
    ]);

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    releaseClick();
    releaseQuery();

    const [clickWithTabRef, query] = await Promise.all([clickRequest, startQueryRequest()]);

    assert.equal(clickWithTabRef.status, 200);
    assert.equal(query.status, 200);
    if (typeof clickWithTabRef.body === "object" && clickWithTabRef.body !== null) {
      assert.equal(clickWithTabRef.body.workspaceRef, workspaceRef);
      assert.equal(clickWithTabRef.body.workspaceTabRef, detailsTabRef);
    }
    assert.equal(typeof query.body === "object" ? query.body.workspaceRef : workspaceRef, workspaceRef);
    assert.equal(requestCalls.includes("queryWorkspace:interleaving"), false);
    assert.equal(requestCalls.indexOf("queryWorkspace:start") > requestCalls.indexOf("click:end"), true);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond click adopts a newly focused tab into the workspace and returns the live active tab to the agent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const bridge = createPopupOpeningBrowserBridge();
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createBrowserBridge: async () => bridge,
  });

  try {
    const workspace = await requestJson("POST", `${metadata.baseUrl}/workspaces`, {});
    const click = await requestJson(
      "POST",
      `${metadata.baseUrl}/click?workspaceRef=${workspace.workspaceRef}`,
      {
        uid: "page_heading",
      },
    );
    const tabs = await requestJson("GET", `${metadata.baseUrl}/tabs?workspaceRef=${workspace.workspaceRef}`);

    assert.equal(click.ok, true);
    assert.equal(click.workspaceRef, workspace.workspaceRef);
    assert.equal(click.page.normalizedPath, "/conversation/42");
    assert.equal(click.page.title, "Conversation");
    assert.match(click.workspaceTabRef, /^workspace_tab_[0-9a-f-]+$/i);
    assert.equal(Array.isArray(click.tabs), true);
    assert.equal(click.tabs.length, 2);
    assert.equal(click.tabs.some((tab) => tab.title === "Inbox"), true);
    assert.equal(click.tabs.some((tab) => tab.title === "Conversation" && tab.active), true);

    const originalTabRef = workspace.tabs.find((tab) => tab.active)?.workspaceTabRef;
    assert.notEqual(click.workspaceTabRef, originalTabRef);

    assert.equal(tabs.tabs.length, 2);
    assert.equal(
      tabs.tabs.some((tab) => tab.workspaceTabRef === click.workspaceTabRef && tab.title === "Conversation" && tab.active),
      true,
    );
    assert.equal(
      tabs.tabs.some((tab) => tab.workspaceTabRef === originalTabRef && tab.title === "Inbox"),
      true,
    );
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond click adopts a newly active tab even when the new target has no openerId", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-sessiond-http-"));
  const bridge = createActivePopupWithoutOpenerBrowserBridge();
  const { daemon, metadata } = await startBrowserSessionDaemon({
    sessionRoot: path.join(root, "session"),
    port: 0,
    runtimeVersion: "test-http",
    runtimeRoots: createIsolatedRuntimeRoots(root),
    createBrowserBridge: async () => bridge,
  });

  try {
    const workspace = await requestJson("POST", `${metadata.baseUrl}/workspaces`, {});
    const click = await requestJson(
      "POST",
      `${metadata.baseUrl}/click?workspaceRef=${workspace.workspaceRef}`,
      {
        uid: "page_heading",
      },
    );

    assert.equal(click.ok, true);
    assert.equal(click.page.normalizedPath, "/conversation/42");
    assert.equal(click.page.title, "Conversation");
    assert.match(click.workspaceTabRef, /^workspace_tab_[0-9a-f-]+$/i);

    const originalTabRef = workspace.tabs.find((tab) => tab.active)?.workspaceTabRef;
    assert.notEqual(click.workspaceTabRef, originalTabRef);
    assert.equal(
      click.tabs.some((tab) => tab.workspaceTabRef === click.workspaceTabRef && tab.title === "Conversation" && tab.active),
      true,
    );
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond click resolves workspace B from workspace.activeWorkspaceTabRef even after workspace A already targeted the daemon", async () => {
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
    const workspaceA = await requestJson("POST", `${metadata.baseUrl}/workspaces`, {});
    const workspaceB = await requestJson("POST", `${metadata.baseUrl}/workspaces`, {});
    const seededTabsA = daemon.workspaceTabRefs.materializeTabs(workspaceA.workspaceRef, [
      {
        index: 1,
        title: "Inbox A",
        url: "https://example.com/inbox-a",
        active: true,
      },
      {
        index: 2,
        title: "Details A",
        url: "https://example.com/details-a",
        active: false,
      },
    ]);
    const seededTabsB = daemon.workspaceTabRefs.materializeTabs(workspaceB.workspaceRef, [
      {
        index: 1,
        title: "Inbox B",
        url: "https://example.com/inbox-b",
        active: false,
      },
      {
        index: 2,
        title: "Details B",
        url: "https://example.com/details-b",
        active: true,
      },
    ]);
    const detailsTabB = seededTabsB[1];

    await daemon.workspaceBindings.write({
      workspaceRef: workspaceA.workspaceRef,
      browserTabIndex: 1,
      snapshotPath: "/tmp/workspace-a.md",
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace-a",
        title: "Workspace",
      },
    });
    await daemon.workspaceState.writeWorkspace({
      workspaceRef: workspaceA.workspaceRef,
      activeWorkspaceTabRef: seededTabsA[0].workspaceTabRef,
      browserTabIndex: 1,
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace-a",
        title: "Workspace",
      },
      snapshotPath: "/tmp/workspace-a.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    await daemon.workspaceState.writeWorkspaceTab({
      workspaceRef: workspaceA.workspaceRef,
      workspaceTabRef: seededTabsA[0].workspaceTabRef,
      targetId: "target-workspace",
      status: "open",
      browserTabIndex: 1,
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace-a",
        title: "Workspace",
      },
      snapshotPath: "/tmp/workspace-a.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    await daemon.workspaceBindings.write({
      workspaceRef: workspaceB.workspaceRef,
      browserTabIndex: 2,
      snapshotPath: "/tmp/details-b.md",
      page: {
        origin: "https://example.com",
        normalizedPath: "/details-b",
        title: "Details B",
      },
    });
    await daemon.workspaceState.writeWorkspace({
      workspaceRef: workspaceB.workspaceRef,
      activeWorkspaceTabRef: detailsTabB.workspaceTabRef,
      browserTabIndex: 2,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details-b",
        title: "Details B",
      },
      snapshotPath: "/tmp/details-b.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    await daemon.workspaceState.writeWorkspaceTab({
      workspaceRef: workspaceB.workspaceRef,
      workspaceTabRef: detailsTabB.workspaceTabRef,
      targetId: "target-details",
      status: "open",
      browserTabIndex: 2,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details-b",
        title: "Details B",
      },
      snapshotPath: "/tmp/details-b.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    const firstClick = await requestJson(
      "POST",
      `${metadata.baseUrl}/click?workspaceRef=${workspaceA.workspaceRef}`,
      {
        uid: "submit_button",
      },
    );
    const secondClick = await requestJson(
      "POST",
      `${metadata.baseUrl}/click?workspaceRef=${workspaceB.workspaceRef}`,
      {
        uid: "submit_button",
      },
    );

    assert.equal(firstClick.ok, true);
    assert.equal(secondClick.ok, true);
    assert.equal(firstClick.workspaceRef, workspaceA.workspaceRef);
    assert.equal(secondClick.workspaceRef, workspaceB.workspaceRef);
    assert.equal(secondClick.workspaceTabRef, detailsTabB.workspaceTabRef);
    assert.equal(
      secondClick.tabs.some((tab) => tab.workspaceTabRef === detailsTabB.workspaceTabRef && tab.active),
      true,
    );
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond accepts JSON POST bodies without an explicit content-type header", async () => {
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
    const workspaceResponse = await fetch(`${metadata.baseUrl}/workspaces`, {
      method: "POST",
      body: "{}",
    });
    const workspace = await workspaceResponse.json();

    const queryResponse = await fetch(`${metadata.baseUrl}/query?workspaceRef=${workspace.workspaceRef}`, {
      method: "POST",
      body: JSON.stringify({
        mode: "search",
        query: "Submit",
      }),
    });
    const query = await queryResponse.json();

    assert.equal(workspaceResponse.ok, true);
    assert.equal(workspace.ok, true);
    assert.equal(queryResponse.ok, true);
    assert.equal(query.ok, true);
    assert.equal(query.workspaceRef, workspace.workspaceRef);
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
      targetId: "target-details",
      status: "open",
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
    assert.equal(bridge.calls.some((call) => call.name === "select_page" && call.args.pageId === 2), false);
  } finally {
    await daemon.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("browser-sessiond record-knowledge keeps repeated stable guidance idempotent on the same page", async () => {
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
    const first = await requestJson(
      "POST",
      `${metadata.baseUrl}/record-knowledge?workspaceRef=${workspaces.workspaceRef}`,
      {
        guide: "Search is available in the top toolbar.",
        keywords: ["toolbar", "search"],
        rationale: "The search input is consistently visible in the top toolbar.",
      },
    );
    const second = await requestJson(
      "POST",
      `${metadata.baseUrl}/record-knowledge?workspaceRef=${workspaces.workspaceRef}`,
      {
        guide: "Search is available in the top toolbar.",
        keywords: ["search", "toolbar"],
        rationale: "The search input is still in the same toolbar position.",
      },
    );

    assert.equal(first.knowledgeHits.length, 1);
    assert.equal(second.knowledgeHits.length, 1);
    assert.equal(second.knowledgeHits[0]?.guide, "Search is available in the top toolbar.");
    assert.deepEqual(second.knowledgeHits[0]?.keywords, ["search", "toolbar"]);
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
