import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright-core";

const DEFAULT_BROWSER_URL = "http://127.0.0.1:9222";
const DEFAULT_WORKSPACE_TAB_URL = "chrome://newtab/";
const INTERACTIVE_AX_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);
const INTERACTIVE_DOM_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);
const INTERACTIVE_LISTENER_TYPES = new Set([
  "click",
  "dblclick",
  "mousedown",
  "mouseup",
  "pointerdown",
  "pointerup",
  "touchstart",
  "touchend",
  "keydown",
  "keyup",
  "keypress",
  "input",
  "change",
  "submit",
]);

export class DevtoolsBrowserClient {
  constructor(browser, options = {}) {
    this.browser = browser;
    this.workspaceTabUrl = options.workspaceTabUrl ?? DEFAULT_WORKSPACE_TAB_URL;
    this.snapshotHandlesByPage = new Map();
    this.snapshotUidAliasesByPage = new Map();
  }

  async captureSnapshot() {
    const page = await this.resolvePage({ allowFirstPageFallback: true });
    return this.captureSnapshotForPage(this.findPageId(page));
  }

  async listPages() {
    const inventory = await this.listLivePageInventory();
    return formatPageInventory(
      inventory.map((page) => ({
        pageId: page.pageId,
        url: page.url,
        title: page.title,
      })),
      await this.readActivePageId(),
    );
  }

  async listLivePages() {
    const pages = this.listContextPages();
    return Promise.all(
      pages.map(async (page, pageId) => ({
        pageId,
        url: readPageUrl(page),
        title: await readPageTitle(page),
      })),
    );
  }

  async listLivePageInventory() {
    const pages = this.listContextPages();
    return Promise.all(
      pages.map(async (page, pageId) => {
        const pageInfo = await this.readPageTargetInfo(page);
        const url = pageInfo.url || readPageUrl(page);
        const title = pageInfo.title || await readPageTitleSafely(page, url);
        return {
          pageId,
          targetId: pageInfo.targetId,
          openerId: pageInfo.openerId,
          url,
          title,
        };
      }),
    );
  }

  async captureSnapshotForPage(pageId) {
    const page = await this.resolvePage({ pageId });
    const snapshot = await this.captureAccessibilitySnapshot(page, pageId);
    this.snapshotHandlesByPage.set(pageId, snapshot.handles);
    this.snapshotUidAliasesByPage.set(pageId, snapshot.uidAliases);
    return snapshot.snapshotText;
  }

  async listLiveTargets() {
    const context = this.requirePrimaryContext();
    const sessionOwner = await ensureTargetSessionOwner(context);
    const session = await context.newCDPSession(sessionOwner.page);

    try {
      const result = await session.send("Target.getTargets");
      return Array.isArray(result?.targetInfos)
        ? result.targetInfos.map((targetInfo) => sanitizeTargetInfo(targetInfo))
        : [];
    } finally {
      await session.detach?.();
      if (sessionOwner.createdTemporaryPage) {
        await sessionOwner.page.close?.();
      }
    }
  }

  async openWorkspaceTab(url = this.workspaceTabUrl, options = {}) {
    const context = this.requirePrimaryContext();
    const page = await context.newPage();

    if (shouldNavigateToWorkspaceUrl(url)) {
      await page.goto(url);
    }

    const pageId = this.findPageId(page);

    if (options.bringToFront === true) {
      await page.bringToFront?.();
    }

    const targetInfo = await this.readPageTargetInfo(page);

    return {
      pageId,
      targetId: targetInfo.targetId,
      url: readPageUrl(page),
      title: await readPageTitle(page),
    };
  }

  async newPage(url = this.workspaceTabUrl, background = false) {
    const page = await this.openWorkspaceTab(url, {
      bringToFront: background !== true,
    });
    const activePageId = background === true ? await this.readActivePageId() : page.pageId;
    return formatPageInventory(await this.listLivePages(), activePageId);
  }

  async selectPage(pageId, bringToFront = true) {
    const page = await this.resolvePage({ pageId });

    if (bringToFront) {
      await page.bringToFront?.();
    }

    return formatPageInventory(await this.listLivePages(), await this.readActivePageId());
  }

