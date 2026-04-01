import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { createConnectedDevtoolsBrowserClient } from "./devtools-browser-client.mjs";
import { KnowledgeStore } from "./knowledge-store.mjs";
import { defaultRuntimeRoots } from "./paths.mjs";
import { pageIdentityFromSnapshotText, pageIdentityFromUrl } from "./page-identity.mjs";
import { SnapshotStore } from "./snapshot-store.mjs";
import { WorkspaceReconciler } from "./workspace-reconciler.mjs";
import { WorkspaceStore } from "./workspace-store.mjs";
import { WorkspaceBindingStore } from "./workspace-binding-store.mjs";

const DEFAULT_SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_WORKSPACE_TAB_URL = "chrome://newtab/";

export class DefaultBrowserRuntime {
  constructor(client) {
    this.client = client;
  }

  async listPages() {
    return this.client.listPages();
  }

  async captureSnapshot() {
    return this.client.captureSnapshot();
  }

  async callBrowserTool(name, args) {
    return this.client.callBrowserTool(name, args);
  }

  async readActiveTabIndex() {
    const pageListText = await this.client.listPages();
    const activeTab = parseTabInventory(pageListText).find((tab) => tab.active);
    if (!activeTab) {
      throw new Error("unable to identify the current page from list_pages output");
    }
    return activeTab.index;
  }

  async openWorkspaceTab() {
    const page = await this.client.openWorkspaceTab(DEFAULT_WORKSPACE_TAB_URL, {
      bringToFront: false,
    });
    const pageListText = await this.client.listPages();
    return {
      pageId: page.pageId,
      pageListText,
    };
  }
}

export async function runWithBrowserActionDeps(deps, run) {
  if (deps) {
    return run(deps);
  }

  const defaultDeps = await createDefaultBrowserActionDeps();
  try {
    return await run(defaultDeps);
  } finally {
    await defaultDeps.dispose();
  }
}

export async function openWorkspaceFlow(args, deps) {
  await deps.snapshots.cleanupExpired();

  const providedWorkspaceRef = optionalNonEmptyString(args.workspaceRef, "workspaceRef");
  const providedWorkspaceTabRef = optionalNonEmptyString(args.workspaceTabRef, "workspaceTabRef");
  const workspaceState = resolveWorkspaceState(deps);
  const existingWorkspaceTarget = providedWorkspaceRef
    ? await readWorkspaceTargetForOpen(workspaceState, providedWorkspaceRef, providedWorkspaceTabRef)
    : undefined;
  const captureTarget = await resolveWorkspaceTarget(args, deps, providedWorkspaceRef, existingWorkspaceTarget);
  const rawSnapshotText = await deps.browser.captureSnapshot();
  const snapshotText = normalizeCapturedSnapshot(captureTarget.pageListText, rawSnapshotText, captureTarget.pageId);
  const { snapshotPath } = await deps.snapshots.write(snapshotText);
  const page = pageIdentityFromSnapshotText(snapshotText);
  const workspaceRef = providedWorkspaceRef ?? mintWorkspaceRef();
  const workspaceStateResult = await resolveWorkspaceReconciler(workspaceState).reconcileWorkspace({
    workspaceRef,
    browserTabIndex: captureTarget.pageId,
    page,
    snapshotPath,
    workspaceTabRef: captureTarget.workspaceTabRef,
  });

  await deps.workspaceBindings.write({
    workspaceRef,
    browserTabIndex: workspaceStateResult.workspace.browserTabIndex,
    snapshotPath,
    page,
  });

  const knowledgeHits = await readKnowledgeHits(deps, page.origin, page.normalizedPath);

  return {
    ok: true,
    workspaceRef,
    page,
    tabs: parseTabInventory(snapshotText),
    snapshotPath,
    knowledgeHits,
    summary: captureTarget.createdWorkspaceTab
      ? `Captured a fresh snapshot and bound a new workspace tab to ${workspaceRef}.`
      : captureTarget.reusedBinding
        ? `Refreshed ${workspaceRef} with a fresh snapshot.`
        : `Captured a fresh snapshot and bound browser tab ${captureTarget.pageId} to ${workspaceRef}.`,
  };
}

export async function runBrowserAction(input, deps) {
  return runWorkspaceAction(input, deps);
}

