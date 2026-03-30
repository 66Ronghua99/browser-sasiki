import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DefaultBrowserRuntime,
  parseTabInventory,
  resolveBrowserMcpLaunchOptions,
  runBrowserAction,
  runCaptureFlow,
  type BrowserActionDeps,
  type BrowserRuntime,
} from "../lib/browser-action.js";
import { querySnapshotText, type SnapshotQueryResult } from "../lib/knowledge-query.js";
import { KnowledgeStore } from "../lib/knowledge-store.js";
import { createConnectedMcpBrowserClient, type BrowserMcpLaunchOptions, type ToolCallResultLike } from "../lib/mcp-browser-client.js";
import { defaultRuntimeRoots } from "../lib/paths.js";
import { pageIdentityFromSnapshotText } from "../lib/page-identity.js";
import { SnapshotStore } from "../lib/snapshot-store.js";
import { TabBindingStore } from "../lib/tab-binding-store.js";
import type { ActionResult, CaptureResult, SkillPageIdentity } from "../lib/types.js";
import { assertSessionMetadata, type SessionMetadata } from "./session-metadata.js";
import { resolveSessionSocketPath } from "./session-paths.js";
import {
  assertSessionRpcRequest,
  type SessionCaptureResult,
  type SessionRpcMethod,
  type SessionRpcRequestEnvelope,
  type SessionRpcRequestMap,
  type SessionRpcResultBase,
} from "./session-rpc-types.js";
import { SessionSocketServer } from "./socket-server.js";

const DEFAULT_RUNTIME_VERSION = "0.1.0";
const DEFAULT_SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;

interface DaemonBridge {
  close(): Promise<void>;
  listPages(): Promise<string>;
  captureSnapshot(): Promise<string>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResultLike>;
}

export interface BrowserSessionDaemonOptions {
  env?: Record<string, string | undefined>;
  sessionRoot?: string;
  runtimeVersion?: string;
  runningChromeCommands?: string[];
  createMcpBridge?: (input: { launchOptions: BrowserMcpLaunchOptions }) => Promise<DaemonBridge>;
}

interface SessionPaths {
  tempRoot: string;
  sessionRoot: string;
  socketPath: string;
  metadataPath: string;
  snapshotsRoot: string;
  tabStateRoot: string;
  knowledgeFile: string;
}

interface ResolvedSnapshotContext {
  tabRef?: string;
  snapshotRef: string;
  snapshotPath: string;
  snapshotText: string;
  page: SkillPageIdentity;
}

export class BrowserSessionDaemon {
  private readonly env: Record<string, string | undefined>;
  private readonly paths: SessionPaths;
  private readonly runtimeVersion: string;
  private readonly runningChromeCommands: string[];
  private readonly createMcpBridgeOverride?: BrowserSessionDaemonOptions["createMcpBridge"];
  private readonly tabBindings: TabBindingStore;
  private readonly snapshots: SnapshotStore;
  private readonly knowledge: KnowledgeStore;
  private server: SessionSocketServer | null = null;
  private metadata: SessionMetadata | null = null;
  private launchOptions: BrowserMcpLaunchOptions | null = null;
  private browserBridge: DaemonBridge | null = null;
  private readonly browserRuntime: BrowserRuntime;
  private readonly actionDeps: BrowserActionDeps;

  constructor(options: BrowserSessionDaemonOptions = {}) {
    this.env = options.env ?? (process.env as Record<string, string | undefined>);
    this.paths = resolveSessionPaths(options.sessionRoot);
    this.runtimeVersion = options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION;
    this.runningChromeCommands = options.runningChromeCommands ?? [];
    this.createMcpBridgeOverride = options.createMcpBridge;
    this.tabBindings = new TabBindingStore(this.paths.tabStateRoot);
    this.snapshots = new SnapshotStore(this.paths.snapshotsRoot, {
      ttlMs: DEFAULT_SNAPSHOT_TTL_MS,
    });
    this.knowledge = new KnowledgeStore(this.paths.knowledgeFile);
    this.browserRuntime = {
      captureSnapshot: async () => {
        const bridge = await this.ensureBridge();
        return bridge.captureSnapshot();
      },
      callBrowserTool: async (name, args) => {
        const bridge = await this.ensureBridge();
        return bridge.callTool(name, args);
      },
      readActiveTabIndex: async () => {
        const bridge = await this.ensureBridge();
        const pageListText = await bridge.listPages();
        const activeTab = parseTabInventory(pageListText).find((tab) => tab.active);
        if (!activeTab) {
          throw new Error("unable to identify the current page from list_pages output");
        }
        return activeTab.index;
      },
    };
    this.actionDeps = {
      browser: this.browserRuntime,
      tabBindings: this.tabBindings,
      snapshots: this.snapshots,
      knowledge: this.knowledge,
    };
  }

