import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openWorkspaceFlow, refreshWorkspaceSnapshot, runWorkspaceAction } from "../../scripts/browser-action.mjs";
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
    listLivePageInventory: async () => [
      {
        pageId: 7,
        targetId: "target-workspace",
        openerId: "",
        url: "https://example.com/workspace",
        title: "Workspace",
      },
    ],
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
    captureSnapshotForPage: async () =>
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
      targetId: "target-stale-page",
      status: "open",
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
    listLivePageInventory: async () => [
      {
        pageId: 7,
        targetId: "target-workspace",
        openerId: "",
        url: "https://example.com/workspace",
        title: "Workspace",
      },
    ],
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
    captureSnapshotForPage: async () =>
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
    listLivePageInventory: async () => [
      {
        pageId: 4,
        targetId: "target-inbox-page",
        openerId: "",
        url: "https://example.com/inbox",
        title: "Inbox",
      },
    ],
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
    captureSnapshotForPage: async () =>
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
      targetId: "target-inbox-page",
      status: "open",
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
    listLivePageInventory: async () => [
      {
        pageId: 8,
        targetId: "target-rebound-page",
        openerId: "",
        url: "https://example.com/rebound",
        title: "Rebound",
      },
    ],
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
    captureSnapshotForPage: async () =>
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
      targetId: "target-old-page",
      status: "open",
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
    assert.deepEqual(harness.browserCalls, []);
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

test("openWorkspaceFlow rebinds immediately when the persisted targetId disappears from live inventory", async () => {
  const harness = await createHarness({
    openWorkspaceTab: async () => ({
      pageId: 8,
      targetId: "target-rebound-page",
      pageListText: "## Pages\n8: https://example.com/rebound [selected]",
    }),
    listLivePageInventory: async () => [
      {
        pageId: 25,
        targetId: "target-someone-else",
        openerId: "",
        url: "https://example.com/old",
        title: "Old",
      },
      {
        pageId: 8,
        targetId: "target-rebound-page",
        openerId: "",
        url: "https://example.com/rebound",
        title: "Rebound",
      },
    ],
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });
      if (name === "select_page") {
        throw new Error("select_page should not be used when the persisted targetId is already stale");
      }
      throw new Error(`unexpected browser tool ${name}`);
    },
    captureSnapshotForPage: async (pageId) => {
      assert.equal(pageId, 8);
      return "## Latest page snapshot\nuid=8_0 RootWebArea \"Rebound\" url=\"https://example.com/rebound\"";
    },
    readActiveTabIndex: async () => {
      throw new Error("readActiveTabIndex should not be used when rebinding a stale targetId");
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
      targetId: "target-old-page",
      status: "open",
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
    assert.deepEqual(harness.browserCalls, []);
    assert.equal(result.page.normalizedPath, "/rebound");
  } finally {
    await harness.cleanup();
  }
});

