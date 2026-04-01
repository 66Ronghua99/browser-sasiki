import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { preSyncWorkspace, postSyncWorkspace } from "../../scripts/workspace-live-sync.mjs";
import { WorkspaceStore } from "../../scripts/workspace-store.mjs";

test("pre-sync marks a workspace tab closed when its targetId disappears from the live browser inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-workspace-live-sync-"));
  const store = new WorkspaceStore(path.join(root, "workspace-state"));

  try {
    await seedWorkspace(store, {
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
    await seedWorkspaceTab(store, {
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_home",
      targetId: "page-home",
      status: "open",
      browserTabIndex: 0,
      page: {
        origin: "https://example.com",
        normalizedPath: "/home",
        title: "Home",
      },
      snapshotPath: "/tmp/home.md",
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    await seedWorkspaceTab(store, {
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_details",
      targetId: "page-details",
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

    const result = await preSyncWorkspace({
      workspaceRef: "agent_main",
      requestedWorkspaceTabRef: undefined,
      workspaceState: store,
      livePages: [
        {
          pageId: 0,
          targetId: "page-home",
          openerId: "",
          url: "https://example.com/home",
          title: "Home",
        },
      ],
    });

    assert.equal(result.workspace.activeWorkspaceTabRef, "workspace_tab_home");
    assert.equal(result.workspace.page.normalizedPath, "/home");
    assert.equal(result.workspaceTabsByRef.get("workspace_tab_home")?.status, "open");
    assert.equal(result.workspaceTabsByRef.get("workspace_tab_home")?.browserTabIndex, 0);
    assert.equal(result.workspaceTabsByRef.get("workspace_tab_details")?.status, "closed");
    assert.equal(result.workspaceTabsByRef.get("workspace_tab_details")?.browserTabIndex, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-sync adopts a newly opened page when openerId points at the acting workspace tab", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-workspace-live-sync-"));
  const store = new WorkspaceStore(path.join(root, "workspace-state"));

  try {
    await seedWorkspace(store, {
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
    await seedWorkspaceTab(store, {
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_home",
      targetId: "page-home",
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

    const result = await postSyncWorkspace({
      workspaceRef: "agent_main",
      workspaceState: store,
      preSyncPages: [
        {
          pageId: 1,
          targetId: "page-home",
          openerId: "",
          url: "https://example.com/home",
          title: "Home",
        },
      ],
      postSyncPages: [
        {
          pageId: 1,
          targetId: "page-home",
          openerId: "",
          url: "https://example.com/home",
          title: "Home",
        },
        {
          pageId: 2,
          targetId: "page-thread",
          openerId: "page-home",
          url: "https://example.com/thread/42",
          title: "Thread",
        },
      ],
      actionTarget: {
        workspaceTabRef: "workspace_tab_home",
        targetId: "page-home",
      },
    });

    assert.ok(result.adoptedWorkspaceTab);
    assert.equal(result.workspace.activeWorkspaceTabRef, result.adoptedWorkspaceTab.workspaceTabRef);
    assert.equal(result.adoptedWorkspaceTab.targetId, "page-thread");
    assert.equal(result.adoptedWorkspaceTab.browserTabIndex, 2);
    assert.equal(result.adoptedWorkspaceTab.status, "open");

    const persistedTabs = await store.listWorkspaceTabs("agent_main");
    assert.equal(persistedTabs.length, 2);
    assert.equal(
      persistedTabs.find((tab) => tab.workspaceTabRef === "workspace_tab_home")?.status,
      "open",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function seedWorkspace(store, record) {
  await store.writeWorkspace(record);
}

async function seedWorkspaceTab(store, record) {
  await store.writeWorkspaceTab(record);
}