  async start(): Promise<SessionMetadata> {
    if (this.server && this.metadata) {
      return this.metadata;
    }

    await mkdir(this.paths.sessionRoot, { recursive: true });
    await this.cleanupStaleArtifacts();
    this.launchOptions = resolveBrowserMcpLaunchOptions(this.env, {
      runningChromeCommands: this.runningChromeCommands,
    });

    const now = new Date().toISOString();
    this.metadata = {
      pid: process.pid,
      socketPath: this.paths.socketPath,
      browserUrl: browserUrlFromLaunchOptions(this.launchOptions),
      connectionMode: browserUrlFromLaunchOptions(this.launchOptions) ? "browserUrl" : "autoConnect",
      startedAt: now,
      lastSeenAt: now,
      runtimeVersion: this.runtimeVersion,
    };
    assertSessionMetadata(this.metadata);

    this.server = new SessionSocketServer(
      this.paths.socketPath,
      async (request) => this.handleEnvelope(request),
    );
    await this.server.listen();
    await this.writeMetadata();

    if (this.createMcpBridgeOverride) {
      await this.ensureBridge();
    }

    return this.metadata;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) {
      await server.close();
    }

    const bridge = this.browserBridge;
    this.browserBridge = null;
    if (bridge) {
      await bridge.close();
    }