  async click(input) {
    const page = await this.resolveDomActionPage(input);
    const snapshotHandle = this.resolveSnapshotHandle(page, input);
    if (snapshotHandle) {
      await this.callNodeFunction(page, snapshotHandle.backendDOMNodeId, CLICK_FUNCTION_DECLARATION);
      return;
    }
    await page.locator(resolveSelector(input)).click();
  }

  async fill(input) {
    const page = await this.resolveDomActionPage(input);
    const value = requireNonEmptyString(input.value, "value");
    const snapshotHandle = this.resolveSnapshotHandle(page, input);
    if (snapshotHandle) {
      await this.callNodeFunction(page, snapshotHandle.backendDOMNodeId, FILL_FUNCTION_DECLARATION, [value]);
      return;
    }
    await page.locator(resolveSelector(input)).fill(value);
  }

  async press(input) {
    const page = await this.resolveDomActionPage(input);
    await page.keyboard.press(requireNonEmptyString(input.key, "key"));
  }

  async callBrowserTool(name, args = {}) {
    switch (name) {
      case "list_pages":
        return textResult(await this.listPages());
      case "new_page":
        return textResult(await this.newPage(args.url, args.background === true));
      case "select_page":
        return textResult(await this.selectPage(requirePageId(args.pageId), args.bringToFront !== false));
      case "navigate_page": {
        const page = await this.resolvePage({ pageId: requirePageId(args.pageId) });
        const url = normalizeNavigateUrl(args);
        await page.goto(url);
        return textResult(`navigated:${url}`);
      }
      case "click": {
        const actionInput = resolveActionTargetInput(args);
        await this.click(args.pageId !== undefined
          ? {
            pageId: requirePageId(args.pageId),
            ...actionInput,
          }
          : actionInput);
        return textResult(`clicked:${describeActionTarget(actionInput)}`);
      }
      case "fill": {
        const actionInput = resolveActionTargetInput(args);
        await this.fill(args.pageId !== undefined
          ? {
            pageId: requirePageId(args.pageId),
            ...actionInput,
            value: args.value,
          }
          : {
            ...actionInput,
            value: args.value,
          });
        return textResult(`filled:${describeActionTarget(actionInput)}`);
      }
      case "press_key":
        await this.press(
          args.pageId !== undefined
            ? {
              pageId: requirePageId(args.pageId),
              key: args.key,
            }
            : {
              key: args.key,
            },
        );
        return textResult(`pressed:${args.key}`);
      default:
        throw new Error(`Unsupported browser tool: ${name}`);
    }
  }

  listContextPages() {
    return this.requirePrimaryContext().pages();
  }

  requirePrimaryContext() {
    const context = this.browser?.contexts?.()[0];
    if (!context) {
      throw new Error("No Chromium browser context is attached over CDP");
    }
    return context;
  }

  findPageId(page) {
    const pageId = this.listContextPages().indexOf(page);
    if (pageId < 0) {
      throw new Error("resolved page is not tracked in the active browser context");
    }
    return pageId;
  }

  async resolveDomActionPage(input) {
    if (Number.isInteger(input.pageId) && input.pageId >= 0) {
      return this.resolvePage({ pageId: input.pageId });
    }

    if (typeof input.uid === "string" && input.uid.trim().length > 0) {
      const pageId = this.findPageIdForSnapshotHandle(input.uid);
      return this.resolvePage({ pageId });
    }

    throw new Error("pageId is required when resolving selector-based browser actions");
  }

  async resolvePage({ pageId, allowFirstPageFallback = false }) {
    const pages = this.listContextPages();

    if (Number.isInteger(pageId) && pageId >= 0) {
      const page = pages[pageId];
      if (page) {
        return page;
      }
      throw new Error(`No page found for pageId ${pageId}`);
    }

    if (allowFirstPageFallback && pages[0]) {
      return pages[0];
    }

    throw new Error("No attached pages are available");
  }

