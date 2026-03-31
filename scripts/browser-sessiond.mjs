import http from "node:http";
import path from "node:path";
import process from "node:process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  DefaultBrowserRuntime,
  parseTabInventory,
  runBrowserAction,
  openWorkspaceFlow,
} from "./browser-action.mjs";
import { createConnectedDevtoolsBrowserClient } from "./devtools-browser-client.mjs";
import { querySnapshotText } from "./knowledge-query.mjs";
import { KnowledgeStore } from "./knowledge-store.mjs";
import { defaultRuntimeRoots } from "./paths.mjs";
import { pageIdentityFromSnapshotText } from "./page-identity.mjs";
import { SnapshotStore } from "./snapshot-store.mjs";
import { WorkspaceStore } from "./workspace-store.mjs";
import { WorkspaceBindingStore } from "./workspace-binding-store.mjs";

import { HttpError } from "./http-contract.mjs";
import { createHttpRouteHandler } from "./http-routes.mjs";

export const DEFAULT_RUNTIME_VERSION = "0.1.0";
export const DEFAULT_HTTP_PORT = 3456;
const DEFAULT_SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_WORKSPACE_TAB_URL = "chrome://newtab/";

class WorkspaceTabRefStore {
  constructor() {
    this.workspaces = new Map();
  }

  materializeTabs(workspaceRef, tabs) {
    const workspace = this.ensureWorkspace(workspaceRef);
    return tabs.map((tab) => {
      const workspaceTabRef = this.resolveOrMintWorkspaceTabRef(workspace, tab.index);
      return {
        ...omitIndex(tab),
        workspaceTabRef,
      };
    });
  }