    this.metadata = null;
    await rm(this.paths.metadataPath, { force: true }).catch(() => {});
    await rm(this.paths.socketPath, { force: true }).catch(() => {});
  }

  async handleRequest<M extends SessionRpcMethod>(
    method: M,
    params: SessionRpcRequestMap[M],
  ): Promise<unknown> {
    return this.dispatch({
      requestId: randomUUID(),
      method,
      params,
    });
  }

  private async handleEnvelope(request: SessionRpcRequestEnvelope): Promise<unknown> {
    assertSessionRpcRequest(request);
    return this.dispatch(request);
  }

  private async dispatch(request: SessionRpcRequestEnvelope): Promise<unknown> {
    await this.touch();

    switch (request.method) {
      case "health":
        return this.requireMetadata();
      case "shutdown": {
        const result = { ok: true as const };
        await this.stop();
        return result;
      }
      case "capture":
        return this.capture(request.params as SessionRpcRequestMap["capture"]);
      case "navigate": {
        const params = request.params as SessionRpcRequestMap["navigate"];
        return this.browserAction("navigate", "navigate_page", {
          type: "url",
          url: params.url,
        }, params.tabRef);
      }
      case "click": {
        const params = request.params as SessionRpcRequestMap["click"];
        return this.browserAction("click", "click", {
          uid: params.uid,
        }, params.tabRef);
      }
      case "type": {
        const params = request.params as SessionRpcRequestMap["type"];
        return this.browserAction("type", "fill", {
          uid: params.uid,
          value: params.text,
        }, params.tabRef);
      }
      case "press": {
        const params = request.params as SessionRpcRequestMap["press"];
        return this.browserAction("press", "press_key", {
          key: params.key,
        }, params.tabRef);
      }
      case "selectTab": {
        const params = request.params as SessionRpcRequestMap["selectTab"];
        return this.browserAction("select-tab", "select_page", {
          pageId: params.pageId,
          bringToFront: false,
        }, params.tabRef, {
          preselectBoundTab: false,
          nextBrowserTabIndex: params.pageId,
        });
      }
      case "querySnapshot":
        return this.querySnapshot(request.params as SessionRpcRequestMap["querySnapshot"]);
      case "readKnowledge":
        return this.readKnowledge(request.params as SessionRpcRequestMap["readKnowledge"]);
      case "recordKnowledge":
        return this.recordKnowledge(request.params as SessionRpcRequestMap["recordKnowledge"]);
    }
  }

  private async capture(params: SessionRpcRequestMap["capture"]): Promise<SessionCaptureResult> {
    const result = await runCaptureFlow(params, this.actionDeps);
    return this.toSessionCaptureResult(result);
  }

  private async browserAction(
    action: "navigate" | "click" | "type" | "press" | "select-tab",
    toolName: string,
    toolArgs: Record<string, unknown>,
    tabRef: string,
    options?: {
      preselectBoundTab?: boolean;
      nextBrowserTabIndex?: number;
    },
  ): Promise<SessionRpcResultBase> {
    const result = await runBrowserAction(
      {
        action,
        tabRef,
        toolName,
        toolArgs,
        preselectBoundTab: options?.preselectBoundTab,
        nextBrowserTabIndex: options?.nextBrowserTabIndex,
      },
      this.actionDeps,
    );

    return this.toSessionRpcResult(result);
  }

  private async querySnapshot(
    params: SessionRpcRequestMap["querySnapshot"],
  ): Promise<SnapshotQueryResult & Partial<SessionRpcResultBase> & { snapshotRef?: string; snapshotPath?: string }> {
    const resolved = await this.resolveSnapshotContext(params);
    const knowledgeHits = await this.readKnowledgeHits(resolved.page);
    const queryResult = querySnapshotText({
      snapshotText: resolved.snapshotText,
      mode: params.mode ?? "auto",
      text: params.query,
      uid: params.uid,
      ref: params.uid,
      knowledgeHits,
      page: resolved.page,
    });

    return {
      ...queryResult,
      ...(params.includeSnapshot ? { snapshotText: resolved.snapshotText } : {}),
      ...(resolved.tabRef !== undefined ? { tabRef: resolved.tabRef } : {}),
      snapshotRef: resolved.snapshotRef,
      snapshotPath: resolved.snapshotPath,
      knowledgeHits,
      summary: queryResult.summary,
    };
  }

  private async readKnowledge(params: SessionRpcRequestMap["readKnowledge"]): Promise<unknown> {
    if (params.knowledgeRef) {
      return {
        ok: true as const,
        mode: "id" as const,
        knowledge: await this.knowledge.readById(params.knowledgeRef),
      };
    }

    const page = params.page ?? (await this.resolveSnapshotContext(params)).page;
    return {
      ok: true as const,
      mode: "page" as const,
      page: {
        origin: page.origin,
        normalizedPath: page.normalizedPath,
      },
      knowledge: await this.knowledge.queryByPage(page),
    };
  }

  private async recordKnowledge(params: SessionRpcRequestMap["recordKnowledge"]): Promise<unknown> {
    const timestamp = new Date().toISOString();
    const snapshotPath = params.snapshotPath
      ?? (params.snapshotRef ? this.snapshotPathFromRef(params.snapshotRef) : undefined)
      ?? (params.tabRef ? (await this.tabBindings.read(params.tabRef)).snapshotPath : undefined);
    const id = params.knowledgeRef ?? `knowledge_${randomUUID()}`;
    const record = {
      id,
      page: {
        origin: params.page.origin,
        normalizedPath: params.page.normalizedPath,
      },
      guide: params.guide,
      keywords: [...params.keywords],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(snapshotPath ? { sourceSnapshotPath: snapshotPath } : {}),
      ...(params.rationale ? { rationale: params.rationale } : {}),
    };

    await this.knowledge.append(record);

    return {
      ok: true as const,
      record: {
        ...record,
        page: {
          ...params.page,
        },
      },
    };
  }

  private async resolveSnapshotContext(
    params: Pick<SessionRpcRequestMap["querySnapshot"], "tabRef" | "snapshotRef" | "snapshotPath">
      | Pick<SessionRpcRequestMap["readKnowledge"], "tabRef" | "snapshotRef" | "snapshotPath">,
  ): Promise<ResolvedSnapshotContext> {
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

    const snapshotPath = params.snapshotPath
      ? path.resolve(params.snapshotPath)
      : params.snapshotRef
        ? this.snapshotPathFromRef(params.snapshotRef)
        : undefined;
    if (!snapshotPath) {
      throw new Error("snapshot lookup requires tabRef, snapshotRef, or snapshotPath");
    }

    const snapshotText = await this.snapshots.read(snapshotPath);
    return {
      snapshotRef: snapshotRefFromPath(snapshotPath),
      snapshotPath,
      snapshotText,
      page: pageIdentityFromSnapshotText(snapshotText),
    };
  }

  private async readKnowledgeHits(page: SkillPageIdentity) {
    const records = await this.knowledge.queryByPage(page);
    return records.map((record) => ({
      guide: record.guide,
      keywords: [...record.keywords],
      rationale: record.rationale,
    }));
  }

  private async ensureBridge(): Promise<DaemonBridge> {
    if (this.browserBridge) {
      return this.browserBridge;
    }

    const launchOptions = this.launchOptions
      ?? resolveBrowserMcpLaunchOptions(this.env, {
        runningChromeCommands: this.runningChromeCommands,
      });
    this.launchOptions = launchOptions;

    if (this.createMcpBridgeOverride) {
      this.browserBridge = await this.createMcpBridgeOverride({ launchOptions });
      return this.browserBridge;
    }

    const connected = await createConnectedMcpBrowserClient(launchOptions, this.env);
    const runtime = new DefaultBrowserRuntime(connected.client);
    this.browserBridge = {
      close: connected.close,
      listPages: async () => connected.client.listPages(),
      captureSnapshot: async () => runtime.captureSnapshot(),
      callTool: async (name, args) => runtime.callBrowserTool(name, args),
    };
    return this.browserBridge;
  }

  private async touch(): Promise<void> {
    const metadata = this.requireMetadata();
    metadata.lastSeenAt = new Date().toISOString();
    await this.writeMetadata();
  }

  private requireMetadata(): SessionMetadata {
    if (!this.metadata) {
      throw new Error("browser-sessiond is not running");
    }
    return this.metadata;
  }

  private async writeMetadata(): Promise<void> {
    if (!this.metadata) {
      return;
    }
    await mkdir(path.dirname(this.paths.metadataPath), { recursive: true });
    await writeFile(this.paths.metadataPath, `${JSON.stringify(this.metadata, null, 2)}\n`, "utf8");
  }

  private async cleanupStaleArtifacts(): Promise<void> {
    const hasSocket = await pathExists(this.paths.socketPath);
    const hasMetadata = await pathExists(this.paths.metadataPath);

    if (hasMetadata) {
      try {
        const raw = JSON.parse(await readFile(this.paths.metadataPath, "utf8")) as unknown;
        assertSessionMetadata(raw);
      } catch {
        await rm(this.paths.metadataPath, { force: true }).catch(() => {});
      }
    }

    if (hasSocket) {
      await rm(this.paths.socketPath, { force: true }).catch(() => {});
    }
  }

  private snapshotPathFromRef(snapshotRef: string): string {
    return path.join(this.paths.snapshotsRoot, `${snapshotRef}.md`);
  }

  private toSessionRpcResult(result: {
    tabRef: string;
    page: SkillPageIdentity;
    snapshotPath: string;
    knowledgeHits: ActionResult["knowledgeHits"];
    summary: string;
  }): SessionRpcResultBase {
    return {
      ok: true,
      tabRef: result.tabRef,
      page: result.page,
      snapshotRef: snapshotRefFromPath(result.snapshotPath),
      snapshotPath: result.snapshotPath,
      knowledgeHits: result.knowledgeHits,
      summary: result.summary,
    };
  }

  private toSessionCaptureResult(result: CaptureResult): SessionCaptureResult {
    return {
      ...this.toSessionRpcResult(result),
      tabs: result.tabs,
    };
  }
}

