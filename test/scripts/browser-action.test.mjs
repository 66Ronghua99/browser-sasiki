import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openWorkspaceFlow, runWorkspaceAction } from "../../scripts/browser-action.mjs";
import { KnowledgeStore } from "../../scripts/knowledge-store.mjs";
import { SnapshotStore } from "../../scripts/snapshot-store.mjs";
import { WorkspaceStore } from "../../scripts/workspace-store.mjs";
import { WorkspaceBindingStore } from "../../scripts/workspace-binding-store.mjs";

test("openWorkspaceFlow reconciles live browser state into the cached workspace state", async () => {
  const harness = await createHarness({
    openWorkspaceTab: async () => ({
      pageId: 7,
      pageListText: "## Pages\n7: https://example.com/workspace [selected]",
    }),
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });
      if (name === "select_page") {
        throw new Error("No page found for pageId 99");
      }
      return {
        content: [
          {
            type: "text",
            text: "## Pages\n7: https://example.com/workspace [selected]",
          },
        ],
      };
    },
    captureSnapshot: async () =>
      "## Latest page snapshot\nuid=7_0 RootWebArea \"Workspace\" url=\"https://example.com/workspace\"",
    readActiveTabIndex: async () => {
      throw new Error("readActiveTabIndex should not be used for a workspace open flow");
    },
  });

  try {
    await harness.workspaceState.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_cached",
      browserTabIndex: 99,
      page: {
        origin: "https://example.com",
        normalizedPath: "/stale",
        title: "Stale",
      },
      snapshotPath: "/tmp/stale-snapshot.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    await harness.workspaceState.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_cached",
      browserTabIndex: 99,
      page: {
        origin: "https://example.com",
        normalizedPath: "/stale",
        title: "Stale",
      },
      snapshotPath: "/tmp/stale-snapshot.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    const result = await openWorkspaceFlow({ workspaceRef: "agent_main" }, harness.deps);

    assert.equal(harness.openWorkspaceTabCalls, 1);
    assert.equal(result.workspaceRef, "agent_main");
    assert.equal(result.tabRef, undefined);
    assert.equal(result.page.normalizedPath, "/workspace");

    const workspace = await harness.workspaceState.readWorkspace("agent_main");
    const workspaceTab = await harness.workspaceState.readWorkspaceTab("agent_main", "workspace_tab_cached");
    assert.equal(workspace.browserTabIndex, 7);
    assert.equal(workspace.page.normalizedPath, "/workspace");
    assert.equal(workspaceTab.browserTabIndex, 7);
    assert.equal(workspaceTab.page.normalizedPath, "/workspace");
  } finally {
    await harness.cleanup();
  }
});

test("openWorkspaceFlow creates a new workspace tab for a first-time workspaceRef", async () => {
  const harness = await createHarness({
    openWorkspaceTab: async () => ({
      pageId: 7,
      pageListText: "## Pages\n7: https://example.com/workspace [selected]",
    }),
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });
      return {
        content: [
          {
            type: "text",
            text: "## Pages\n7: https://example.com/workspace [selected]",
          },
        ],
      };
    },
    captureSnapshot: async () =>
      "## Latest page snapshot\nuid=7_0 RootWebArea \"Workspace\" url=\"https://example.com/workspace\"",
    readActiveTabIndex: async () => {
      throw new Error("readActiveTabIndex should not be used for a first-time workspace open flow");
    },
  });

  try {
    const result = await openWorkspaceFlow({ workspaceRef: "agent_main" }, harness.deps);

    assert.equal(harness.openWorkspaceTabCalls, 1);
    assert.deepEqual(harness.browserCalls, []);
    assert.equal(result.workspaceRef, "agent_main");
    assert.equal(result.tabRef, undefined);
    assert.match(result.summary, /workspace tab/i);

    const binding = await harness.workspaceBindings.read("agent_main");
    assert.equal(binding.browserTabIndex, 7);
  } finally {
    await harness.cleanup();
  }
});