test("openWorkspaceFlow surfaces a workspace-domain stale-tab error when an explicit workspaceTabRef record is missing", async () => {
  const harness = await createHarness({
    openWorkspaceTab: async () => {
      throw new Error("openWorkspaceTab should not run for a stale explicit workspaceTabRef");
    },
    listLivePageInventory: async () => [
      {
        pageId: 4,
        targetId: "target-inbox-page",
        openerId: "",
        url: "https://example.com/inbox",
        title: "Inbox",
      },
    ],
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });
      throw new Error(`unexpected browser tool ${name}`);
    },
    captureSnapshotForPage: async () => {
      throw new Error("captureSnapshotForPage should not run for a stale explicit workspaceTabRef");
    },
    readActiveTabIndex: async () => {
      throw new Error("readActiveTabIndex should not run for a stale explicit workspaceTabRef");
    },
  });

  try {
    await harness.workspaceState.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_live",
      browserTabIndex: 4,
      page: {
        origin: "https://example.com",
        normalizedPath: "/inbox",
        title: "Inbox",
      },
      snapshotPath: "/tmp/inbox.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    await assert.rejects(
      () =>
        openWorkspaceFlow(
          {
            workspaceRef: "agent_main",
            workspaceTabRef: "workspace_tab_missing",
          },
          harness.deps,
        ),
      /workspaceTabRef workspace_tab_missing is not available in workspace agent_main; call GET \/tabs\?workspaceRef=agent_main to refresh the workspace tab list\./i,
    );
    assert.deepEqual(harness.browserCalls, []);
    assert.equal(harness.openWorkspaceTabCalls, 0);
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
      listLivePageInventory: async () => [
        {
          pageId: 7,
          targetId: "target-workspace",
          openerId: "",
          url: "https://example.com/workspace",
          title: "Workspace",
        },
      ],
      captureSnapshotForPage: async () =>
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
    captureSnapshotForPage: async (pageId) => {
      assert.equal(pageId, 4);
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
    listLivePageInventory: async () => [
      {
        pageId: 1,
        targetId: "target-inbox-page",
        openerId: "",
        url: "https://example.com/inbox",
        title: "Inbox",
      },
      {
        pageId: 4,
        targetId: "target-details-page",
        openerId: "",
        url: "https://example.com/details",
        title: "Details",
      },
    ],
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
      targetId: "target-details-page",
      status: "open",
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

test("runWorkspaceAction keeps workspaceTabRef when the same targetId survives with a shifted page index", async () => {
  const stableTargetId = "target-details-live";

  const harness = await createHarness({
    captureSnapshotForPage: async (pageId) =>
      [
        "## Latest page snapshot",
        `uid=${pageId}_0 RootWebArea "Details" url="https://example.com/details"`,
        `  uid=${pageId}_1 button "Reply"`,
      ].join("\n"),
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });

      if (name === "select_page") {
        if (args.pageId === 2) {
              return {
                content: [
                  {
                    type: "text",
                    text: [
                      "## Pages",
                      "- 1 [Details](https://example.com/details)",
                      "- 2 [Details](https://example.com/details) (current)",
                      "- 3 [Draft](https://example.com/draft)",
                    ].join("\n"),
                  },
                ],
              };
        }

        return {
          content: [
            {
              type: "text",
              text: [
                "## Pages",
                "- 1 [Details](https://example.com/details) (current)",
                "- 2 [Draft](https://example.com/draft)",
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
                "- 1 [Details](https://example.com/details) (current)",
                "- 2 [Draft](https://example.com/draft)",
              ].join("\n"),
            },
          ],
        };
      }

      throw new Error(`unexpected browser tool ${name}`);
    },
    listLivePageInventory: async (callIndex) => {
      if (callIndex === 1) {
        return [
          {
            pageId: 2,
            targetId: stableTargetId,
            openerId: "page-home",
            url: "https://example.com/details",
            title: "Details",
          },
          {
            pageId: 1,
            targetId: "target-old-details",
            openerId: "page-home",
            url: "https://example.com/details",
            title: "Details",
          },
          {
            pageId: 3,
            targetId: "target-draft",
            openerId: "page-home",
            url: "https://example.com/draft",
            title: "Draft",
          },
        ];
      }

      return [
        {
          pageId: 1,
          targetId: stableTargetId,
          openerId: "page-home",
          url: "https://example.com/details",
          title: "Details",
        },
        {
          pageId: 2,
          targetId: "target-other",
          openerId: "page-home",
          url: "https://example.com/details",
          title: "Details",
        },
        {
          pageId: 3,
          targetId: "target-draft",
          openerId: "page-home",
          url: "https://example.com/draft",
          title: "Draft",
        },
      ];
    },
    readActiveTabIndex: async () => 1,
    openWorkspaceTab: async () => ({
      pageId: 2,
      pageListText: [
        "## Pages",
        "- 1 [Details](https://example.com/details)",
        "- 2 [Details](https://example.com/details) (current)",
        "- 3 [Draft](https://example.com/draft)",
      ].join("\n"),
    }),
  });

  try {
    await harness.workspaceState.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_stable",
      browserTabIndex: 2,
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
      workspaceTabRef: "workspace_tab_stable",
      targetId: stableTargetId,
      status: "open",
      browserTabIndex: 2,
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

    assert.ok(harness.listLivePageInventoryCalls >= 1);
    assert.equal(result.workspaceTabRef, "workspace_tab_stable");
    assert.equal(result.page.normalizedPath, "/details");

    const refreshedWorkspace = await harness.workspaceState.readWorkspace("agent_main");
    const refreshedTab = await harness.workspaceState.readWorkspaceTab("agent_main", "workspace_tab_stable");

    assert.equal(refreshedWorkspace.browserTabIndex, 1);
    assert.equal(refreshedWorkspace.activeWorkspaceTabRef, "workspace_tab_stable");
    assert.equal(refreshedTab.targetId, stableTargetId);
    assert.equal(refreshedTab.browserTabIndex, 1);
  } finally {
    await harness.cleanup();
  }
});

