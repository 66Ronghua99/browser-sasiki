import { randomUUID } from "node:crypto";

import { pageIdentityFromUrl } from "./page-identity.mjs";

export async function preSyncWorkspace(input, options = {}) {
  assertPreSyncInput(input);

  const timestamp = resolveTimestamp(options);
  const workspace = await readWorkspaceOrUndefined(input.workspaceState, input.workspaceRef);
  const existingTabs = await input.workspaceState.listWorkspaceTabs(input.workspaceRef);
  const livePagesByTargetId = new Map(input.livePages.map((page) => [page.targetId, cloneLivePage(page)]));
  const workspaceTabsByRef = new Map();

  for (const existingTab of existingTabs) {
    const livePage = livePagesByTargetId.get(existingTab.targetId);
    const nextRecord = livePage
      ? {
        ...existingTab,
        status: "open",
        browserTabIndex: livePage.pageId,
        page: pageIdentityFromUrl(livePage.url, livePage.title),
        updatedAt: timestamp,
      }
      : {
        ...existingTab,
        status: "closed",
        browserTabIndex: undefined,
        updatedAt: timestamp,
      };
    await input.workspaceState.writeWorkspaceTab(nextRecord);
    workspaceTabsByRef.set(nextRecord.workspaceTabRef, nextRecord);
  }

  if (!workspace) {
    return {
      workspace: undefined,
      workspaceTabsByRef,
      livePagesByTargetId,
    };
  }

  const activeWorkspaceTabRef = resolveActiveWorkspaceTabRef({
    workspace,
    requestedWorkspaceTabRef: input.requestedWorkspaceTabRef,
    workspaceTabsByRef,
  });
  const activeWorkspaceTab = activeWorkspaceTabRef
    ? workspaceTabsByRef.get(activeWorkspaceTabRef)
    : undefined;
  const persistedWorkspace = activeWorkspaceTab?.status === "open"
    ? {
      ...workspace,
      activeWorkspaceTabRef,
      browserTabIndex: activeWorkspaceTab.browserTabIndex,
      page: clonePageIdentity(activeWorkspaceTab.page),
      snapshotPath: activeWorkspaceTab.snapshotPath,
      updatedAt: timestamp,
    }
    : {
      ...workspace,
      updatedAt: timestamp,
    };

  await input.workspaceState.writeWorkspace(persistedWorkspace);

  return {
    workspace: persistedWorkspace,
    workspaceTabsByRef,
    livePagesByTargetId,
  };
}