test("openWorkspaceFlow refreshes an existing workspaceRef binding without opening another workspace tab", async () => {
  const harness = await createHarness({
    openWorkspaceTab: async () => ({
      pageId: 9,
      pageListText: "## Pages\n9: https://example.com/unused [selected]",
    }),
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });
      return {
        content: [
          {
            type: "text",
            text: "## Pages\n4: https://example.com/inbox [selected]",
          },
        ],
      };
    },
    captureSnapshot: async () =>
      "## Latest page snapshot\nuid=4_0 RootWebArea \"Inbox\" url=\"https://example.com/inbox\"",
    readActiveTabIndex: async () => {
      throw new Error("readActiveTabIndex should not be used for an existing binding");
    },
  });

  try {
    await harness.workspaceState.writeWorkspace({
      workspaceRef: "agent_main",
      browserTabIndex: 4,
      activeWorkspaceTabRef: "workspace_tab_inbox",
      page: {
        origin: "https://example.com",
        normalizedPath: "/inbox",
        title: "Inbox",
      },
      snapshotPath: "/tmp/previous-snapshot.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    await harness.workspaceState.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_inbox",
      browserTabIndex: 4,
      page: {
        origin: "https://example.com",
        normalizedPath: "/inbox",
        title: "Inbox",
      },
      snapshotPath: "/tmp/previous-snapshot.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const result = await openWorkspaceFlow({ workspaceRef: "agent_main" }, harness.deps);

    assert.equal(harness.openWorkspaceTabCalls, 0);
    assert.deepEqual(harness.browserCalls, [
      {
        name: "select_page",
        args: {
          pageId: 4,
          bringToFront: false,
        },
      },
    ]);
    assert.match(result.summary, /refreshed/i);
  } finally {
    await harness.cleanup();
  }
});

test("openWorkspaceFlow rebinds a stale workspaceRef when the previously selected page no longer exists", async () => {
  const harness = await createHarness({
    openWorkspaceTab: async () => ({
      pageId: 8,
      pageListText: "## Pages\n8: https://example.com/rebound [selected]",
    }),
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });
      if (name === "select_page") {
        throw new Error("No page found for pageId 25");
      }
      return {
        content: [
          {
            type: "text",
            text: "## Pages\n8: https://example.com/rebound [selected]",
          },
        ],
      };
    },
    captureSnapshot: async () =>
      "## Latest page snapshot\nuid=8_0 RootWebArea \"Rebound\" url=\"https://example.com/rebound\"",
    readActiveTabIndex: async () => {
      throw new Error("readActiveTabIndex should not be used when rebinding a stale workspaceRef");
    },
  });

  try {
    await harness.workspaceState.writeWorkspace({
      workspaceRef: "x-work",
      activeWorkspaceTabRef: "workspace_tab_old",
      page: {
        origin: "https://x.com",
        normalizedPath: "/old/path",
        title: "(3) X",
      },
      browserTabIndex: 25,
      snapshotPath: "/tmp/previous-snapshot.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    await harness.workspaceState.writeWorkspaceTab({
      workspaceRef: "x-work",
      workspaceTabRef: "workspace_tab_old",
      browserTabIndex: 25,
      page: {
        origin: "https://x.com",
        normalizedPath: "/old/path",
        title: "(3) X",
      },
      snapshotPath: "/tmp/previous-snapshot.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const result = await openWorkspaceFlow({ workspaceRef: "x-work" }, harness.deps);

    assert.equal(harness.openWorkspaceTabCalls, 1);
    assert.deepEqual(harness.browserCalls, [
      {
        name: "select_page",
        args: {
          pageId: 25,
          bringToFront: false,
        },
      },
    ]);
    assert.equal(result.workspaceRef, "x-work");
    assert.equal(result.tabRef, undefined);
    assert.match(result.summary, /workspace tab/i);

    const binding = await harness.workspaceBindings.read("x-work");
    assert.equal(binding.browserTabIndex, 8);
    assert.equal(binding.page.normalizedPath, "/rebound");
  } finally {
    await harness.cleanup();
  }
});

test("openWorkspaceFlow loads knowledge hits for the captured page identity", async () => {
  const harness = await createHarness(
    {
      openWorkspaceTab: async () => ({
        pageId: 7,
        pageListText: "## Pages\n7: https://example.com/workspace [selected]",
      }),
      callBrowserTool: async () => ({
        content: [
          {
            type: "text",
            text: "## Pages\n7: https://example.com/workspace [selected]",
          },
        ],
      }),
      captureSnapshot: async () =>
        "## Latest page snapshot\nuid=7_0 RootWebArea \"Workspace\" url=\"https://example.com/workspace\"",
      readActiveTabIndex: async () => 7,
    },
    {
      knowledgeRecords: [
        {
          id: "knowledge_workspace",
          page: {
            origin: "https://example.com",
            normalizedPath: "/workspace",
          },
          guide: "The primary CTA is in the workspace header.",
          keywords: ["workspace", "header", "CTA"],
          createdAt: "2026-03-31T00:00:00.000Z",
          updatedAt: "2026-03-31T00:00:00.000Z",
        },
      ],
    },
  );

  try {
    const result = await openWorkspaceFlow({ workspaceRef: "agent_main" }, harness.deps);

    assert.equal(result.knowledgeHits.length, 1);
    assert.equal(result.knowledgeHits[0]?.guide, "The primary CTA is in the workspace header.");
    assert.deepEqual(result.knowledgeHits[0]?.keywords, ["workspace", "header", "CTA"]);
  } finally {
      await harness.cleanup();
  }
});