export async function runWorkspaceAction(input, deps) {
  const workspaceRef = requireNonEmptyString(input.workspaceRef, "workspaceRef");
  const workspaceState = resolveWorkspaceState(deps);
  const target = await resolveActionWorkspaceTarget(input, workspaceState, workspaceRef);
  const preActionPageListText = input.preselectBoundTab !== false
    ? await selectCapturedPage(deps.browser, target.browserTabIndex)
    : await readBrowserPageList(deps.browser);
  const preActionPageIds = new Set(parseTabInventory(preActionPageListText).map((tab) => tab.index));

  await deps.browser.callBrowserTool(input.toolName, {
    ...input.toolArgs,
    pageId: target.browserTabIndex,
  });

  const postActionPageListText = await readBrowserPageList(deps.browser, preActionPageListText);
  const liveTabs = parseTabInventory(postActionPageListText);
  const browserTabIndex = await resolveCapturedBrowserTabIndex(
    deps,
    liveTabs,
    input.nextBrowserTabIndex ?? target.browserTabIndex,
  );
  const selectedPageListText = await selectCapturedPage(deps.browser, browserTabIndex);
  const rawSnapshotText = await deps.browser.captureSnapshot();
  const snapshotText = normalizeCapturedSnapshot(selectedPageListText, rawSnapshotText, browserTabIndex);
  const { snapshotPath } = await deps.snapshots.write(snapshotText);
  const page = pageIdentityFromSnapshotText(snapshotText);

  await deps.workspaceBindings.write({
    workspaceRef,
    browserTabIndex,
    snapshotPath,
    page,
  });

  const workspaceStateResult = await resolveWorkspaceReconciler(workspaceState).reconcileWorkspace({
    workspaceRef,
    browserTabIndex,
    page,
    snapshotPath,
    workspaceTabRef: browserTabIndex === target.browserTabIndex ? target.workspaceTabRef : undefined,
  });
  await syncWorkspaceTabInventory({
    workspaceRef,
    workspaceState,
    liveTabs,
    preActionPageIds,
    activeWorkspaceTabRef: workspaceStateResult.workspace.activeWorkspaceTabRef,
    activeBrowserTabIndex: browserTabIndex,
    activePage: page,
    activeSnapshotPath: snapshotPath,
  });

  const knowledgeHits = await readKnowledgeHits(deps, page.origin, page.normalizedPath);

  return {
    ok: true,
    action: input.action,
    workspaceRef,
    workspaceTabRef: workspaceStateResult.workspace.activeWorkspaceTabRef,
    page,
    snapshotPath,
    knowledgeHits,
    summary: `${input.action} completed for ${workspaceRef} and captured a fresh snapshot.`,
  };
}

export function parseCliIntegerArg(value, label) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

export function parseCliBooleanArg(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`Expected boolean flag value, received ${value}`);
}