export async function postSyncWorkspace(input, options = {}) {
  assertPostSyncInput(input);

  const timestamp = resolveTimestamp(options);
  const preSyncTargetIds = new Set(input.preSyncPages.map((page) => page.targetId));
  const preSyncResult = await preSyncWorkspace(
    {
      workspaceRef: input.workspaceRef,
      requestedWorkspaceTabRef: input.actionTarget?.workspaceTabRef,
      workspaceState: input.workspaceState,
      livePages: input.postSyncPages,
    },
    { now: () => timestamp },
  );
  let workspace = preSyncResult.workspace;
  const workspaceTabsByRef = new Map(preSyncResult.workspaceTabsByRef);

  const adoptedCandidates = input.postSyncPages.filter(
    (page) => !preSyncTargetIds.has(page.targetId) && page.openerId === input.actionTarget.targetId,
  );
  let adoptedWorkspaceTab;

  if (adoptedCandidates.length === 1) {
    const adoptedPage = adoptedCandidates[0];
    const actionWorkspaceTab = workspaceTabsByRef.get(input.actionTarget.workspaceTabRef);
    adoptedWorkspaceTab = {
      workspaceRef: input.workspaceRef,
      workspaceTabRef: `workspace_tab_${randomUUID()}`,
      targetId: adoptedPage.targetId,
      status: "open",
      browserTabIndex: adoptedPage.pageId,
      page: pageIdentityFromUrl(adoptedPage.url, adoptedPage.title),
      snapshotPath: actionWorkspaceTab?.snapshotPath ?? workspace?.snapshotPath ?? "/tmp/live-workspace-sync.md",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await input.workspaceState.writeWorkspaceTab(adoptedWorkspaceTab);
    workspaceTabsByRef.set(adoptedWorkspaceTab.workspaceTabRef, adoptedWorkspaceTab);

    if (!workspace) {
      throw new Error(`Workspace ${input.workspaceRef} does not exist`);
    }

    workspace = {
      ...workspace,
      activeWorkspaceTabRef: adoptedWorkspaceTab.workspaceTabRef,
      browserTabIndex: adoptedWorkspaceTab.browserTabIndex,
      page: clonePageIdentity(adoptedWorkspaceTab.page),
      snapshotPath: adoptedWorkspaceTab.snapshotPath,
      updatedAt: timestamp,
    };
    await input.workspaceState.writeWorkspace(workspace);
  }

  return {
    workspace,
    workspaceTabsByRef,
    adoptedWorkspaceTab,
  };
}

function resolveActiveWorkspaceTabRef(input) {
  const current = input.workspaceTabsByRef.get(input.workspace.activeWorkspaceTabRef);
  if (current?.status === "open") {
    return current.workspaceTabRef;
  }

  if (input.requestedWorkspaceTabRef) {
    const requested = input.workspaceTabsByRef.get(input.requestedWorkspaceTabRef);
    if (requested?.status === "open") {
      return requested.workspaceTabRef;
    }
  }

  const openTabs = [...input.workspaceTabsByRef.values()].filter((tab) => tab.status === "open");
  if (openTabs.length === 1) {
    return openTabs[0].workspaceTabRef;
  }

  return input.workspace.activeWorkspaceTabRef;
}

async function readWorkspaceOrUndefined(workspaceState, workspaceRef) {
  try {
    return await workspaceState.readWorkspace(workspaceRef);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

function cloneLivePage(page) {
  return {
    pageId: page.pageId,
    targetId: page.targetId,
    openerId: page.openerId,
    url: page.url,
    title: page.title,
  };
}

function clonePageIdentity(page) {
  return {
    origin: page.origin,
    normalizedPath: page.normalizedPath,
    title: page.title,
  };
}

function assertPreSyncInput(input) {
  assertRecord(input, "input");
  assertNonEmptyString(input.workspaceRef, "workspaceRef");
  assertWorkspaceState(input.workspaceState);
  assertLivePages(input.livePages, "livePages");
  if (input.requestedWorkspaceTabRef !== undefined) {
    assertNonEmptyString(input.requestedWorkspaceTabRef, "requestedWorkspaceTabRef");
  }
}

function assertPostSyncInput(input) {
  assertPreSyncInput({
    workspaceRef: input.workspaceRef,
    workspaceState: input.workspaceState,
    livePages: input.postSyncPages,
    requestedWorkspaceTabRef: input.actionTarget?.workspaceTabRef,
  });
  assertLivePages(input.preSyncPages, "preSyncPages");
  assertRecord(input.actionTarget, "actionTarget");
  assertNonEmptyString(input.actionTarget.workspaceTabRef, "actionTarget.workspaceTabRef");
  assertNonEmptyString(input.actionTarget.targetId, "actionTarget.targetId");
}

function assertWorkspaceState(value) {
  if (!value || typeof value.readWorkspace !== "function" || typeof value.listWorkspaceTabs !== "function") {
    throw new TypeError("workspaceState must expose readWorkspace() and listWorkspaceTabs()");
  }
  if (typeof value.writeWorkspace !== "function" || typeof value.writeWorkspaceTab !== "function") {
    throw new TypeError("workspaceState must expose writeWorkspace() and writeWorkspaceTab()");
  }
}

function assertLivePages(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array`);
  }

  for (const page of value) {
    assertRecord(page, "live page");
    assertNonNegativeInteger(page.pageId, "live page pageId");
    assertNonEmptyString(page.targetId, "live page targetId");
    if (page.openerId !== undefined && page.openerId !== "") {
      assertNonEmptyString(page.openerId, "live page openerId");
    }
    assertNonEmptyString(page.url, "live page url");
    assertNonEmptyString(page.title, "live page title");
  }
}

function resolveTimestamp(options) {
  return typeof options.now === "function" ? options.now() : new Date().toISOString();
}

function assertRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