  async captureAccessibilitySnapshot(page, pageId) {
    const title = await readPageTitle(page);
    const url = readPageUrl(page);
    return this.withPageSession(page, async (session) => {
      await session.send("Accessibility.enable");
      const result = await session.send("Accessibility.getFullAXTree");
      const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
      const normalizedNodes = normalizeAXNodes(nodes);
      await enrichAXNodesWithDom(session, normalizedNodes);
      const rootNode = selectRootAXNode(normalizedNodes) ?? createFallbackRootNode(title);
      const handles = new Map();
      const lines = [
        "## Latest page snapshot",
        formatAXSnapshotLine(rootNode, 0, {
          title,
          url,
        }),
      ];

      const rendered = new Set([rootNode.nodeId]);
      const appendChildren = (node, depth) => {
        for (const childId of node.childIds) {
          const child = normalizedNodes.get(childId);
          if (!child || rendered.has(child.nodeId)) {
            continue;
          }
          rendered.add(child.nodeId);
          if (shouldRenderAXNode(child)) {
            lines.push(formatAXSnapshotLine(child, depth));
            if (child.backendDOMNodeId !== null) {
              handles.set(child.nodeId, {
                backendDOMNodeId: child.backendDOMNodeId,
              });
            }
            appendChildren(child, depth + 1);
            continue;
          }
          appendChildren(child, depth);
        }
      };

      appendChildren(rootNode, 1);
      if (rootNode.backendDOMNodeId !== null) {
        handles.set(rootNode.nodeId, {
          backendDOMNodeId: rootNode.backendDOMNodeId,
        });
      }
      const uidAliases = new Map();
      for (const node of normalizedNodes.values()) {
        if (typeof node.actionableUid === "string" && node.actionableUid.trim().length > 0) {
          uidAliases.set(node.nodeId, node.actionableUid);
        }
      }
      return {
        snapshotText: lines.join("\n"),
        handles,
        uidAliases,
        pageId,
      };
    });
  }

  resolveSnapshotHandle(page, input) {
    const uid = typeof input.uid === "string" && input.uid.trim().length > 0 ? input.uid : null;
    if (!uid) {
      return null;
    }

    const pageId = this.findPageId(page);
    const handles = this.snapshotHandlesByPage.get(pageId);
    const resolvedUid = this.resolveSnapshotUidForPage(pageId, uid);
    const handle = handles?.get(resolvedUid);
    if (!handle) {
      throw new Error(`No live snapshot handle exists for uid ${uid}; re-run /query on the current workspace page.`);
    }
    return handle;
  }

  findPageIdForSnapshotHandle(uid) {
    for (const [pageId, handles] of this.snapshotHandlesByPage.entries()) {
      const resolvedUid = this.resolveSnapshotUidForPage(pageId, uid);
      if (handles?.has(resolvedUid)) {
        return pageId;
      }
    }

    throw new Error(`No live snapshot handle exists for uid ${uid}; re-run /query on the current workspace page.`);
  }

  resolveSnapshotUidForPage(pageId, uid) {
    const handles = this.snapshotHandlesByPage.get(pageId);
    if (handles?.has(uid)) {
      return uid;
    }

    const aliases = this.snapshotUidAliasesByPage.get(pageId);
    let candidateUid = uid;
    const seen = new Set();
    while (typeof candidateUid === "string" && candidateUid.length > 0 && !seen.has(candidateUid)) {
      seen.add(candidateUid);
      const nextUid = aliases?.get(candidateUid);
      if (!nextUid) {
        return candidateUid;
      }
      if (handles?.has(nextUid)) {
        return nextUid;
      }
      candidateUid = nextUid;
    }

    return uid;
  }

