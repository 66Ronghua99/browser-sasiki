import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { KnowledgeStore } from "./knowledge-store.mjs";
import { McpBrowserClient } from "./mcp-browser-client.mjs";
import { defaultRuntimeRoots } from "./paths.mjs";
import { pageIdentityFromSnapshotText } from "./page-identity.mjs";
import { SnapshotStore } from "./snapshot-store.mjs";
import { TabBindingStore } from "./tab-binding-store.mjs";

const DEFAULT_SNAPSHOT_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_WORKSPACE_TAB_URL = "chrome://newtab/";

export class DefaultBrowserRuntime {
  constructor(client) {
    this.client = client;
  }

  async captureSnapshot() {
    return this.client.captureSnapshot();
  }

  async callBrowserTool(name, args) {
    const result = await this.client.callBrowserTool(name, args);
    assertBrowserToolSucceeded(name, result);
    return result;
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
    const pageListText = await this.client.newPage(DEFAULT_WORKSPACE_TAB_URL);
    const activeTab = parseTabInventory(pageListText).find((tab) => tab.active);
    if (activeTab) {
      return {
        pageId: activeTab.index,
        pageListText,
      };
    }
    return {
      pageId: await this.readActiveTabIndex(),
      pageListText,
    };
  }
}

export class InternalStdioToolClient {
  constructor(launchOptions) {
    this.launchOptions = launchOptions;
    this.processStarted = false;
    this.session = null;
    this.transport = null;
  }

