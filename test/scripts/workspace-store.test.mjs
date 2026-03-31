import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceStore } from "../../scripts/workspace-store.mjs";
import { WorkspaceReconciler } from "../../scripts/workspace-reconciler.mjs";

test("workspace store round-trips workspace and workspace-tab state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-workspace-store-"));
  const store = new WorkspaceStore(path.join(root, "workspace-state"));

  try {
    await store.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_demo",
      browserTabIndex: 7,
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace",
        title: "Workspace",
      },
      snapshotPath: "/tmp/live-snapshot.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    await store.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_demo",
      browserTabIndex: 7,
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace",
        title: "Workspace",
      },
      snapshotPath: "/tmp/live-snapshot.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    const workspace = await store.readWorkspace("agent_main");
    const workspaceTab = await store.readWorkspaceTab("agent_main", "workspace_tab_demo");
    const workspaceTabs = await store.listWorkspaceTabs("agent_main");

    assert.deepEqual(workspace, {
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_demo",
      browserTabIndex: 7,
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace",
        title: "Workspace",
      },
      snapshotPath: "/tmp/live-snapshot.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    assert.deepEqual(workspaceTab, {
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_demo",
      browserTabIndex: 7,
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace",
        title: "Workspace",
      },
      snapshotPath: "/tmp/live-snapshot.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });
    assert.deepEqual(workspaceTabs, [workspaceTab]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace reconciler keeps the cached workspace-tab identity but overwrites stale live state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-workspace-reconciler-"));
  const store = new WorkspaceStore(path.join(root, "workspace-state"));
  const reconciler = new WorkspaceReconciler(store);

  try {
    await store.writeWorkspace({
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

    await store.writeWorkspaceTab({
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

    const result = await reconciler.reconcileWorkspace({
      workspaceRef: "agent_main",
      browserTabIndex: 7,
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace",
        title: "Workspace",
      },
      snapshotPath: "/tmp/live-snapshot.md",
    });

    assert.equal(result.workspace.activeWorkspaceTabRef, "workspace_tab_cached");
    assert.equal(result.workspace.browserTabIndex, 7);
    assert.equal(result.workspace.page.normalizedPath, "/workspace");

    const cachedWorkspace = await store.readWorkspace("agent_main");
    const cachedWorkspaceTab = await store.readWorkspaceTab("agent_main", "workspace_tab_cached");
    assert.equal(cachedWorkspace.browserTabIndex, 7);
    assert.equal(cachedWorkspace.page.normalizedPath, "/workspace");
    assert.equal(cachedWorkspaceTab.browserTabIndex, 7);
    assert.equal(cachedWorkspaceTab.page.normalizedPath, "/workspace");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