  async callNodeFunction(page, backendDOMNodeId, functionDeclaration, argumentsList = []) {
    await this.withPageSession(page, async (session) => {
      const objectId = await resolveNodeObjectId(session, backendDOMNodeId);
      if (!objectId) {
        throw new Error(`Unable to resolve backendDOMNodeId ${backendDOMNodeId}`);
      }

      await session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration,
        arguments: argumentsList.map((value) => ({ value })),
        returnByValue: true,
        awaitPromise: true,
      });
    });
  }

  async withPageSession(page, run) {
    const context = this.requirePrimaryContext();
    const session = await context.newCDPSession(page);
    try {
      return await run(session);
    } finally {
      await session.detach?.();
    }
  }

  async readPageTargetInfo(page) {
    return this.withPageSession(page, async (session) => {
      const result = await session.send("Target.getTargetInfo");
      return sanitizeTargetInfo(result?.targetInfo);
    });
  }

  async readActivePageId() {
    const pages = this.listContextPages();
    const activities = await Promise.all(pages.map(async (page, pageId) => ({
      pageId,
      ...(await this.readPageActivity(page)),
    })));
    const focused = activities.find((page) => page.hasFocus === true);
    if (focused) {
      return focused.pageId;
    }
    const visible = activities.find((page) => page.visibilityState === "visible" || page.hidden === false);
    return visible?.pageId;
  }

  async readPageActivity(page) {
    if (typeof page.evaluate !== "function") {
      return {
        hasFocus: false,
        visibilityState: "",
        hidden: true,
      };
    }

    try {
      const state = await readPageActivitySafely(page);
      if (!state || typeof state !== "object") {
        return {
          hasFocus: false,
          visibilityState: "",
          hidden: true,
        };
      }
      const activity = {
        hasFocus: state?.hasFocus === true,
        visibilityState: typeof state?.visibilityState === "string" ? state.visibilityState : "",
        hidden: state?.hidden !== false,
      };
      return activity;
    } catch {
      return {
        hasFocus: false,
        visibilityState: "",
        hidden: true,
      };
    }
  }
}

export async function createConnectedDevtoolsBrowserClient(options = {}, dependencies = {}) {
  const env = options.env ?? process.env;
  const browserUrl = options.browserUrl
    ?? resolveBrowserDevtoolsUrl(env, {
      runningChromeCommands: options.runningChromeCommands,
    });
  const connectOverCDP = dependencies.connectOverCDP ?? ((targetBrowserUrl) => chromium.connectOverCDP(targetBrowserUrl));
  const browser = await connectOverCDP(browserUrl);

  return {
    browserUrl,
    client: new DevtoolsBrowserClient(browser, options),
    onDisconnect(listener) {
      if (typeof listener !== "function") {
        throw new TypeError("onDisconnect listener must be a function");
      }

      if (typeof browser.once === "function") {
        browser.once("disconnected", () => {
          listener(new Error("Browser disconnected"));
        });
        return;
      }

      browser.on?.("disconnected", () => {
        listener(new Error("Browser disconnected"));
      });
    },
    close: async () => {
      await browser.close?.();
    },
  };
}

export function resolveBrowserDevtoolsUrl(env = process.env, options = {}) {
  const explicitBrowserUrl = env.SASIKI_BROWSER_URL?.trim();
  if (explicitBrowserUrl) {
    return explicitBrowserUrl;
  }

  const devtoolsActivePortBrowserUrl = detectDevtoolsActivePortBrowserUrl(env, options);
  if (devtoolsActivePortBrowserUrl) {
    return devtoolsActivePortBrowserUrl;
  }

  return detectRunningChromeBrowserUrl(options.runningChromeCommands) ?? DEFAULT_BROWSER_URL;
}

function normalizeNavigateUrl(args) {
  if (typeof args.url === "string" && args.url.trim().length > 0) {
    return args.url;
  }
  if (args.type === "url" && typeof args.url === "string" && args.url.trim().length > 0) {
    return args.url;
  }
  throw new Error("navigate_page requires a non-empty url");
}

function shouldNavigateToWorkspaceUrl(url) {
  return typeof url === "string" && url.trim().length > 0 && url !== DEFAULT_WORKSPACE_TAB_URL;
}

async function ensureTargetSessionOwner(context) {
  const existingPage = context.pages()[0];
  if (existingPage) {
    return {
      page: existingPage,
      createdTemporaryPage: false,
    };
  }

  const page = await context.newPage();
  return {
    page,
    createdTemporaryPage: true,
  };
}

async function readPageTitle(page) {
  const title = await page.title?.();
  if (typeof title === "string" && title.trim().length > 0) {
    return title;
  }
  return readPageUrl(page);
}

