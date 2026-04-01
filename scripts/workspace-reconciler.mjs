import { randomUUID } from "node:crypto";

export class WorkspaceReconciler {
  constructor(store, options = {}) {
    if (!store || typeof store.readWorkspace !== "function" || typeof store.writeWorkspace !== "function") {
      throw new TypeError("store must expose readWorkspace() and writeWorkspace()");
    }

    this.store = store;
    this.now = typeof options.now === "function" ? options.now : () => new Date().toISOString();
  }

  async reconcileWorkspace(input) {
    assertReconcileInput(input);

    const timestamp = this.now();
    const workspace = await this.readWorkspaceOrUndefined(input.workspaceRef);
    const workspaceTabs = await this.store.listWorkspaceTabs(input.workspaceRef);
    const matchingWorkspaceTab = workspaceTabs.find((tab) => tab.targetId === input.targetId);
    const requestedWorkspaceTab = input.workspaceTabRef
      ? workspaceTabs.find((tab) => tab.workspaceTabRef === input.workspaceTabRef)
      : undefined;
    const persistedWorkspaceTabRecord = matchingWorkspaceTab ?? requestedWorkspaceTab;
    const activeWorkspaceTabRef = persistedWorkspaceTabRecord?.workspaceTabRef ?? mintWorkspaceTabRef();

    const persistedWorkspace = {
      workspaceRef: input.workspaceRef,
      activeWorkspaceTabRef,
      browserTabIndex: input.browserTabIndex,
      page: clonePageIdentity(input.page),
      snapshotPath: input.snapshotPath,
      createdAt: workspace?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const persistedWorkspaceTab = {
      workspaceRef: input.workspaceRef,
      workspaceTabRef: activeWorkspaceTabRef,
      targetId: input.targetId,
      status: "open",
      browserTabIndex: input.browserTabIndex,
      page: clonePageIdentity(input.page),
      snapshotPath: input.snapshotPath,
      createdAt:
        persistedWorkspaceTabRecord?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    await this.store.writeWorkspace(persistedWorkspace);
    await this.store.writeWorkspaceTab(persistedWorkspaceTab);

    return {
      workspace: persistedWorkspace,
      workspaceTab: persistedWorkspaceTab,
      reusedWorkspaceTabRef: activeWorkspaceTabRef === workspace?.activeWorkspaceTabRef,
    };
  }

  async readWorkspaceOrUndefined(workspaceRef) {
    try {
      return await this.store.readWorkspace(workspaceRef);
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      throw error;
    }
  }
}

function assertReconcileInput(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("input must be an object");
  }
  assertNonEmptyString(input.workspaceRef, "workspaceRef");
  assertNonEmptyString(input.targetId, "targetId");
  assertNonNegativeInteger(input.browserTabIndex, "browserTabIndex");
  assertPageIdentity(input.page);
  assertNonEmptyString(input.snapshotPath, "snapshotPath");
  if (input.workspaceTabRef !== undefined) {
    assertNonEmptyString(input.workspaceTabRef, "workspaceTabRef");
  }
}

function clonePageIdentity(page) {
  return {
    origin: page.origin,
    normalizedPath: page.normalizedPath,
    title: page.title,
  };
}

function mintWorkspaceTabRef() {
  return `workspace_tab_${randomUUID()}`;
}

function assertPageIdentity(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("page must be an object");
  }
  assertNonEmptyString(value.origin, "page.origin");
  assertNonEmptyString(value.normalizedPath, "page.normalizedPath");
  assertNonEmptyString(value.title, "page.title");
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