export function readCliStringArg(args, key) {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

export function readCliStringArgWithAliases(args, ...keys) {
  for (const key of keys) {
    const value = readCliStringArg(args, key);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function optionalCliStringArg(args, key, label) {
  const rawValue = args[key];
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    throw new Error(`${label} requires a value (--${key})`);
  }
  return rawValue;
}

export function optionalCliStringArgWithAliases(args, label, ...keys) {
  for (const key of keys) {
    const value = optionalCliStringArg(args, key, label);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

export function requireCliStringArg(args, key, label) {
  const value = optionalCliStringArg(args, key, label);
  if (value === undefined) {
    throw new Error(`${label} is required (--${key})`);
  }
  return value;
}

export function requireCliStringArgWithAliases(args, label, ...keys) {
  const value = optionalCliStringArgWithAliases(args, label, ...keys);
  if (value === undefined) {
    throw new Error(`${label} is required (--${keys[0]})`);
  }
  return value;
}

export function requireCliIntegerArg(args, key, label) {
  const value = optionalCliStringArg(args, key, label);
  if (value === undefined) {
    throw new Error(`${label} is required (--${key})`);
  }
  return parseCliIntegerArg(value, label);
}

async function createDefaultBrowserActionDeps() {
  const roots = defaultRuntimeRoots();
  const connected = await createConnectedDevtoolsBrowserClient({
    env: process.env,
  });
  const browser = new DefaultBrowserRuntime(connected.client);

  return {
    browser,
    workspaceBindings: new WorkspaceBindingStore(path.join(roots.tempRoot, "workspace-bindings")),
    workspaceState: new WorkspaceStore(path.join(roots.tempRoot, "workspace-state")),
    snapshots: new SnapshotStore(path.join(roots.tempRoot, "snapshots"), {
      ttlMs: DEFAULT_SNAPSHOT_TTL_MS,
    }),
    knowledge: new KnowledgeStore(roots.knowledgeFile),
    dispose: async () => {
      await connected.close();
    },
  };
}

function resolveWorkspaceState(deps) {
  if (deps.workspaceState) {
    return deps.workspaceState;
  }

  if (!deps.workspaceBindings || typeof deps.workspaceBindings.rootDir !== "string") {
    throw new TypeError("workspaceState requires either deps.workspaceState or deps.workspaceBindings.rootDir");
  }

  return new WorkspaceStore(path.join(path.dirname(deps.workspaceBindings.rootDir), "workspace-state"));
}

function resolveWorkspaceReconciler(workspaceState) {
  return new WorkspaceReconciler(workspaceState);
}

async function resolveWorkspaceTarget(
  args,
  deps,
  providedWorkspaceRef,
  existingWorkspaceTarget,
) {
  if (typeof args.pageId === "number") {
    if (!Number.isInteger(args.pageId) || args.pageId < 0) {
      throw new Error("pageId must be a non-negative integer");
    }
    const pageListText = await selectCapturedPage(deps.browser, args.pageId);
    return {
      pageId: await resolveCapturedBrowserTabIndex(deps, parseTabInventory(pageListText), args.pageId),
      pageListText,
      createdWorkspaceTab: false,
      reusedBinding: false,
    };
  }

  if (providedWorkspaceRef && existingWorkspaceTarget?.workspaceTab) {
    try {
      const expectedPageId = existingWorkspaceTarget.workspaceTab.browserTabIndex;
      const pageListText = await selectCapturedPage(deps.browser, expectedPageId);
      const resolvedPageId = await resolveCapturedBrowserTabIndex(
        deps,
        parseTabInventory(pageListText),
        expectedPageId,
      );
      if (resolvedPageId !== expectedPageId) {
        throw new Error(
          `workspace active browser tab ${expectedPageId} is no longer available in the live browser inventory`,
        );
      }
      return {
        pageId: resolvedPageId,
        pageListText,
        createdWorkspaceTab: false,
        reusedBinding: true,
        workspaceTabRef: existingWorkspaceTarget.workspaceTab.workspaceTabRef,
      };
    } catch (error) {
      if (!isMissingCapturedPageError(error)) {
        throw error;
      }
    }

    const reboundWorkspaceTab = await deps.browser.openWorkspaceTab();
    return {
      pageId: await resolveCapturedBrowserTabIndex(
        deps,
        parseTabInventory(reboundWorkspaceTab.pageListText),
        reboundWorkspaceTab.pageId,
      ),
      pageListText: reboundWorkspaceTab.pageListText,
      createdWorkspaceTab: true,
      reusedBinding: false,
      workspaceTabRef: existingWorkspaceTarget.workspaceTab?.workspaceTabRef,
    };
  }

  const workspaceTab = await deps.browser.openWorkspaceTab();
  return {
    pageId: await resolveCapturedBrowserTabIndex(deps, parseTabInventory(workspaceTab.pageListText), workspaceTab.pageId),
    pageListText: workspaceTab.pageListText,
    createdWorkspaceTab: true,
    reusedBinding: false,
    workspaceTabRef: undefined,
  };
}

async function readKnowledgeHits(deps, origin, normalizedPath) {
  const hits = await deps.knowledge.queryByPage({
    origin,
    normalizedPath,
  });

  return hits.map((hit) => ({
    guide: hit.guide,
    keywords: [...hit.keywords],
    rationale: hit.rationale,
  }));
}

async function readWorkspaceRecord(workspaceState, workspaceRef) {
  try {
    return await workspaceState.readWorkspace(workspaceRef);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readWorkspaceActiveTarget(workspaceState, workspaceRef) {
  const workspace = await readWorkspaceRecord(workspaceState, workspaceRef);
  if (!workspace) {
    return undefined;
  }

  try {
    const workspaceTab = await workspaceState.readWorkspaceTab(workspaceRef, workspace.activeWorkspaceTabRef);
    return {
      workspace,
      workspaceTab,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        workspace,
        workspaceTab: undefined,
      };
    }
    throw error;
  }
}

async function readWorkspaceTargetForOpen(workspaceState, workspaceRef, workspaceTabRef) {
  if (workspaceTabRef === undefined) {
    return readWorkspaceActiveTarget(workspaceState, workspaceRef);
  }

  const workspace = await readWorkspaceRecord(workspaceState, workspaceRef);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceRef} is not available; create a new workspace with POST /workspaces.`);
  }

  try {
    const workspaceTab = await workspaceState.readWorkspaceTab(workspaceRef, workspaceTabRef);
    return {
      workspace,
      workspaceTab,
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        workspace,
        workspaceTab: {
          workspaceRef,
          workspaceTabRef,
          browserTabIndex: workspace.browserTabIndex,
          page: workspace.page,
          snapshotPath: workspace.snapshotPath,
        },
      };
    }
    throw error;
  }
}

async function resolveActionWorkspaceTarget(input, workspaceState, workspaceRef) {
  if (typeof input.toolArgs?.pageId === "number") {
    return {
      browserTabIndex: input.toolArgs.pageId,
      workspaceTabRef: input.workspaceTabRef,
    };
  }

  if (input.workspaceTabRef !== undefined) {
    try {
      const workspaceTab = await workspaceState.readWorkspaceTab(workspaceRef, input.workspaceTabRef);
      return {
        browserTabIndex: workspaceTab.browserTabIndex,
        workspaceTabRef: workspaceTab.workspaceTabRef,
      };
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new Error(`workspaceTabRef ${input.workspaceTabRef} is not available in workspace ${workspaceRef}; call GET /tabs?workspaceRef=${workspaceRef} to refresh the workspace tab list.`);
      }
      throw error;
    }
  }

  const activeTarget = await readWorkspaceActiveTarget(workspaceState, workspaceRef);
  if (!activeTarget?.workspace) {
    throw new Error(`Workspace ${workspaceRef} is not available; create a new workspace with POST /workspaces.`);
  }
  if (!activeTarget.workspaceTab) {
    throw new Error(
      `Workspace ${workspaceRef} has no live active workspace tab; refresh it with POST /workspaces?workspaceRef=${workspaceRef}.`,
    );
  }

  return {
    browserTabIndex: activeTarget.workspaceTab.browserTabIndex,
    workspaceTabRef: activeTarget.workspaceTab.workspaceTabRef,
  };
}

async function readBrowserPageList(browser, fallbackPageListText) {
  if (typeof browser.listPages === "function") {
    return browser.listPages();
  }

  if (typeof browser.callBrowserTool === "function") {
    const result = await browser.callBrowserTool("list_pages", {});
    const text = readToolText(result);
    if (text) {
      return text;
    }
  }

  if (fallbackPageListText) {
    return fallbackPageListText;
  }

  throw new Error("browser runtime cannot list pages");
}

function mintWorkspaceRef() {
  return `workspace_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function resolveCapturedBrowserTabIndex(
  deps,
  capturedTabs,
  fallbackIndex,
) {
  const activeTabIndex = capturedTabs.find((tab) => tab.active)?.index;
  if (activeTabIndex !== undefined) {
    return activeTabIndex;
  }

  try {
    return await deps.browser.readActiveTabIndex();
  } catch {
    return fallbackIndex;
  }
}

async function syncWorkspaceTabInventory(input) {
  const timestamp = new Date().toISOString();
  const existingWorkspaceTabs = await input.workspaceState.listWorkspaceTabs(input.workspaceRef);
  const existingByIndex = new Map(existingWorkspaceTabs.map((tab) => [tab.browserTabIndex, tab]));
  const adoptedTabIndexes = new Set([
    ...existingWorkspaceTabs.map((tab) => tab.browserTabIndex),
    input.activeBrowserTabIndex,
    ...input.liveTabs
      .filter((tab) => !input.preActionPageIds.has(tab.index))
      .map((tab) => tab.index),
  ]);

  for (const liveTab of input.liveTabs) {
    if (!adoptedTabIndexes.has(liveTab.index)) {
      continue;
    }

    const existing = existingByIndex.get(liveTab.index);
    const workspaceTabRef = liveTab.index === input.activeBrowserTabIndex
      ? input.activeWorkspaceTabRef
      : existing?.workspaceTabRef ?? `workspace_tab_${randomUUID()}`;
    const page = liveTab.index === input.activeBrowserTabIndex
      ? input.activePage
      : pageIdentityFromUrl(liveTab.url, liveTab.title);
    const snapshotPath = liveTab.index === input.activeBrowserTabIndex
      ? input.activeSnapshotPath
      : existing?.snapshotPath ?? input.activeSnapshotPath;

    await input.workspaceState.writeWorkspaceTab({
      workspaceRef: input.workspaceRef,
      workspaceTabRef,
      browserTabIndex: liveTab.index,
      page,
      snapshotPath,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function optionalNonEmptyString(value, label) {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, label);
}

function isMissingCapturedPageError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /no page found/i.test(error.message) || /selected page has been closed/i.test(error.message);
}

async function selectCapturedPage(browser, pageId) {
  const result = await browser.callBrowserTool("select_page", {
    pageId,
    bringToFront: false,
  });
  const text = readToolText(result);
  if (!text) {
    throw new Error("select_page returned a malformed payload: expected text content");
  }
  return text;
}

function normalizeCapturedSnapshot(
  pageListText,
  rawSnapshotText,
  fallbackPageId,
) {
  const tabs = parseTabInventory(pageListText);
  const pageIdentity = extractPageIdentityFromChromeSnapshot(rawSnapshotText, tabs, fallbackPageId);
  const openTabsSection = tabs.length > 0
    ? [
        "### Open tabs",
        ...tabs.map((tab) => `- ${tab.index}: ${tab.active ? "(current) " : ""}[${tab.title}](${tab.url})`),
      ]
    : [];

  return [
    ...openTabsSection,
    "### Page",
    `- Page URL: ${pageIdentity.url}`,
    `- Page Title: ${pageIdentity.title}`,
    "### Snapshot",
    "```text",
    ...rawSnapshotText.split(/\r?\n/),
    "```",
  ].join("\n");
}

function extractPageIdentityFromChromeSnapshot(
  rawSnapshotText,
  tabs,
  fallbackPageId,
) {
  const rootMatch = rawSnapshotText.match(
    /RootWebArea\s+"(?<title>(?:\\.|[^"])*)"(?:\s+url="(?<url>[^"]+)")?/i,
  );
  const selectedTab = tabs.find((tab) => tab.active) ?? tabs.find((tab) => tab.index === fallbackPageId);
  const url = rootMatch?.groups?.url?.trim() || selectedTab?.url;
  if (!url) {
    throw new Error("take_snapshot did not include a page URL and no selected page was available");
  }

  const title = unescapeSnapshotQuotedText(rootMatch?.groups?.title?.trim() || "") || selectedTab?.title || url;
  return { url, title };
}

function unescapeSnapshotQuotedText(value) {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function readToolText(result) {
  if (typeof result === "string") {
    return result;
  }
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const text = block.text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
    }
  }
  return null;
}

export function parseTabInventory(snapshotText) {
  const lines = snapshotText.split(/\r?\n/);
  const tabs = [];
  let inOpenTabs = false;
  let inPageList = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "### Open tabs") {
      inOpenTabs = true;
      inPageList = false;
      continue;
    }
    if (trimmed === "## Pages") {
      inOpenTabs = false;
      inPageList = true;
      continue;
    }
    if ((inOpenTabs && trimmed.startsWith("### ")) || (inPageList && trimmed.startsWith("## "))) {
      break;
    }
    if (!inOpenTabs && !inPageList) {
      continue;
    }

    if (inOpenTabs) {
      const match = trimmed.match(/^\-\s*(?<index>\d+)\s*:\s*(?<rest>.+)$/);
      if (!match?.groups) {
        continue;
      }

      const index = Number.parseInt(match.groups.index, 10);
      if (!Number.isInteger(index) || index < 0) {
        continue;
      }

      const rest = match.groups.rest.trim();
      const link =
        rest.match(/^\(current\)\s+\[(?<title>[^\]]*)\]\((?<url>.*)\)$/) ??
        rest.match(/^\[(?<title>[^\]]*)\]\((?<url>.*)\)\s+\(current\)$/) ??
        rest.match(/^\[(?<title>[^\]]*)\]\((?<url>.*)\)$/);

      if (!link?.groups) {
        continue;
      }

      tabs.push({
        index,
        title: link.groups.title,
        url: link.groups.url,
        active: /\(current\)/i.test(rest),
      });
      continue;
    }

    if (inPageList) {
      const match = trimmed.match(/^\-\s*(?<index>\d+)\s+(?<rest>.+)$/);
      if (!match?.groups) {
        continue;
      }

      const index = Number.parseInt(match.groups.index, 10);
      if (!Number.isInteger(index) || index < 0) {
        continue;
      }

      const rest = match.groups.rest.trim();
      const link =
        rest.match(/^\(current\)\s+\[(?<title>[^\]]*)\]\((?<url>.*)\)$/) ??
        rest.match(/^\[(?<title>[^\]]*)\]\((?<url>.*)\)\s+\(current\)$/) ??
        rest.match(/^\[(?<title>[^\]]*)\]\((?<url>.*)\)$/);

      if (!link?.groups) {
        continue;
      }

      tabs.push({
        index,
        title: link.groups.title,
        url: link.groups.url,
        active: /\(current\)/i.test(rest),
      });
    }
  }

  return tabs;
}