async function readPageTitleSafely(page, fallbackTitle) {
  try {
    return await Promise.race([
      readPageTitle(page),
      new Promise((resolve) => setTimeout(() => resolve(fallbackTitle), 25)),
    ]);
  } catch {
    return fallbackTitle;
  }
}

async function readPageActivitySafely(page) {
  return Promise.race([
    page.evaluate(() => ({
      hasFocus: document.hasFocus(),
      visibilityState: document.visibilityState,
      hidden: document.hidden,
    })),
    new Promise((resolve) => setTimeout(() => resolve(null), 25)),
  ]);
}

function readPageUrl(page) {
  const url = page.url?.();
  return typeof url === "string" && url.trim().length > 0 ? url : "about:blank";
}

function formatPageInventory(pages, activePageId) {
  const lines = ["## Pages"];
  for (const page of pages) {
    lines.push(`- ${page.pageId} ${page.pageId === activePageId ? "(current) " : ""}[${escapeMarkdownLabel(page.title)}](${page.url})`);
  }
  return lines.join("\n");
}

function sanitizeTargetInfo(targetInfo) {
  return {
    targetId: typeof targetInfo?.targetId === "string" ? targetInfo.targetId : "",
    openerId: typeof targetInfo?.openerId === "string" ? targetInfo.openerId : "",
    type: typeof targetInfo?.type === "string" ? targetInfo.type : "",
    title: typeof targetInfo?.title === "string" ? targetInfo.title : "",
    url: typeof targetInfo?.url === "string" ? targetInfo.url : "",
    attached: targetInfo?.attached === true,
  };
}

function resolveSelector(input) {
  if (typeof input.selector === "string" && input.selector.trim().length > 0) {
    return input.selector;
  }
  throw new Error("A selector is required when no live snapshot uid mapping is available for DOM actions");
}

function resolveActionTargetInput(input) {
  if (typeof input.uid === "string" && input.uid.trim().length > 0) {
    return {
      uid: input.uid,
    };
  }

  return {
    selector: resolveSelector(input),
  };
}

function describeActionTarget(input) {
  if (typeof input.uid === "string" && input.uid.trim().length > 0) {
    return input.uid;
  }
  return input.selector;
}

function requirePageId(pageId) {
  if (!Number.isInteger(pageId) || pageId < 0) {
    throw new Error("pageId must be a non-negative integer");
  }
  return pageId;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function escapeMarkdownLabel(value) {
  return String(value ?? "").replace(/\]/g, "\\]");
}

function textResult(text) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

const CLICK_FUNCTION_DECLARATION = String.raw`
function() {
  this.scrollIntoView?.({ block: "center", inline: "center" });
  this.click();
  return true;
}
`;

const FILL_FUNCTION_DECLARATION = String.raw`
function(value) {
  this.scrollIntoView?.({ block: "center", inline: "center" });
  this.focus?.();
  if (typeof this.value === "string") {
    this.value = value;
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  if (this.isContentEditable) {
    this.textContent = value;
    this.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    return true;
  }
  throw new Error("Element is not fillable");
}
`;

const INSPECT_INTERACTION_FUNCTION_DECLARATION = String.raw`
function() {
  const computedStyle = typeof getComputedStyle === "function" ? getComputedStyle(this) : null;
  const tagName = typeof this.tagName === "string" ? this.tagName.toLowerCase() : "";
  const role = typeof this.getAttribute === "function" ? (this.getAttribute("role") || "").trim().toLowerCase() : "";
  const href = typeof this.getAttribute === "function" ? this.getAttribute("href") : "";
  const inputType = tagName === "input" && typeof this.type === "string" ? this.type.toLowerCase() : "";
  return {
    tagName,
    role,
    tabIndex: typeof this.tabIndex === "number" ? this.tabIndex : -1,
    disabled: this.matches?.(":disabled") === true || this.disabled === true,
    readOnly: this.readOnly === true,
    isContentEditable: this.isContentEditable === true,
    hasHref: typeof href === "string" && href.trim().length > 0,
    inputType,
    cursor: computedStyle?.cursor || "",
    pointerEvents: computedStyle?.pointerEvents || "",
  };
}
`;