  resolvePageId(workspaceRef, workspaceTabRef) {
    const workspace = this.workspaces.get(workspaceRef);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceRef} is not available; create a new workspace with POST /workspaces.`);
    }

    const pageId = workspace.byWorkspaceTabRef.get(workspaceTabRef);
    if (pageId === undefined) {
      throw new Error(`workspaceTabRef ${workspaceTabRef} is not available in workspace ${workspaceRef}; call GET /tabs?workspaceRef=${workspaceRef} to refresh the workspace tab list.`);
    }

    return pageId;
  }

  ensureWorkspace(workspaceRef) {
    const existing = this.workspaces.get(workspaceRef);
    if (existing) {
      return existing;
    }

    const created = {
      byPageId: new Map(),
      byWorkspaceTabRef: new Map(),
    };
    this.workspaces.set(workspaceRef, created);
    return created;
  }

  resolveOrMintWorkspaceTabRef(workspace, pageId) {
    const existing = workspace.byPageId.get(pageId);
    if (existing) {
      return existing;
    }

    const workspaceTabRef = `workspace_tab_${randomUUID()}`;
    workspace.byPageId.set(pageId, workspaceTabRef);
    workspace.byWorkspaceTabRef.set(workspaceTabRef, pageId);
    return workspaceTabRef;
  }
}

export class BrowserSessionDaemon {
  constructor(options = {}) {
    this.env = options.env ?? (process.env);
    this.runtimeVersion = options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION;
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? DEFAULT_HTTP_PORT;
    this.sessionRoot = options.sessionRoot ?? resolveDefaultSessionRoot();
    this.browserUrl = options.browserUrl ?? null;
    this.connectionMode = options.connectionMode ?? null;
    this.runningChromeCommands = options.runningChromeCommands ?? [];
    this.createBrowserBridge = options.createBrowserBridge ?? null;
    this.runtimeRoots = options.runtimeRoots ?? defaultRuntimeRoots();
    this.server = null;
    this.metadata = null;
    this.metadataPath = path.join(this.sessionRoot, "session.json");
    this.browserBridge = null;
    this.stopPromise = null;
    this.browserRuntime = this.createBrowserRuntime();
    this.workspaceBindings = new WorkspaceBindingStore(path.join(this.runtimeRoots.tempRoot, "workspace-bindings"));
    this.workspaceState = new WorkspaceStore(path.join(this.runtimeRoots.tempRoot, "workspace-state"));
    this.workspaceTabRefs = new WorkspaceTabRefStore();
    this.snapshots = new SnapshotStore(path.join(this.runtimeRoots.tempRoot, "snapshots"), {
      ttlMs: DEFAULT_SNAPSHOT_TTL_MS,
    });
    this.knowledge = new KnowledgeStore(this.runtimeRoots.knowledgeFile);
    this.actionDeps = {
      browser: this.browserRuntime,
      workspaceBindings: this.workspaceBindings,
      workspaceState: this.workspaceState,
      snapshots: this.snapshots,
      knowledge: this.knowledge,
    };
  }

  async start() {
    if (this.server && this.metadata) {
      return this.snapshotMetadata();
    }

    await mkdir(this.sessionRoot, { recursive: true });
    await this.resetEphemeralWorkspaceState();
    await this.ensureBrowserBridge();

    const now = new Date().toISOString();
    const metadata = {
      pid: process.pid,
      port: this.port,
      baseUrl: `http://${this.host}:${this.port}`,
      startedAt: now,
      lastSeenAt: now,
      browserUrl: this.browserUrl,
      connectionMode: this.connectionMode ?? "http",
      runtimeVersion: this.runtimeVersion,
    };

    this.server = http.createServer(createHttpRouteHandler(this));
    await listenOnServer(this.server, this.host, this.port);

    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("browser-sessiond could not resolve its listening address");
    }

    this.metadata = {
      ...metadata,
      port: address.port,
      baseUrl: `http://${this.host}:${address.port}`,
    };

    await this.writeMetadata();
    return this.snapshotMetadata();
  }

  async stop() {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = (async () => {
      const server = this.server;
      this.server = null;

      if (server) {
        await closeServer(server).catch(() => {});
      }

      const bridge = this.browserBridge;
      this.browserBridge = null;
      if (bridge && typeof bridge.close === "function") {
        await bridge.close().catch(() => {});
      }

      this.metadata = null;
      this.workspaceTabRefs = new WorkspaceTabRefStore();
      await rm(this.metadataPath, { force: true }).catch(() => {});
    })();

    try {
      await this.stopPromise;
    } finally {
      this.stopPromise = null;
    }
  }

  async handleHttpRequest(endpoint, body) {
    this.ensureStarted();
    await this.touch();

    switch (endpoint) {
      case "health":
        return this.snapshotMetadata();
      case "shutdown": {
        setImmediate(() => {
          void this.stop();
        });
        return { ok: true };
      }
      case "openWorkspace":
        return this.openWorkspace(body);
      case "navigate":
        return this.browserAction("navigate", "navigate_page", { type: "url", url: body.url }, body.workspaceRef);
      case "click":
        return this.browserAction("click", "click", { uid: body.uid }, body.workspaceRef);
      case "type":
        return this.browserAction("type", "fill", { uid: body.uid, value: body.text }, body.workspaceRef);
      case "press":
        return this.browserAction("press", "press_key", { key: body.key }, body.workspaceRef);
      case "selectTab":
        return this.browserAction(
          "select-tab",
          "select_page",
          { pageId: body.pageId, bringToFront: false },
          body.workspaceRef,
          {
            preselectBoundTab: false,
            nextBrowserTabIndex: body.pageId,
          },
        );
      case "queryWorkspace":
        return this.queryWorkspace(body);
      case "recordKnowledge":
        return this.recordKnowledge(body);
      default:
        throw new HttpError(501, `Endpoint ${endpoint} is not implemented`);
    }
  }

  resolveWorkspaceTabPageId(workspaceRef, workspaceTabRef) {
    return this.workspaceTabRefs.resolvePageId(workspaceRef, workspaceTabRef);
  }

  snapshotMetadata() {
    this.ensureStarted();
    return {
      ok: true,
      ...this.metadata,
    };
  }

  async readMetadata() {
    const raw = await readFile(this.metadataPath, "utf8");
    return JSON.parse(raw);
  }

  ensureStarted() {
    if (!this.metadata) {
      throw new Error("browser-sessiond has not been started");
    }
  }

  async touch() {
    if (!this.metadata) {
      return;
    }

    this.metadata = {
      ...this.metadata,
      lastSeenAt: new Date().toISOString(),
    };
    await this.writeMetadata();
  }

  async writeMetadata() {
    if (!this.metadata) {
      return;
    }

    await writeFile(this.metadataPath, `${JSON.stringify(this.metadata, null, 2)}\n`, "utf8");
  }

  async resetEphemeralWorkspaceState() {
    this.workspaceTabRefs = new WorkspaceTabRefStore();
    await Promise.all([
      rm(path.join(this.runtimeRoots.tempRoot, "workspace-bindings"), { recursive: true, force: true }),
      rm(path.join(this.runtimeRoots.tempRoot, "tab-state"), { recursive: true, force: true }),
      rm(path.join(this.runtimeRoots.tempRoot, "workspace-state"), { recursive: true, force: true }),
      rm(path.join(this.runtimeRoots.tempRoot, "snapshots"), { recursive: true, force: true }),
    ]);
  }

  createBrowserRuntime() {
    return {
      captureSnapshot: async () => (await this.ensureBrowserBridge()).captureSnapshot(),
      callBrowserTool: async (name, args) => (await this.ensureBrowserBridge()).callTool(name, args),
      readActiveTabIndex: async () => {
        const pageListText = await (await this.ensureBrowserBridge()).listPages();
        const activeTab = parseTabInventory(pageListText).find((tab) => tab.active);
        if (!activeTab) {
          throw new Error("unable to identify the current page from list_pages output");
        }
        return activeTab.index;
      },
      openWorkspaceTab: async () => {
        const pageListText = await (await this.ensureBrowserBridge()).newPage(DEFAULT_WORKSPACE_TAB_URL);
        const activeTab = parseTabInventory(pageListText).find((tab) => tab.active);
        if (activeTab) {
          return {
            pageId: activeTab.index,
            pageListText,
          };
        }

        return {
          pageId: await (async () => {
            const fallbackPageListText = await (await this.ensureBrowserBridge()).listPages();
            const fallbackActiveTab = parseTabInventory(fallbackPageListText).find((tab) => tab.active);
            if (!fallbackActiveTab) {
              throw new Error("unable to identify the new workspace tab from new_page output");
            }
            return fallbackActiveTab.index;
          })(),
          pageListText,
        };
      },
    };
  }

  async openWorkspace(params) {
    const result = await openWorkspaceFlow(params, this.actionDeps);
    return this.toPublicWorkspaceResult(result);
  }

  async browserAction(action, toolName, toolArgs, workspaceRef, options = {}) {
    const result = await runBrowserAction(
      {
        action,
        workspaceRef,
        toolName,
        toolArgs,
        preselectBoundTab: options.preselectBoundTab,
        nextBrowserTabIndex: options.nextBrowserTabIndex,
      },
      this.actionDeps,
    );

    return this.toPublicActionResult(result);
  }

  async queryWorkspace(params) {
    const resolved = params.workspaceRef
      ? await this.refreshSnapshotContextForWorkspace(params.workspaceRef)
      : await this.resolveSnapshotContext(params);
    const snapshotText = resolved.workspaceRef
      ? await this.rewriteSnapshotEnvelopeForWorkspace(resolved.workspaceRef, resolved.snapshotText)
      : resolved.snapshotText;
    const knowledgeHits = await this.readKnowledgeHits(resolved.page);
    const queryResult = querySnapshotText({
      snapshotText,
      mode: params.mode,
      text: params.query,
      role: params.role,
      uid: params.uid,
      knowledgeHits,
      page: resolved.page,
    });

    return {
      ok: true,
      ...queryResult,
      ...(resolved.workspaceRef !== undefined ? { workspaceRef: resolved.workspaceRef } : {}),
      snapshotRef: resolved.snapshotRef,
      knowledgeHits,
      summary: `${resolved.source === "live-workspace" ? "Refreshed the live workspace before querying. " : "Queried the exact referenced snapshot. "}${queryResult.summary}`,
    };
  }

  async recordKnowledge(params) {
    const timestamp = new Date().toISOString();
    const resolvedPageContext = params.page === undefined ? await this.resolveSnapshotContext(params) : undefined;
    const page = params.page ?? resolvedPageContext?.page;
    if (!page) {
      throw new Error("recordKnowledge requires page, workspaceRef, or snapshotRef");
    }

    const id = params.knowledgeRef ?? `knowledge_${randomUUID()}`;
    const record = {
      id,
      page: {
        origin: page.origin,
        normalizedPath: page.normalizedPath,
      },
      guide: params.guide,
      keywords: [...params.keywords],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(resolvedPageContext?.snapshotPath ? { sourceSnapshotPath: resolvedPageContext.snapshotPath } : {}),
      ...(params.rationale ? { rationale: params.rationale } : {}),
    };

    await this.knowledge.append(record);
    const knowledgeHits = await this.readKnowledgeHits(page);

    return {
      ok: true,
      workspaceRef: params.workspaceRef,
      ...(params.workspaceTabRef ? { workspaceTabRef: params.workspaceTabRef } : {}),
      page: {
        ...page,
      },
      knowledgeHits,
      summary: `Recorded knowledge for ${page.normalizedPath}`,
      record: {
        ...record,
        page: {
          ...page,
        },
      },
    };
  }

  async resolveSnapshotContext(params) {
    if (params.workspaceRef) {
      const binding = await this.workspaceBindings.read(params.workspaceRef);
      const snapshotText = await this.snapshots.read(binding.snapshotPath);
      return {
        workspaceRef: params.workspaceRef,
        snapshotRef: snapshotRefFromPath(binding.snapshotPath),
        snapshotPath: binding.snapshotPath,
        snapshotText,
        page: binding.page,
      };
    }

    if (!params.snapshotRef) {
      throw new Error("snapshot lookup requires workspaceRef or snapshotRef");
    }

    const snapshotPath = this.snapshotPathFromRef(params.snapshotRef);
    const snapshotText = await this.snapshots.read(snapshotPath);
    return {
      snapshotRef: snapshotRefFromPath(snapshotPath),
      snapshotPath,
      snapshotText,
      page: pageIdentityFromSnapshotText(snapshotText),
      source: "snapshot-ref",
    };
  }

  async refreshSnapshotContextForWorkspace(workspaceRef) {
    const bindingExists = await this.workspaceBindings.exists(workspaceRef);
    if (!bindingExists) {
      throw new Error(`Workspace ${workspaceRef} is not available; create a new workspace with POST /workspaces.`);
    }

    const refreshed = await openWorkspaceFlow({ workspaceRef }, this.actionDeps);
    const snapshotText = await this.snapshots.read(refreshed.snapshotPath);
    return {
      workspaceRef,
      snapshotRef: snapshotRefFromPath(refreshed.snapshotPath),
      snapshotPath: refreshed.snapshotPath,
      snapshotText,
      page: refreshed.page,
      source: "live-workspace",
    };
  }

  async readKnowledgeHits(page) {
    const records = await this.knowledge.queryByPage(page);
    return records.map((record) => ({
      guide: record.guide,
      keywords: [...record.keywords],
      rationale: record.rationale,
    }));
  }

  async rewriteSnapshotEnvelopeForWorkspace(workspaceRef, snapshotText) {
    const workspaceTabs = await this.listWorkspaceTabs(workspaceRef);
    return rewriteOpenTabsSection(snapshotText, workspaceTabs);
  }

  async ensureBrowserBridge() {
    if (this.browserBridge) {
      return this.browserBridge;
    }

    if (this.createBrowserBridge) {
      this.browserBridge = await this.createBrowserBridge({
        browserUrl: this.browserUrl,
        env: this.env,
        runningChromeCommands: this.runningChromeCommands,
      });
      this.attachBrowserBridgeDisconnectHandler(this.browserBridge);
      return this.browserBridge;
    }

    const connected = await createConnectedDevtoolsBrowserClient({
      env: this.env,
      browserUrl: this.browserUrl ?? undefined,
      runningChromeCommands: this.runningChromeCommands,
    });
    this.browserUrl = connected.browserUrl;
    this.connectionMode = "browserUrl";
    const runtime = new DefaultBrowserRuntime(connected.client);
    this.browserBridge = {
      onDisconnect: connected.onDisconnect,
      close: connected.close,
      listPages: async () => connected.client.listPages(),
      newPage: async (url, background) => connected.client.newPage(url, background),
      captureSnapshot: async () => runtime.captureSnapshot(),
      callTool: async (name, args) => runtime.callBrowserTool(name, args),
    };
    this.attachBrowserBridgeDisconnectHandler(this.browserBridge);
    return this.browserBridge;
  }

  attachBrowserBridgeDisconnectHandler(bridge) {
    if (!bridge || typeof bridge.onDisconnect !== "function") {
      return;
    }

    bridge.onDisconnect(() => {
      void this.stop().catch(() => {});
    });
  }

  async toPublicWorkspaceResult(result) {
    const workspaceRef = result.workspaceRef;
    const tabs = await this.listWorkspaceTabs(workspaceRef);

    return {
      ok: true,
      workspaceRef,
      snapshotRef: snapshotRefFromPath(result.snapshotPath),
      ...result,
      ...(tabs !== undefined ? { tabs } : {}),
    };
  }

  toPublicActionResult(result) {
    return {
      ok: true,
      snapshotRef: snapshotRefFromPath(result.snapshotPath),
      ...result,
      action: result.action,
    };
  }

  snapshotPathFromRef(snapshotRef) {
    return path.join(this.runtimeRoots.tempRoot, "snapshots", `${snapshotRef}.md`);
  }

  async listWorkspaceTabs(workspaceRef) {
    const workspace = await this.workspaceState.readWorkspace(workspaceRef);
    const workspaceTabs = await this.workspaceState.listWorkspaceTabs(workspaceRef);
    return workspaceTabs.map((workspaceTab) => ({
      workspaceTabRef: workspaceTab.workspaceTabRef,
      title: workspaceTab.page.title,
      url: workspaceTabUrlFromPage(workspaceTab.page),
      active: workspaceTab.workspaceTabRef === workspace.activeWorkspaceTabRef,
    }));
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const daemon = new BrowserSessionDaemon(options);

  const stop = async () => {
    await daemon.stop().catch(() => {});
  };

  process.once("SIGINT", () => {
    void stop().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void stop().finally(() => process.exit(0));
  });

  const metadata = await daemon.start();
  process.stdout.write(`${JSON.stringify(metadata)}\n`);
  return { daemon, metadata };
}

