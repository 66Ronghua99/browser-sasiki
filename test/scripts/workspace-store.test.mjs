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
      targetId: "page-home-stable",
      status: "open",
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
      targetId: "page-home-stable",
      status: "open",
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

test("workspace store requires targetId and status on workspace-tab records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-workspace-tab-record-"));
  const store = new WorkspaceStore(path.join(root, "workspace-state"));

  try {
    await assert.rejects(() =>
      store.writeWorkspaceTab({
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
      }),
      /targetId|status/i,
    );

    await assert.rejects(() =>
      store.writeWorkspaceTab({
        workspaceRef: "agent_main",
        workspaceTabRef: "workspace_tab_demo",
        targetId: "page-home",
        browserTabIndex: 7,
        page: {
          origin: "https://example.com",
          normalizedPath: "/workspace",
          title: "Workspace",
        },
        snapshotPath: "/tmp/live-snapshot.md",
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
      /status/i,
    );

    await assert.rejects(() =>
      store.writeWorkspaceTab({
        workspaceRef: "agent_main",
        workspaceTabRef: "workspace_tab_demo",
        targetId: "page-home",
        status: "pending",
        browserTabIndex: 7,
        page: {
          origin: "https://example.com",
          normalizedPath: "/workspace",
          title: "Workspace",
        },
        snapshotPath: "/tmp/live-snapshot.md",
        createdAt: "2026-03-31T00:00:00.000Z",
        updatedAt: "2026-03-31T00:00:00.000Z",
      }),
      /status must be "open" or "closed"/i,
    );

    await store.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_demo",
      targetId: "page-home",
      status: "closed",
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

    const workspaceTab = await store.readWorkspaceTab("agent_main", "workspace_tab_demo");
    assert.equal(workspaceTab.targetId, "page-home");
    assert.equal(workspaceTab.status, "closed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace reconciler keeps an explicitly requested workspace-tab identity while overwriting stale live state", async () => {
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
      targetId: "page-home-stable",
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

    const result = await reconciler.reconcileWorkspace({
      workspaceRef: "agent_main",
      browserTabIndex: 7,
      page: {
        origin: "https://example.com",
        normalizedPath: "/workspace",
        title: "Workspace",
      },
      snapshotPath: "/tmp/live-snapshot.md",
      workspaceTabRef: "workspace_tab_cached",
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

test("workspace reconciler mints a fresh workspace-tab identity when live state switches onto an unbound browser tab", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-workspace-reconciler-"));
  const store = new WorkspaceStore(path.join(root, "workspace-state"));
  const reconciler = new WorkspaceReconciler(store);

  try {
    await store.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_original",
      browserTabIndex: 3,
      page: {
        origin: "https://example.com",
        normalizedPath: "/inbox",
        title: "Inbox",
      },
      snapshotPath: "/tmp/inbox.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    await store.writeWorkspaceTab({
      workspaceRef: "agent_main",
      workspaceTabRef: "workspace_tab_original",
      targetId: "page-inbox-stable",
      status: "open",
      browserTabIndex: 3,
      page: {
        origin: "https://example.com",
        normalizedPath: "/inbox",
        title: "Inbox",
      },
      snapshotPath: "/tmp/inbox.md",
      createdAt: "2026-03-31T00:00:00.000Z",
      updatedAt: "2026-03-31T00:00:00.000Z",
    });

    const result = await reconciler.reconcileWorkspace({
      workspaceRef: "agent_main",
      browserTabIndex: 9,
      page: {
        origin: "https://example.com",
        normalizedPath: "/details",
        title: "Details",
      },
      snapshotPath: "/tmp/details.md",
    });

    assert.notEqual(result.workspace.activeWorkspaceTabRef, "workspace_tab_original");
    assert.match(result.workspace.activeWorkspaceTabRef, /^workspace_tab_[0-9a-f-]+$/i);
    assert.equal(result.workspace.browserTabIndex, 9);
    assert.equal(result.workspace.page.normalizedPath, "/details");

    const originalTab = await store.readWorkspaceTab("agent_main", "workspace_tab_original");
    const newTab = await store.readWorkspaceTab("agent_main", result.workspace.activeWorkspaceTabRef);
    const workspaceTabs = await store.listWorkspaceTabs("agent_main");

    assert.equal(originalTab.browserTabIndex, 3);
    assert.equal(originalTab.page.normalizedPath, "/inbox");
    assert.equal(newTab.browserTabIndex, 9);
    assert.equal(newTab.page.normalizedPath, "/details");
    assert.equal(workspaceTabs.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace reconciler does not reuse a stale workspace.activeWorkspaceTabRef when no workspace-tab record exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-workspace-reconciler-"));
  const store = new WorkspaceStore(path.join(root, "workspace-state"));
  const reconciler = new WorkspaceReconciler(store);

  try {
    await store.writeWorkspace({
      workspaceRef: "agent_main",
      activeWorkspaceTabRef: "workspace_tab_stale",
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
        normalizedPath: "/details",
        title: "Details",
      },
      snapshotPath: "/tmp/details.md",
    });

    assert.notEqual(result.workspace.activeWorkspaceTabRef, "workspace_tab_stale");
    assert.equal(result.workspace.browserTabIndex, 7);
    assert.equal(result.workspace.page.normalizedPath, "/details");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
