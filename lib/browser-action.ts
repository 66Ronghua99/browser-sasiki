import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { KnowledgeStore } from "./knowledge-store.js";
import { McpBrowserClient, type ToolCallResultLike, type ToolClientLike } from "./mcp-browser-client.js";
import { defaultRuntimeRoots } from "./paths.js";
import { pageIdentityFromSnapshotText } from "./page-identity.js";
import { SnapshotStore } from "./snapshot-store.js";
import { TabBindingStore } from "./tab-binding-store.js";
import type { ActionResult, CaptureResult, KnowledgeHit, SkillAction, SkillTabInventoryItem } from "./types.js";

const DEFAULT_SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;

export interface BrowserRuntime {
  captureSnapshot(): Promise<string>;
  callBrowserTool(name: string, args: Record<string, unknown>): Promise<ToolCallResultLike>;
  readActiveTabIndex(): Promise<number>;
}

export interface BrowserActionDeps {
  browser: BrowserRuntime;
  tabBindings: Pick<TabBindingStore, "read" | "write" | "exists">;
  snapshots: SnapshotStore;
  knowledge: Pick<KnowledgeStore, "queryByPage">;
}

interface DisposableBrowserActionDeps extends BrowserActionDeps {
  dispose(): Promise<void>;
}

export interface RunBrowserActionInput {
  action: SkillAction;
  tabRef: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  preselectBoundTab?: boolean;
  nextBrowserTabIndex?: number;
}

class DefaultBrowserRuntime implements BrowserRuntime {
  constructor(private readonly client: McpBrowserClient) {}

  async captureSnapshot(): Promise<string> {
    return this.client.captureSnapshot();
  }

  async callBrowserTool(name: string, args: Record<string, unknown>): Promise<ToolCallResultLike> {
    const result = await this.client.callBrowserTool(name, args);
    assertBrowserToolSucceeded(name, result);
    return result;
  }

  async readActiveTabIndex(): Promise<number> {
    const result = await this.callBrowserTool("browser_tabs", { action: "list" });
    const text = readToolText(result);
    if (!text) {
      return this.readActiveTabIndexFromSnapshot();
    }

    const activeTab = parseTabInventory(text).find((tab) => tab.active);
    if (!activeTab) {
      return this.readActiveTabIndexFromSnapshot();
    }

    return activeTab.index;
  }

  private async readActiveTabIndexFromSnapshot(): Promise<number> {
    const snapshotText = await this.captureSnapshot();
    const activeTab = parseTabInventory(snapshotText).find((tab) => tab.active);
    if (!activeTab) {
      throw new Error("unable to identify the current tab from browser_tabs list or snapshot inventory");
    }
    return activeTab.index;
  }
}

class InternalStdioToolClient implements ToolClientLike {
  private processStarted = false;
  private session: unknown | null = null;
  private transport: unknown | null = null;