function resolveDefaultSessionRoot() {
  return path.join(defaultRuntimeRoots().tempRoot, "session");
}

function parseCliArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--session-root") {
      options.sessionRoot = argv[++index];
    } else if (arg === "--runtime-version") {
      options.runtimeVersion = argv[++index];
    } else if (arg === "--port") {
      options.port = Number(argv[++index]);
    } else if (arg === "--host") {
      options.host = argv[++index];
    } else if (arg === "--browser-url") {
      options.browserUrl = argv[++index];
    } else if (arg === "--connection-mode") {
      options.connectionMode = argv[++index];
    }
  }

  return options;
}

async function listenOnServer(server, host, port) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port });
  });
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function snapshotRefFromPath(snapshotPath) {
  return path.basename(snapshotPath, path.extname(snapshotPath));
}

export function createWorkspaceTabRefStore() {
  return new WorkspaceTabRefStore();
}

function omitIndex(tab) {
  const clone = { ...tab };
  delete clone.index;
  return clone;
}

function workspaceTabUrlFromPage(page) {
  if (page.origin === "null") {
    if (page.normalizedPath === "/blank") {
      return "about:blank";
    }
    return page.normalizedPath;
  }

  return `${page.origin}${page.normalizedPath}`;
}

function rewriteOpenTabsSection(snapshotText, tabs) {
  const lines = snapshotText.split(/\r?\n/);
  const rewrittenSection = formatOpenTabsSection(tabs);
  const openTabsIndex = lines.findIndex((line) => line.trim() === "### Open tabs");
  const nextSectionIndex = openTabsIndex >= 0
    ? lines.findIndex((line, index) => index > openTabsIndex && line.trim().startsWith("### "))
    : -1;

  if (openTabsIndex >= 0) {
    const sectionEnd = nextSectionIndex >= 0 ? nextSectionIndex : lines.length;
    return [
      ...lines.slice(0, openTabsIndex),
      ...rewrittenSection,
      ...lines.slice(sectionEnd),
    ].join("\n");
  }

  if (rewrittenSection.length === 0) {
    return snapshotText;
  }

  const pageSectionIndex = lines.findIndex((line) => line.trim() === "### Page");
  if (pageSectionIndex >= 0) {
    return [
      ...lines.slice(0, pageSectionIndex),
      ...rewrittenSection,
      ...lines.slice(pageSectionIndex),
    ].join("\n");
  }

  return [
    ...rewrittenSection,
    ...lines,
  ].join("\n");
}

function formatOpenTabsSection(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    return [];
  }

  return [
    "### Open tabs",
    ...tabs.map((tab, index) => `- ${index}: ${tab.active ? "(current) " : ""}[${tab.title}](${tab.url})`),
  ];
}

export function isDirectRunEntry(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) {
    return false;
  }

  try {
    return realpathSync.native(argv1) === realpathSync.native(fileURLToPath(importMetaUrl));
  } catch {
    return path.resolve(argv1) === path.resolve(fileURLToPath(importMetaUrl));
  }
}

if (isDirectRunEntry(import.meta.url)) {
  await main();
}