  async connect() {
    if (this.processStarted) {
      return;
    }

    const launchOptions = this.launchOptions
      ?? resolveBrowserMcpLaunchOptions(process.env);
    const clientModule = await import("@modelcontextprotocol/sdk/client/index.js");
    const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new stdioModule.StdioClientTransport({
      command: launchOptions.command,
      args: launchOptions.args,
      env: process.env,
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

  async disconnect() {
    const session = this.session;
    const transport = this.transport;

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

  async listTools() {
    const session = this.requireSession();
    const result = await session.listTools();
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools.map((item) => ({
      name: String(item?.name ?? ""),
      description: typeof item?.description === "string" ? item.description : undefined,
      inputSchema: toRecord(item?.inputSchema),
    }));
  }

  async callTool(name, args) {
    const session = this.requireSession();
    return callToolWithLegacyFallback(session, name, args);
  }

  requireSession() {
    if (!this.session) {
      throw new Error("MCP session is not connected");
    }
    return this.session;
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

export async function runBrowserAction(input, deps) {
  const tabRef = requireNonEmptyString(input.tabRef, "tabRef");
  const binding = await deps.tabBindings.read(tabRef);

  if (input.preselectBoundTab !== false) {
    await selectCapturedPage(deps.browser, binding.browserTabIndex);
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

export async function runCaptureFlow(args, deps) {
  await deps.snapshots.cleanupExpired();

  const providedTabRef = optionalNonEmptyString(args.tabRef, "tabRef");
  const captureTarget = await resolveCaptureTarget(args, deps, providedTabRef);
  const rawSnapshotText = await deps.browser.captureSnapshot();
  const snapshotText = normalizeCapturedSnapshot(captureTarget.pageListText, rawSnapshotText, captureTarget.pageId);
  const { snapshotPath } = await deps.snapshots.write(snapshotText);
  const page = pageIdentityFromSnapshotText(snapshotText);
  const tabRef = providedTabRef ?? mintTabRef();

  await deps.tabBindings.write({
    tabRef,
    browserTabIndex: captureTarget.pageId,
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
    summary: captureTarget.createdWorkspaceTab
      ? `Captured a fresh snapshot and bound a new workspace tab to ${tabRef}.`
      : captureTarget.reusedBinding
        ? `Refreshed ${tabRef} with a fresh snapshot.`
        : `Captured a fresh snapshot and bound browser tab ${captureTarget.pageId} to ${tabRef}.`,
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

export async function callToolWithLegacyFallback(session, name, args) {
  try {
    return toRecord(await session.callTool({ name, arguments: args }));
  } catch (error) {
    if (!shouldRetryLegacyCallTool(error)) {
      throw error;
    }
    return toRecord(await session.callTool(name, args));
  }
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

export function resolveBrowserMcpLaunchOptions(
  env,
  options,
) {
  const explicitArgs = env.SASIKI_BROWSER_MCP_ARGS;
  if (explicitArgs && explicitArgs.trim().length > 0) {
    return {
      command: env.SASIKI_BROWSER_MCP_COMMAND ?? "npx",
      args: parseCommandArgs(explicitArgs),
    };
  }

  const explicitBrowserUrl = env.SASIKI_BROWSER_URL?.trim();
  if (explicitBrowserUrl) {
    return {
      command: env.SASIKI_BROWSER_MCP_COMMAND ?? "npx",
      args: ["chrome-devtools-mcp@latest", "--browserUrl", explicitBrowserUrl],
    };
  }

  const detectedBrowserUrl = detectRunningChromeBrowserUrl(options?.runningChromeCommands);
  if (detectedBrowserUrl) {
    return {
      command: env.SASIKI_BROWSER_MCP_COMMAND ?? "npx",
      args: ["chrome-devtools-mcp@latest", "--browserUrl", detectedBrowserUrl],
    };
  }

  return {
    command: env.SASIKI_BROWSER_MCP_COMMAND ?? "npx",
    args: ["chrome-devtools-mcp@latest", "--autoConnect"],
  };
}

function parseCommandArgs(value) {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function detectRunningChromeBrowserUrl(runningChromeCommands) {
  const commands = runningChromeCommands ?? readRunningChromeCommands();
  const preferredCommand = commands.find((command) => !/\s--type=/i.test(command));
  return parseBrowserUrlFromChromeCommand(preferredCommand)
    ?? commands.map((command) => parseBrowserUrlFromChromeCommand(command)).find((url) => url !== undefined);
}

function readRunningChromeCommands() {
  try {
    const output = execFileSync("ps", ["axo", "command"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && /Chrome|Chromium/i.test(line));
  } catch {
    return [];
  }
}

function parseBrowserUrlFromChromeCommand(command) {
  if (!command || !/--remote-debugging-port=\d+/i.test(command)) {
    return undefined;
  }

  const portMatch = command.match(/--remote-debugging-port=(\d+)/i);
  if (!portMatch) {
    return undefined;
  }

  const addressMatch = command.match(/--remote-debugging-address=([^\s]+)/i);
  const address = addressMatch?.[1]?.trim() || "127.0.0.1";
  return `http://${address}:${portMatch[1]}`;
}

async function createDefaultBrowserActionDeps() {
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

async function resolveCaptureTarget(
  args,
  deps,
  providedTabRef,
) {
  if (typeof args.pageId === "number") {
    if (!Number.isInteger(args.pageId) || args.pageId < 0) {
      throw new Error("pageId must be a non-negative integer");
    }
    return {
      pageId: args.pageId,
      pageListText: await selectCapturedPage(deps.browser, args.pageId),
      createdWorkspaceTab: false,
      reusedBinding: false,
    };
  }

  if (providedTabRef) {
    const bindingExists = await deps.tabBindings.exists(providedTabRef);
    if (bindingExists) {
      const existingBinding = await deps.tabBindings.read(providedTabRef);
      try {
        return {
          pageId: existingBinding.browserTabIndex,
          pageListText: await selectCapturedPage(deps.browser, existingBinding.browserTabIndex),
          createdWorkspaceTab: false,
          reusedBinding: true,
        };
      } catch (error) {
        if (!isMissingCapturedPageError(error)) {
          throw error;
        }
      }

      const reboundWorkspaceTab = await deps.browser.openWorkspaceTab();
      return {
        pageId: reboundWorkspaceTab.pageId,
        pageListText: reboundWorkspaceTab.pageListText,
        createdWorkspaceTab: true,
        reusedBinding: false,
      };
    }
  }

  const workspaceTab = await deps.browser.openWorkspaceTab();
  return {
    pageId: workspaceTab.pageId,
    pageListText: workspaceTab.pageListText,
    createdWorkspaceTab: true,
    reusedBinding: false,
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

function mintTabRef() {
  return `tab_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
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

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalNonEmptyString(value, label) {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, label);
}

function assertBrowserToolSucceeded(name, result) {
  const text = readToolText(result);
  if (result.isError === true) {
    throw new Error(`${name} returned an MCP error result: ${text ?? JSON.stringify(result)}`);
  }
  if (text && /^###\s*Error\b/im.test(text)) {
    throw new Error(`${name} returned an error payload: ${text}`);
  }
}

function isMissingCapturedPageError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  return /select_page/i.test(error.message) && /no page found/i.test(error.message);
}

async function selectCapturedPage(browser, pageId) {
  const result = await browser.callBrowserTool("select_page", {
    pageId,
    bringToFront: true,
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

function toRecord(value) {
  if (value && typeof value === "object") {
    return value;
  }
  return {};
}

function shouldRetryLegacyCallTool(error) {
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