test("runWorkspaceAction resolves its target from workspace.activeWorkspaceTabRef instead of the cached binding", async () => {
  const harness = await createHarness({
    captureSnapshot: async () => {
      const activePage = 4;
      return [
        "## Latest page snapshot",
        `uid=${activePage}_0 RootWebArea "Details" url="https://example.com/details"`,
        `  uid=${activePage}_1 button "Reply"`,
      ].join("\n");
    },
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });

      if (name === "select_page") {
        const currentPageId = args.pageId;
        return {
          content: [
            {
              type: "text",
              text: [
                "## Pages",
                `- 1 [Inbox](https://example.com/inbox)${currentPageId === 1 ? " (current)" : ""}`,
                `- 4 [Details](https://example.com/details)${currentPageId === 4 ? " (current)" : ""}`,
              ].join("\n"),
            },
          ],
        };
      }

      if (name === "press_key") {
        return {
          content: [
            {
              type: "text",
              text: "press complete",
            },
          ],
        };
      }

      if (name === "list_pages") {
        return {
          content: [
            {
              type: "text",
              text: [
                "## Pages",
                `- 1 [Inbox](https://example.com/inbox)`,
                `- 4 [Details](https://example.com/details) (current)`,
              ].join("\n"),
            },
          ],
        };
      }

      throw new Error(`unexpected browser tool ${name}`);
    },
    readActiveTabIndex: async () => 4,
    openWorkspaceTab: async () => ({
      pageId: 4,
      pageListText: [
        "## Pages",
        "- 1 [Inbox](https://example.com/inbox)",
        "- 4 [Details](https://example.com/details) (current)",
      ].join("\n"),
    }),
  });

  try {
    await harness.workspaceBindings.write({
      workspaceRef: "agent_main",
      browserTabIndex: 1,
      snapshotPath: "/tmp/inbox.md",
      page: {
        origin: "https://example.com",
        normalizedPath: "/inbox",
        title: "Inbox",
      },
    });

    await harness.workspaceState.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_details",
      browserTabIndex: 4,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details",
        title: "Details",
      },
      snapshotPath: "/tmp/details.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    await harness.workspaceState.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_details",
      browserTabIndex: 4,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details",
        title: "Details",
      },
      snapshotPath: "/tmp/details.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const result = await runWorkspaceAction(
      {
        action: "press",
        workspaceRef: "agent_main",
        toolName: "press_key",
        toolArgs: {
          key: "Enter",
        },
      },
      harness.deps,
    );

    assert.equal(
      harness.browserCalls
        .filter((call) => call.name === "select_page")
        .some((call) => call.args.pageId === 1),
      false,
    );
    assert.equal(result.workspaceTabRef, "workspace_tab_details");
    assert.equal(result.page.normalizedPath, "/details");
  } finally {
    await harness.cleanup();
  }
});

async function createHarness(runtime, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-action-"));
  const workspaceBindings = new WorkspaceBindingStore(path.join(root, "workspace-bindings"));
  const workspaceState = new WorkspaceStore(path.join(root, "workspace-state"));
  const snapshots = new SnapshotStore(path.join(root, "snapshots"), {
    ttlMs: 60_000,
  });
  const browserCalls = [];
  let openWorkspaceTabCalls = 0;

  return {
    deps: {
      browser: {
        captureSnapshot: async () => runtime.captureSnapshot(),
        callBrowserTool: async (name, args) => runtime.callBrowserTool(name, args),
        readActiveTabIndex: async () => runtime.readActiveTabIndex(),
        openWorkspaceTab: async () => {
          openWorkspaceTabCalls += 1;
          return runtime.openWorkspaceTab();
        },
      },
      workspaceBindings,
      workspaceState,
      snapshots,
      knowledge: {
        queryByPage: async (page) =>
          (options.knowledgeRecords ?? []).filter(
            (record) =>
              record.page.origin === page.origin && record.page.normalizedPath === page.normalizedPath,
          ),
      },
    },
    workspaceBindings,
    workspaceState,
    browserCalls,
    get openWorkspaceTabCalls() {
      return openWorkspaceTabCalls;
    },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