function normalizeAXNodes(nodes) {
  const map = new Map();
  for (const node of nodes) {
    const nodeId = typeof node?.nodeId === "string" ? node.nodeId : "";
    if (!nodeId) {
      continue;
    }
    map.set(nodeId, {
      nodeId,
      role: readAXValue(node?.role),
      name: readAXValue(node?.name),
      value: readAXValue(node?.value),
      ignored: node?.ignored === true,
      parentId: typeof node?.parentId === "string" ? node.parentId : null,
      childIds: Array.isArray(node?.childIds) ? node.childIds.filter((value) => typeof value === "string") : [],
      backendDOMNodeId: Number.isInteger(node?.backendDOMNodeId) ? node.backendDOMNodeId : null,
      interactive: false,
      actionableUid: null,
    });
  }

  for (const node of map.values()) {
    for (const childId of node.childIds) {
      const child = map.get(childId);
      if (child && !child.parentId) {
        child.parentId = node.nodeId;
      }
    }
  }

  return map;
}

function selectRootAXNode(nodes) {
  for (const node of nodes.values()) {
    if (node.role === "RootWebArea") {
      return node;
    }
  }
  return nodes.values().next().value ?? null;
}

function createFallbackRootNode(title) {
  return {
    nodeId: "root",
    role: "RootWebArea",
    name: title,
    value: "",
    ignored: false,
    parentId: null,
    childIds: [],
    backendDOMNodeId: null,
  };
}

function shouldRenderAXNode(node) {
  if (!node.role || node.ignored) {
    return false;
  }
  if (node.role === "InlineTextBox") {
    return false;
  }
  return true;
}

function formatAXSnapshotLine(node, depth, options = {}) {
  const indent = "  ".repeat(depth);
  const role = node.role || "generic";
  const label = depth === 0
    ? requireNonEmptyString(options.title ?? node.name ?? readFallbackLabel(node), "title")
    : node.name || readFallbackLabel(node);
  const suffixTokens = [];
  if (depth === 0) {
    suffixTokens.push(`url=${JSON.stringify(options.url ?? "about:blank")}`);
  }
  if (node.interactive === true) {
    suffixTokens.push("interactive=true");
  }
  if (typeof node.actionableUid === "string" && node.actionableUid.trim().length > 0) {
    suffixTokens.push(`actionableUid=${node.actionableUid}`);
  }
  const suffix = suffixTokens.length > 0 ? ` ${suffixTokens.join(" ")}` : "";
  return `${indent}uid=${node.nodeId} ${role}${label ? ` ${JSON.stringify(label)}` : ""}${suffix}`;
}

function readFallbackLabel(node) {
  if (node.value) {
    return node.value;
  }
  return "";
}

function readAXValue(value) {
  return typeof value?.value === "string" ? value.value.trim() : "";
}

async function enrichAXNodesWithDom(session, nodes) {
  for (const node of nodes.values()) {
    node.interactive = await isNodeInteractive(session, node);
  }

  for (const node of nodes.values()) {
    if (node.interactive) {
      continue;
    }
    node.actionableUid = findNearestActionableAncestorUid(nodes, node);
  }
}

async function isNodeInteractive(session, node) {
  if (node.backendDOMNodeId === null) {
    return false;
  }

  const domMetadata = await inspectDomInteractionMetadata(session, node.backendDOMNodeId);
  if (domMetadata.disabled === true || domMetadata.pointerEvents === "none") {
    return false;
  }

  if (INTERACTIVE_AX_ROLES.has(normalizeRole(node.role))) {
    return true;
  }
  if (INTERACTIVE_DOM_ROLES.has(normalizeRole(domMetadata.role))) {
    return true;
  }
  if (isNaturallyInteractiveTag(domMetadata)) {
    return true;
  }
  if (domMetadata.isContentEditable === true) {
    return true;
  }
  if (typeof domMetadata.tabIndex === "number" && domMetadata.tabIndex >= 0) {
    return true;
  }
  if (hasInteractiveListener(domMetadata.listeners)) {
    return true;
  }
  if (domMetadata.cursor === "pointer") {
    return true;
  }

  return false;
}

