import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  DefaultBrowserRuntime,
  parseTabInventory,
  resolveBrowserMcpLaunchOptions,
  runBrowserAction,
  runCaptureFlow,
} from "./browser-action.mjs";
import { querySnapshotText } from "./knowledge-query.mjs";
import { KnowledgeStore } from "./knowledge-store.mjs";
import { createConnectedMcpBrowserClient } from "./mcp-browser-client.mjs";
import { defaultRuntimeRoots } from "./paths.mjs";
import { pageIdentityFromSnapshotText } from "./page-identity.mjs";
import { SnapshotStore } from "./snapshot-store.mjs";
import { TabBindingStore } from "./tab-binding-store.mjs";

import { HttpError } from "./http-contract.mjs";
import { createHttpRouteHandler } from "./http-routes.mjs";

export const DEFAULT_RUNTIME_VERSION = "0.1.0";
export const DEFAULT_HTTP_PORT = 3456;
const DEFAULT_SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_WORKSPACE_TAB_URL = "chrome://newtab/";

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
    this.createMcpBridge = options.createMcpBridge ?? null;
    this.runtimeRoots = options.runtimeRoots ?? defaultRuntimeRoots();
    this.server = null;
    this.metadata = null;
    this.metadataPath = path.join(this.sessionRoot, "session.json");
    this.browserBridge = null;
    this.browserRuntime = this.createBrowserRuntime();
    this.tabBindings = new TabBindingStore(path.join(this.runtimeRoots.tempRoot, "tab-state"));
    this.snapshots = new SnapshotStore(path.join(this.runtimeRoots.tempRoot, "snapshots"), {
      ttlMs: DEFAULT_SNAPSHOT_TTL_MS,
    });
    this.knowledge = new KnowledgeStore(this.runtimeRoots.knowledgeFile);
    this.actionDeps = {
      browser: this.browserRuntime,
      tabBindings: this.tabBindings,
      snapshots: this.snapshots,
      knowledge: this.knowledge,
    };
  }

  async start() {
    if (this.server && this.metadata) {
      return this.snapshotMetadata();
    }

    await mkdir(this.sessionRoot, { recursive: true });
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
    const server = this.server;
    this.server = null;

    if (server) {
      await closeServer(server);
    }

    const bridge = this.browserBridge;
    this.browserBridge = null;
    if (bridge && typeof bridge.close === "function") {
      await bridge.close();
    }

    this.metadata = null;
    await rm(this.metadataPath, { force: true }).catch(() => {});
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
      case "capture":
        return this.capture(body);
      case "navigate":
        return this.browserAction("navigate", "navigate_page", { type: "url", url: body.url }, body.tabRef);
      case "click":
        return this.browserAction("click", "click", { uid: body.uid ?? body.ref }, body.tabRef);
      case "type":
        return this.browserAction("type", "fill", { uid: body.uid ?? body.ref, value: body.text }, body.tabRef);
      case "press":
        return this.browserAction("press", "press_key", { key: body.key }, body.tabRef);
      case "selectTab":
        return this.browserAction(
          "select-tab",
          "select_page",
          { pageId: body.pageId, bringToFront: false },
          body.tabRef,
          {
            preselectBoundTab: false,
            nextBrowserTabIndex: body.pageId,
          },
        );
      case "querySnapshot":
        return this.querySnapshot(body);
      case "recordKnowledge":
        return this.recordKnowledge(body);
      default:
        throw new HttpError(501, `Endpoint ${endpoint} is not implemented`);
    }
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

  async capture(params) {
    const result = await runCaptureFlow(params, this.actionDeps);
    return this.toPublicCaptureResult(result);
  }

  async browserAction(action, toolName, toolArgs, tabRef, options = {}) {
    const result = await runBrowserAction(
      {
        action,
        tabRef,
        toolName,
        toolArgs,
        preselectBoundTab: options.preselectBoundTab,
        nextBrowserTabIndex: options.nextBrowserTabIndex,
      },
      this.actionDeps,
    );

    return this.toPublicActionResult(result);
  }

  async querySnapshot(params) {
    const resolved = await this.resolveSnapshotContext(params);
    const knowledgeHits = await this.readKnowledgeHits(resolved.page);
    const queryResult = querySnapshotText({
      snapshotText: resolved.snapshotText,
      mode: params.mode ?? "auto",
      text: params.query,
      role: params.role,
      uid: params.uid,
      ref: params.ref,
      knowledgeHits,
      page: resolved.page,
    });

    return {
      ok: true,
      ...queryResult,
      ...(resolved.tabRef !== undefined ? { tabRef: resolved.tabRef } : {}),
      snapshotRef: resolved.snapshotRef,
      knowledgeHits,
      summary: queryResult.summary,
    };
  }

  async recordKnowledge(params) {
    const timestamp = new Date().toISOString();
    const resolvedPageContext = params.page === undefined ? await this.resolveSnapshotContext(params) : undefined;
    const page = params.page ?? resolvedPageContext?.page;
    if (!page) {
      throw new Error("recordKnowledge requires page, tabRef, or snapshotRef");
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

    return {
      ok: true,
      record: {
        ...record,
        page: {
          ...page,
        },
      },
    };
  }

  async resolveSnapshotContext(params) {
    if (params.tabRef) {
      const binding = await this.tabBindings.read(params.tabRef);
      const snapshotText = await this.snapshots.read(binding.snapshotPath);
      return {
        tabRef: params.tabRef,
        snapshotRef: snapshotRefFromPath(binding.snapshotPath),
        snapshotPath: binding.snapshotPath,
        snapshotText,
        page: binding.page,
      };
    }

    if (!params.snapshotRef) {
      throw new Error("snapshot lookup requires tabRef or snapshotRef");
    }

    const snapshotPath = this.snapshotPathFromRef(params.snapshotRef);
    const snapshotText = await this.snapshots.read(snapshotPath);
    return {
      snapshotRef: snapshotRefFromPath(snapshotPath),
      snapshotPath,
      snapshotText,
      page: pageIdentityFromSnapshotText(snapshotText),
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

  async ensureBrowserBridge() {
    if (this.browserBridge) {
      return this.browserBridge;
    }

    const launchOptions = this.resolveLaunchOptions();
    this.browserUrl = browserUrlFromLaunchOptions(launchOptions);
    this.connectionMode = this.browserUrl ? "browserUrl" : "autoConnect";

    if (this.createMcpBridge) {
      this.browserBridge = await this.createMcpBridge({ launchOptions });
      return this.browserBridge;
    }

    const connected = await createConnectedMcpBrowserClient(launchOptions, this.env);
    const runtime = new DefaultBrowserRuntime(connected.client);
    this.browserBridge = {
      close: connected.close,
      listPages: async () => connected.client.listPages(),
      newPage: async (url, background) => connected.client.newPage(url, background),
      captureSnapshot: async () => runtime.captureSnapshot(),
      callTool: async (name, args) => runtime.callBrowserTool(name, args),
    };
    return this.browserBridge;
  }

  resolveLaunchOptions() {
    const env = this.browserUrl
      ? {
          ...this.env,
          SASIKI_BROWSER_URL: this.browserUrl,
        }
      : this.env;

    return resolveBrowserMcpLaunchOptions(env, {
      runningChromeCommands: this.runningChromeCommands,
    });
  }

  toPublicCaptureResult(result) {
    return {
      ok: true,
      snapshotRef: snapshotRefFromPath(result.snapshotPath),
      ...result,
      tabs: result.tabs,
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

function browserUrlFromLaunchOptions(launchOptions) {
  const index = launchOptions.args.findIndex((arg) => arg === "--browserUrl");
  if (index >= 0) {
    return launchOptions.args[index + 1] ?? null;
  }
  return null;
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