  async connect(): Promise<void> {
    if (this.processStarted) {
      return;
    }

    const clientModule: any = await import("@modelcontextprotocol/sdk/client/index.js");
    const stdioModule: any = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new stdioModule.StdioClientTransport({
      command: process.env.SASIKI_BROWSER_MCP_COMMAND ?? "npx",
      args: parseCommandArgs(process.env.SASIKI_BROWSER_MCP_ARGS),
      env: process.env as Record<string, string>,
      stderr: "pipe",
    });
    const session = new clientModule.Client(
      { name: "sasiki-browser-skill", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    await session.connect(transport);
    this.transport = transport;
    this.session = session;
    this.processStarted = true;
  }

  async disconnect(): Promise<void> {
    const session: any = this.session;
    const transport: any = this.transport;

    if (session?.close) {
      await session.close();
    }
    if (transport?.close) {
      await transport.close();
    }

    this.session = null;
    this.transport = null;
    this.processStarted = false;
  }

  async listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>> {
    const session: any = this.requireSession();
    const result = await session.listTools();
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.map((item: any) => ({
      name: String(item?.name ?? ""),
      description: typeof item?.description === "string" ? item.description : undefined,
      inputSchema: toRecord(item?.inputSchema),
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResultLike> {
    const session: any = this.requireSession();
    return callToolWithLegacyFallback(session, name, args);
  }

  private requireSession(): unknown {
    if (!this.session) {
      throw new Error("MCP session is not connected");
    }
    return this.session;
  }
}

export async function runWithBrowserActionDeps<T>(
  deps: BrowserActionDeps | undefined,
  run: (resolvedDeps: BrowserActionDeps) => Promise<T>,
): Promise<T> {
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

export async function runBrowserAction(
  input: RunBrowserActionInput,
  deps: BrowserActionDeps,
): Promise<ActionResult> {
  const tabRef = requireNonEmptyString(input.tabRef, "tabRef");
  const binding = await deps.tabBindings.read(tabRef);

  if (input.preselectBoundTab !== false) {
    await deps.browser.callBrowserTool("browser_tabs", {
      action: "select",
      index: binding.browserTabIndex,
    });
  }

  await deps.browser.callBrowserTool(input.toolName, input.toolArgs);

  const snapshotText = await deps.browser.captureSnapshot();
  const capturedTabs = parseTabInventory(snapshotText);
  const { snapshotPath } = await deps.snapshots.write(snapshotText);
  const page = pageIdentityFromSnapshotText(snapshotText);
  const browserTabIndex = await resolveCapturedBrowserTabIndex(
    deps,
    capturedTabs,
    input.nextBrowserTabIndex ?? binding.browserTabIndex,
  );

  await deps.tabBindings.write({
    ...binding,
    browserTabIndex,
    snapshotPath,
    page,
  });

  const knowledgeHits = await readKnowledgeHits(deps, page.origin, page.normalizedPath);

  return {
    ok: true,
    action: input.action,
    tabRef,
    page,
    snapshotPath,
    knowledgeHits,
    summary: `${input.action} completed for ${tabRef} and captured a fresh snapshot.`,
  };
}

export async function runCaptureFlow(
  args: { tabIndex?: number; tabRef?: string },
  deps: BrowserActionDeps,
): Promise<CaptureResult> {
  await deps.snapshots.cleanupExpired();

  const providedTabRef = optionalNonEmptyString(args.tabRef, "tabRef");
  const resolvedTabIndex = await resolveCaptureTabIndex(args, deps, providedTabRef);

  await deps.browser.callBrowserTool("browser_tabs", {
    action: "select",
    index: resolvedTabIndex,
  });

  const snapshotText = await deps.browser.captureSnapshot();
  const { snapshotPath } = await deps.snapshots.write(snapshotText);
  const page = pageIdentityFromSnapshotText(snapshotText);
  const tabRef = providedTabRef ?? mintTabRef();

  await deps.tabBindings.write({
    tabRef,
    browserTabIndex: resolvedTabIndex,
    snapshotPath,
    page,
  });

  const knowledgeHits = await readKnowledgeHits(deps, page.origin, page.normalizedPath);

  return {
    ok: true,
    tabRef,
    page,
    tabs: parseTabInventory(snapshotText),
    snapshotPath,
    knowledgeHits,
    summary: providedTabRef
      ? `Refreshed ${tabRef} with a fresh snapshot.`
      : `Captured a fresh snapshot and bound the current tab to ${tabRef}.`,
  };
}

export function parseCliIntegerArg(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

export function parseCliBooleanArg(value: string | boolean | undefined): boolean | undefined {
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

export async function callToolWithLegacyFallback(
  session: { callTool: (...args: unknown[]) => Promise<unknown> },
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResultLike> {
  try {
    return toRecord(await session.callTool({ name, arguments: args }));
  } catch (error) {
    if (!shouldRetryLegacyCallTool(error)) {
      throw error;
    }
    return toRecord(await session.callTool(name, args));
  }
}

export function readCliStringArg(
  args: Record<string, string | boolean>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

export function optionalCliStringArg(
  args: Record<string, string | boolean>,
  key: string,
  label: string,
): string | undefined {
  const rawValue = args[key];
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
    throw new Error(`${label} requires a value (--${key})`);
  }
  return rawValue;
}

export function requireCliStringArg(
  args: Record<string, string | boolean>,
  key: string,
  label: string,
): string {
  const value = optionalCliStringArg(args, key, label);
  if (value === undefined) {
    throw new Error(`${label} is required (--${key})`);
  }
  return value;
}

export function requireCliIntegerArg(
  args: Record<string, string | boolean>,
  key: string,
  label: string,
): number {
  const value = optionalCliStringArg(args, key, label);
  if (value === undefined) {
    throw new Error(`${label} is required (--${key})`);
  }
  return parseCliIntegerArg(value, label) as number;
}

function parseCommandArgs(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return ["@playwright/mcp@latest"];
  }
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function createDefaultBrowserActionDeps(): Promise<DisposableBrowserActionDeps> {
  const roots = defaultRuntimeRoots();
  const toolClient = new InternalStdioToolClient();
  await toolClient.connect();
  const browser = new DefaultBrowserRuntime(new McpBrowserClient(toolClient));

  return {
    browser,
    tabBindings: new TabBindingStore(path.join(roots.tempRoot, "tab-state")),
    snapshots: new SnapshotStore(path.join(roots.tempRoot, "snapshots"), {
      ttlMs: DEFAULT_SNAPSHOT_TTL_MS,
    }),
    knowledge: new KnowledgeStore(roots.knowledgeFile),
    dispose: async () => {
      await toolClient.disconnect();
    },
  };
}

async function resolveCaptureTabIndex(
  args: { tabIndex?: number; tabRef?: string },
  deps: BrowserActionDeps,
  providedTabRef: string | undefined,
): Promise<number> {
  if (typeof args.tabIndex === "number") {
    if (!Number.isInteger(args.tabIndex) || args.tabIndex < 0) {
      throw new Error("tabIndex must be a non-negative integer");
    }
    return args.tabIndex;
  }

  if (providedTabRef) {
    const bindingExists = await deps.tabBindings.exists(providedTabRef);
    if (bindingExists) {
      const existingBinding = await deps.tabBindings.read(providedTabRef);
      return existingBinding.browserTabIndex;
    }
  }

  return deps.browser.readActiveTabIndex();
}

async function readKnowledgeHits(
  deps: BrowserActionDeps,
  origin: string,
  normalizedPath: string,
): Promise<KnowledgeHit[]> {
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

function mintTabRef(): string {
  return `tab_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

async function resolveCapturedBrowserTabIndex(
  deps: BrowserActionDeps,
  capturedTabs: SkillTabInventoryItem[],
  fallbackIndex: number,
): Promise<number> {
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

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, label);
}

function assertBrowserToolSucceeded(name: string, result: ToolCallResultLike): void {
  const text = readToolText(result);
  if (result.isError === true) {
    throw new Error(`${name} returned an MCP error result: ${text ?? JSON.stringify(result)}`);
  }
  if (text && /^###\s*Error\b/im.test(text)) {
    throw new Error(`${name} returned an error payload: ${text}`);
  }
}

function readToolText(result: ToolCallResultLike): string | null {
  if (typeof result === "string") {
    return result;
  }
  if (Array.isArray(result.content)) {
    for (const block of result.content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text;
      }
    }
  }
  return null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function shouldRetryLegacyCallTool(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.trim();
  return (
    /expects?\s+(?:a\s+)?tool name(?:\s+and\s+arguments)?/i.test(message) ||
    /expected\s+(?:a\s+)?(?:tool\s+name|string).*(?:arguments|object)/i.test(message) ||
    (error.name === "TypeError" && /\bcalltool\b/i.test(message) && /\b(name|arguments|object|string)\b/i.test(message))
  );
}

export function parseTabInventory(snapshotText: string): SkillTabInventoryItem[] {
  const lines = snapshotText.split(/\r?\n/);
  const tabs: SkillTabInventoryItem[] = [];
  let inOpenTabs = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "### Open tabs") {
      inOpenTabs = true;
      continue;
    }
    if (inOpenTabs && trimmed.startsWith("### ")) {
      break;
    }
    if (!inOpenTabs) {
      continue;
    }

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

    const title = (link.groups.title ?? "").trim() || "Untitled";
    const url = (link.groups.url ?? "").trim();
    if (!url) {
      continue;
    }

    tabs.push({
      index,
      title,
      url,
      active: /\(current\)/i.test(rest),
    });
  }

  return tabs;
}