function findNearestActionableAncestorUid(nodes, node) {
  let currentParentId = node.parentId;
  while (typeof currentParentId === "string" && currentParentId.length > 0) {
    const parent = nodes.get(currentParentId);
    if (!parent) {
      return null;
    }
    if (parent.interactive === true && shouldRenderAXNode(parent)) {
      return parent.nodeId;
    }
    currentParentId = parent.parentId;
  }
  return null;
}

async function inspectDomInteractionMetadata(session, backendDOMNodeId) {
  try {
    const objectId = await resolveNodeObjectId(session, backendDOMNodeId);
    if (!objectId) {
      return emptyDomInteractionMetadata();
    }

    const [listenerResult, domResult] = await Promise.all([
      session.send("DOMDebugger.getEventListeners", {
        objectId,
      }).catch(() => ({ listeners: [] })),
      session.send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: INSPECT_INTERACTION_FUNCTION_DECLARATION,
        returnByValue: true,
        awaitPromise: true,
      }).catch(() => ({ result: { value: {} } })),
    ]);

    return sanitizeDomInteractionMetadata(
      domResult?.result?.value,
      Array.isArray(listenerResult?.listeners) ? listenerResult.listeners : [],
    );
  } catch {
    return emptyDomInteractionMetadata();
  }
}

async function resolveNodeObjectId(session, backendDOMNodeId) {
  const resolved = await session.send("DOM.resolveNode", {
    backendNodeId: backendDOMNodeId,
  });
  return resolved?.object?.objectId;
}

function sanitizeDomInteractionMetadata(value, listeners) {
  return {
    ...emptyDomInteractionMetadata(),
    tagName: typeof value?.tagName === "string" ? value.tagName.trim().toLowerCase() : "",
    role: typeof value?.role === "string" ? value.role.trim().toLowerCase() : "",
    tabIndex: typeof value?.tabIndex === "number" ? value.tabIndex : -1,
    disabled: value?.disabled === true,
    readOnly: value?.readOnly === true,
    isContentEditable: value?.isContentEditable === true,
    hasHref: value?.hasHref === true,
    inputType: typeof value?.inputType === "string" ? value.inputType.trim().toLowerCase() : "",
    cursor: typeof value?.cursor === "string" ? value.cursor.trim().toLowerCase() : "",
    pointerEvents: typeof value?.pointerEvents === "string" ? value.pointerEvents.trim().toLowerCase() : "",
    listeners: listeners
      .map((listener) => (typeof listener?.type === "string" ? listener.type.trim().toLowerCase() : ""))
      .filter((type) => type.length > 0),
  };
}

function emptyDomInteractionMetadata() {
  return {
    tagName: "",
    role: "",
    tabIndex: -1,
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    hasHref: false,
    inputType: "",
    cursor: "",
    pointerEvents: "",
    listeners: [],
  };
}