test("runWorkspaceAction captures the newly active existing workspace tab after an action changes focus", async () => {
  let activePageId = 1;
  const harness = await createHarness({
    captureSnapshotForPage: async (pageId) => {
      assert.equal(pageId, 2);
      return [
        "## Latest page snapshot",
        `uid=${pageId}_0 RootWebArea "Details" url="https://example.com/details"`,
        `  uid=${pageId}_1 button "Reply"`,
      ].join("\n");
    },
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });

      if (name === "click") {
        activePageId = 2;
        return {
          content: [
            {
              type: "text",
              text: "click complete",
            },
          ],
        };
      }

      throw new Error(`unexpected browser tool ${name}`);
    },
    listLivePageInventory: async () => [
      {
        pageId: 1,
        targetId: "target-home",
        openerId: "",
        url: "https://example.com/home",
        title: "Home",
      },
      {
        pageId: 2,
        targetId: "target-details",
        openerId: "",
        url: "https://example.com/details",
        title: "Details",
      },
    ],
    readActiveTabIndex: async () => activePageId,
    openWorkspaceTab: async () => {
      throw new Error("openWorkspaceTab should not run for an existing workspace action");
    },
  });

  try {
    await harness.workspaceState.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_home",
      browserTabIndex: 1,
      page: {
        origin: "https://example.com",
        normalizedPath: "/home",
        title: "Home",
      },
      snapshotPath: "/tmp/home.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    await harness.workspaceState.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_home",
      targetId: "target-home",
      status: "open",
      browserTabIndex: 1,
      page: {
        origin: "https://example.com",
        normalizedPath: "/home",
        title: "Home",
      },
      snapshotPath: "/tmp/home.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    await harness.workspaceState.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_details",
      targetId: "target-details",
      status: "open",
      browserTabIndex: 2,
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
        action: "click",
        workspaceRef: "agent_main",
        toolName: "click",
        toolArgs: {
          uid: "open_details",
        },
      },
      harness.deps,
    );

    assert.equal(result.workspaceTabRef, "workspace_tab_details");
    assert.equal(result.page.normalizedPath, "/details");

    const refreshedWorkspace = await harness.workspaceState.readWorkspace("agent_main");
    assert.equal(refreshedWorkspace.activeWorkspaceTabRef, "workspace_tab_details");
    assert.equal(refreshedWorkspace.browserTabIndex, 2);
  } finally {
    await harness.cleanup();
  }
});

test("runWorkspaceAction surfaces a stale target error instead of falling back to the cached browserTabIndex", async () => {
  const harness = await createHarness({
    captureSnapshotForPage: async () => {
      throw new Error("captureSnapshotForPage should not run when the workspace target is already stale");
    },
    callBrowserTool: async (name, args) => {
      harness.browserCalls.push({ name, args });
      throw new Error(`unexpected browser tool ${name}`);
    },
    listLivePageInventory: async () => [
      {
        pageId: 2,
        targetId: "target-someone-else",
        openerId: "",
        url: "https://example.com/details",
        title: "Details",
      },
    ],
    readActiveTabIndex: async () => {
      throw new Error("readActiveTabIndex should not be used for stale target resolution");
    },
    openWorkspaceTab: async () => {
      throw new Error("openWorkspaceTab should not run for stale action targets");
    },
  });

  try {
    await harness.workspaceState.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_stale",
      browserTabIndex: 2,
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
      workspaceTabRef: "workspace_tab_stale",
      targetId: "target-details-live",
      status: "open",
      browserTabIndex: 2,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details",
        title: "Details",
      },
      snapshotPath: "/tmp/details.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    await assert.rejects(
      () =>
        runWorkspaceAction(
          {
            action: "press",
            workspaceRef: "agent_main",
            toolName: "press_key",
            toolArgs: {
              key: "Enter",
            },
          },
          harness.deps,
        ),
      /targetId target-details-live is no longer present in the live browser inventory/i,
    );
    assert.deepEqual(harness.browserCalls, []);
  } finally {
    await harness.cleanup();
  }
});