function resolveSessionPaths(sessionRootOverride?: string): SessionPaths {
  const roots = defaultRuntimeRoots();
  const tempRoot = roots.tempRoot;
  const sessionRoot = sessionRootOverride ?? path.join(tempRoot, "session");
  return {
    tempRoot,
    sessionRoot,
    socketPath: resolveSessionSocketPath(sessionRoot, tempRoot),
    metadataPath: path.join(sessionRoot, "session.json"),
    snapshotsRoot: path.join(tempRoot, "snapshots"),
    tabStateRoot: path.join(tempRoot, "tab-state"),
    knowledgeFile: roots.knowledgeFile,
  };
}

function browserUrlFromLaunchOptions(launchOptions: BrowserMcpLaunchOptions): string | null {
  const index = launchOptions.args.findIndex((arg) => arg === "--browserUrl");
  if (index >= 0) {
    return launchOptions.args[index + 1] ?? null;
  }
  return null;
}

function snapshotRefFromPath(snapshotPath: string): string {
  return path.basename(snapshotPath, path.extname(snapshotPath));
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function readDaemonCliArg(argv: string[], key: string): string | undefined {
  const index = argv.indexOf(key);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

async function main(): Promise<void> {
  const sessionRoot = readDaemonCliArg(process.argv.slice(2), "--session-root");
  const runtimeVersion = readDaemonCliArg(process.argv.slice(2), "--runtime-version");
  const daemon = new BrowserSessionDaemon({
    sessionRoot,
    runtimeVersion,
  });

  await daemon.start();

  const shutdown = async () => {
    await daemon.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