function normalizeRole(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isNaturallyInteractiveTag(domMetadata) {
  if (domMetadata.tagName === "a" && domMetadata.hasHref) {
    return true;
  }
  if (domMetadata.tagName === "button" || domMetadata.tagName === "select" || domMetadata.tagName === "textarea" || domMetadata.tagName === "summary" || domMetadata.tagName === "option") {
    return true;
  }
  if (domMetadata.tagName === "input" && domMetadata.inputType !== "hidden") {
    return true;
  }
  return false;
}

function hasInteractiveListener(listeners) {
  return listeners.some((type) => INTERACTIVE_LISTENER_TYPES.has(type));
}

function detectDevtoolsActivePortBrowserUrl(env, options = {}) {
  const chromeCommands = options.runningChromeCommands ?? readRunningChromeCommands();
  const chromeCommandInfos = chromeCommands
    .map((command) => parseChromeCommandDebugInfo(command))
    .filter((info) => info !== null);
  const candidatePathInfos = buildDevtoolsActivePortCandidateInfos(env, options, chromeCommandInfos);
  const fileExists = options.fileExists ?? existsSync;
  const readTextFile = options.readTextFile ?? ((filePath) => readFileSync(filePath, "utf8"));

  for (const candidate of candidatePathInfos) {
    if (!candidate.path || !fileExists(candidate.path)) {
      continue;
    }

    const browserUrl = parseBrowserUrlFromDevtoolsActivePortFile(readTextFile(candidate.path), candidate.address);
    if (browserUrl) {
      return browserUrl;
    }
  }

  return undefined;
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
  const info = parseChromeCommandDebugInfo(command);
  return info?.browserUrl;
}

function parseChromeCommandDebugInfo(command) {
  if (!command) {
    return undefined;
  }

  const portValue = readChromeCommandFlag(command, "remote-debugging-port");
  if (!portValue || !/^\d+$/.test(portValue)) {
    return undefined;
  }

  const address = readChromeCommandFlag(command, "remote-debugging-address") || "127.0.0.1";
  const userDataDir = readChromeCommandFlag(command, "user-data-dir");
  return {
    browserUrl: `http://${address}:${portValue}`,
    address,
    port: portValue,
    userDataDir,
  };
}

function readChromeCommandFlag(command, name) {
  for (const pattern of [
    new RegExp(`--${name}=("[^"]+"|'[^']+'|\\S+)`, "i"),
    new RegExp(`--${name}\\s+("[^"]+"|'[^']+'|\\S+)`, "i"),
  ]) {
    const match = command.match(pattern);
    if (!match?.[1]) {
      continue;
    }
    return stripWrappingQuotes(match[1].trim());
  }
  return undefined;
}

function stripWrappingQuotes(value) {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function buildDevtoolsActivePortCandidateInfos(env, options, chromeCommandInfos) {
  const preferredPath = options.devtoolsActivePortPath ?? env.SASIKI_DEVTOOLS_ACTIVE_PORT_PATH?.trim();
  const candidateInfos = [];

  if (preferredPath) {
    candidateInfos.push({
      path: preferredPath,
      address: "127.0.0.1",
    });
  }

  for (const info of chromeCommandInfos) {
    if (!info?.userDataDir) {
      continue;
    }
    candidateInfos.push({
      path: path.join(info.userDataDir, "DevToolsActivePort"),
      address: info.address,
    });
  }

  for (const userDataDir of defaultChromeUserDataDirs(env, options)) {
    candidateInfos.push({
      path: path.join(userDataDir, "DevToolsActivePort"),
      address: "127.0.0.1",
    });
  }

  const seen = new Set();
  return candidateInfos.filter((candidate) => {
    if (!candidate.path) {
      return false;
    }
    if (seen.has(candidate.path)) {
      return false;
    }
    seen.add(candidate.path);
    return true;
  });
}

function defaultChromeUserDataDirs(env, options) {
  const platform = options.platform ?? process.platform;
  const homeDir = env.HOME?.trim() || options.homedir || os.homedir();

  if (platform === "darwin") {
    return [
      path.join(homeDir, "Library/Application Support/Google/Chrome"),
      path.join(homeDir, "Library/Application Support/Google/Chrome Beta"),
      path.join(homeDir, "Library/Application Support/Google/Chrome Canary"),
      path.join(homeDir, "Library/Application Support/Chromium"),
    ];
  }

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || path.join(homeDir, "AppData/Local");
    return [
      path.join(localAppData, "Google/Chrome/User Data"),
      path.join(localAppData, "Google/Chrome Beta/User Data"),
      path.join(localAppData, "Google/Chrome SxS/User Data"),
      path.join(localAppData, "Chromium/User Data"),
    ];
  }

  return [
    path.join(homeDir, ".config/google-chrome"),
    path.join(homeDir, ".config/google-chrome-beta"),
    path.join(homeDir, ".config/chromium"),
    path.join(homeDir, ".config/chromium-browser"),
  ];
}

function parseBrowserUrlFromDevtoolsActivePortFile(contents, address = "127.0.0.1") {
  const [portLine = "", pathLine = ""] = String(contents ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (!/^\d+$/.test(portLine)) {
    return undefined;
  }

  if (pathLine.startsWith("ws://") || pathLine.startsWith("wss://")) {
    return pathLine;
  }

  if (pathLine.startsWith("/")) {
    return `ws://${address}:${portLine}${pathLine}`;
  }

  return `http://${address}:${portLine}`;
}