test("refreshWorkspaceSnapshot captures an explicit workspaceTabRef without selecting the browser-global current page", async () => {
  const capturedPageIds = [];
  const harness = await createHarness({
    captureSnapshotForPage: async (pageId) => {
      capturedPageIds.push(pageId);
      return [
        "## Latest page snapshot",
        `uid=${pageId}_0 RootWebArea "Details" url="https://example.com/details"`,
      ].join("\n");
    },
    callBrowserTool: async (name) => {
      harness.browserCalls.push({ name, args: {} });
      throw new Error(`unexpected browser tool ${name}`);
    },
    listLivePageInventory: async () => [
      {
        pageId: 1,
        targetId: "target-home",
        openerId: "",
        url: "https://example.com/home",
        title: "Home",
      },
      {
        pageId: 2,
        targetId: "target-details",
        openerId: "",
        url: "https://example.com/details",
        title: "Details",
      },
    ],
    openWorkspaceTab: async () => ({
      pageId: 1,
      pageListText: [
        "## Pages",
        "- 1 (current) [Home](https://example.com/home)",
        "- 2 [Details](https://example.com/details)",
      ].join("\n"),
    }),
  });

  try {
    await harness.workspaceState.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_home",
      browserTabIndex: 1,
      page: {
        origin: "https://example.com",
        normalizedPath: "/home",
        title: "Home",
      },
      snapshotPath: "/tmp/home.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    await harness.workspaceState.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_home",
      targetId: "target-home",
      status: "open",
      browserTabIndex: 1,
      page: {
        origin: "https://example.com",
        normalizedPath: "/home",
        title: "Home",
      },
      snapshotPath: "/tmp/home.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    await harness.workspaceState.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_details",
      targetId: "target-details",
      status: "open",
      browserTabIndex: 2,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details",
        title: "Details",
      },
      snapshotPath: "/tmp/details.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });

    const result = await refreshWorkspaceSnapshot(
      {
        workspaceRef: "agent_main",
        workspaceTabRef: "workspace_tab_details",
      },
      harness.deps,
    );

    assert.deepEqual(harness.browserCalls, []);
    assert.deepEqual(capturedPageIds, [2]);
    assert.equal(result.workspaceTabRef, "workspace_tab_details");
    assert.equal(result.page.normalizedPath, "/details");

    const workspace = await harness.workspaceState.readWorkspace("agent_main");
    assert.equal(workspace.activeWorkspaceTabRef, "workspace_tab_details");
    assert.equal(workspace.browserTabIndex, 2);
  } finally {
    await harness.cleanup();
  }
});

test("refreshWorkspaceSnapshot creates a first-time workspace through the shared transaction path when creation is requested", async () => {
  const harness = await createHarness({
    captureSnapshotForPage: async (pageId) =>
      [
        "## Latest page snapshot",
        `uid=${pageId}_0 RootWebArea "Workspace" url="chrome://newtab/"`,
      ].join("\n"),
    callBrowserTool: async (name) => {
      harness.browserCalls.push({ name, args: {} });
      throw new Error(`unexpected browser tool ${name}`);
    },
    listLivePageInventory: async (callIndex) => {
      if (callIndex === 1) {
        return [];
      }

      return [
        {
          pageId: 7,
          targetId: "target-workspace",
          openerId: "",
          url: "chrome://newtab/",
          title: "Workspace",
        },
      ];
    },
    openWorkspaceTab: async () => ({
      pageId: 7,
      pageListText: "## Pages\n- 7 (current) [Workspace](chrome://newtab/)",
    }),
  });

  try {
    const result = await refreshWorkspaceSnapshot(
      {
        workspaceRef: "agent_main",
        createWorkspaceIfMissing: true,
      },
      harness.deps,
    );

    assert.equal(harness.openWorkspaceTabCalls, 1);
    assert.deepEqual(harness.browserCalls, []);
    assert.equal(result.workspaceRef, "agent_main");
    assert.equal(result.workspaceTabRef, undefined);
    assert.equal(result.page.title, "Workspace");

    const workspace = await harness.workspaceState.readWorkspace("agent_main");
    assert.equal(workspace.activeWorkspaceTabRef.startsWith("workspace_tab_"), true);
    assert.equal(workspace.browserTabIndex, 7);
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
  let listLivePageInventoryCalls = 0;

  return {
    deps: {
      browser: {
        captureSnapshot: async () => runtime.captureSnapshot(),
        captureSnapshotForPage: async (pageId) => {
          if (typeof runtime.captureSnapshotForPage === "function") {
            return runtime.captureSnapshotForPage(pageId);
          }
          return runtime.captureSnapshot();
        },
        callBrowserTool: async (name, args) => runtime.callBrowserTool(name, args),
        readActiveTabIndex: async () => runtime.readActiveTabIndex(),
        listLivePageInventory: async () => {
          listLivePageInventoryCalls += 1;
          const provider = runtime.listLivePageInventory ?? (() => runtime.livePageInventory ?? []);
          const callIndex = listLivePageInventoryCalls;
          return provider(callIndex);
        },
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
    get listLivePageInventoryCalls() {
      return listLivePageInventoryCalls;
    },
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
}
