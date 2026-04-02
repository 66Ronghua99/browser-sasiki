import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DevtoolsBrowserClient,
  createConnectedDevtoolsBrowserClient,
  resolveBrowserDevtoolsUrl,
} from "../../scripts/devtools-browser-client.mjs";

test("resolveBrowserDevtoolsUrl defaults to localhost Chrome DevTools when no override is present", () => {
  assert.equal(
    resolveBrowserDevtoolsUrl({}, { runningChromeCommands: [], fileExists: () => false }),
    "http://127.0.0.1:9222",
  );
});

test("resolveBrowserDevtoolsUrl prefers an explicit browser URL env override", () => {
  assert.equal(
    resolveBrowserDevtoolsUrl({
      SASIKI_BROWSER_URL: "http://127.0.0.1:64942",
    }),
    "http://127.0.0.1:64942",
  );
});

test("resolveBrowserDevtoolsUrl auto-detects an existing remote-debugging Chrome command", () => {
  assert.equal(
    resolveBrowserDevtoolsUrl(
      {},
      {
        runningChromeCommands: [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=64942 --user-data-dir=/tmp/profile",
        ],
        fileExists: () => false,
      },
    ),
    "http://127.0.0.1:64942",
  );
});

test("resolveBrowserDevtoolsUrl preserves an explicit remote-debugging address override", () => {
  assert.equal(
    resolveBrowserDevtoolsUrl(
      {},
      {
        runningChromeCommands: [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-address=0.0.0.0 --remote-debugging-port=9333",
        ],
        fileExists: () => false,
      },
    ),
    "http://0.0.0.0:9333",
  );
});

test("resolveBrowserDevtoolsUrl prefers a DevToolsActivePort websocket path from an explicit file hint", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "sasiki-devtools-active-port-"));
  const activePortPath = path.join(root, "DevToolsActivePort");
  writeFileSync(activePortPath, "64942\n/devtools/browser/abc123\n", "utf8");

  try {
    assert.equal(
      resolveBrowserDevtoolsUrl(
        {},
        {
          devtoolsActivePortPath: activePortPath,
          runningChromeCommands: [],
        },
      ),
      "ws://127.0.0.1:64942/devtools/browser/abc123",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveBrowserDevtoolsUrl discovers DevToolsActivePort inside the default Chrome user-data dir", () => {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), "sasiki-devtools-home-"));
  const activePortPath = path.join(
    homeDir,
    "Library/Application Support/Google/Chrome/DevToolsActivePort",
  );
  mkdirSync(path.dirname(activePortPath), { recursive: true });
  writeFileSync(activePortPath, "9333\n/devtools/browser/live-session\n", { encoding: "utf8", flag: "w" });

  try {
    assert.equal(
      resolveBrowserDevtoolsUrl(
        {
          HOME: homeDir,
        },
        {
          platform: "darwin",
          runningChromeCommands: [],
        },
      ),
      "ws://127.0.0.1:9333/devtools/browser/live-session",
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("createConnectedDevtoolsBrowserClient connects over CDP and closes the browser handle", async () => {
  const calls = [];
  const fakeBrowser = {
    contexts: () => [],
    close: async () => {
      calls.push({ type: "close" });
    },
  };

  const connected = await createConnectedDevtoolsBrowserClient(
    {
      env: {
        SASIKI_BROWSER_URL: "http://127.0.0.1:64942",
      },
      runningChromeCommands: [],
    },
    {
      connectOverCDP: async (browserUrl) => {
        calls.push({ type: "connect", browserUrl });
        return fakeBrowser;
      },
    },
  );

  assert.ok(connected.client instanceof DevtoolsBrowserClient);
  assert.deepEqual(calls, [
    {
      type: "connect",
      browserUrl: "http://127.0.0.1:64942",
    },
  ]);

  await connected.close();

  assert.deepEqual(calls, [
    {
      type: "connect",
      browserUrl: "http://127.0.0.1:64942",
    },
    {
      type: "close",
    },
  ]);
});

test("createConnectedDevtoolsBrowserClient forwards browser disconnect events", async () => {
  const calls = [];
  const listeners = new Map();
  const fakeBrowser = {
    contexts: () => [],
    once: (event, listener) => {
      calls.push({ type: "once", event });
      listeners.set(event, listener);
    },
    close: async () => {},
  };

  const connected = await createConnectedDevtoolsBrowserClient(
    {
      env: {
        SASIKI_BROWSER_URL: "http://127.0.0.1:64942",
      },
      runningChromeCommands: [],
    },
    {
      connectOverCDP: async () => fakeBrowser,
    },
  );

  let disconnected = false;
  connected.onDisconnect(() => {
    disconnected = true;
  });

  listeners.get("disconnected")?.(fakeBrowser);

  assert.equal(disconnected, true);
  assert.deepEqual(calls, [
    {
      type: "once",
      event: "disconnected",
    },
  ]);
});

test("devtools browser client lists live pages and raw targets from the attached browser", async () => {
  const { browser, context } = createHarnessBrowser({
    pages: [
      createPage({
        url: "https://example.com/home",
        title: "Home",
      }),
      createPage({
        url: "https://example.com/inbox",
        title: "Inbox",
      }),
    ],
    targetInfos: [
      {
        targetId: "page-home",
        type: "page",
        title: "Home",
        url: "https://example.com/home",
        attached: true,
      },
      {
        targetId: "page-inbox",
        type: "page",
        title: "Inbox",
        url: "https://example.com/inbox",
        attached: true,
      },
      {
        targetId: "worker-1",
        type: "service_worker",
        title: "Service Worker",
        url: "https://example.com/sw.js",
        attached: false,
      },
    ],
  });
  const client = new DevtoolsBrowserClient(browser);

  const pages = await client.listLivePages();
  const targets = await client.listLiveTargets();

  assert.deepEqual(pages, [
    {
      pageId: 0,
      url: "https://example.com/home",
      title: "Home",
    },
    {
      pageId: 1,
      url: "https://example.com/inbox",
      title: "Inbox",
    },
  ]);
  assert.deepEqual(targets, [
    {
      targetId: "page-home",
      openerId: "",
      type: "page",
      title: "Home",
      url: "https://example.com/home",
      attached: true,
    },
    {
      targetId: "page-inbox",
      openerId: "",
      type: "page",
      title: "Inbox",
      url: "https://example.com/inbox",
      attached: true,
    },
    {
      targetId: "worker-1",
      openerId: "",
      type: "service_worker",
      title: "Service Worker",
      url: "https://example.com/sw.js",
      attached: false,
    },
  ]);
  assert.equal(context.newCDPSessionCalls.length, 1);
  assert.equal(context.newPageCalls, 0);
});

test("devtools browser client lists live page inventory from per-page target info", async () => {
  const { browser } = createHarnessBrowser({
    pages: [
      createPage({
        url: "https://example.com/home",
        title: "Home",
        targetInfo: {
          targetId: "page-home",
          type: "page",
          openerId: "opener-root",
          title: "Home",
          url: "https://example.com/home",
          attached: true,
        },
      }),
      createPage({
        url: "https://example.com/inbox",
        title: "Inbox",
        targetInfo: {
          targetId: "page-inbox",
          type: "page",
          title: "Inbox",
          url: "https://example.com/inbox",
          openerId: "page-home",
          attached: true,
        },
      }),
    ],
    targetInfos: [
      {
        targetId: "page-inbox",
        type: "page",
        title: "Inbox",
        url: "https://example.com/inbox",
        openerId: "page-home",
        attached: true,
      },
      {
        targetId: "page-home",
        type: "page",
        openerId: "opener-root",
        title: "Home",
        url: "https://example.com/home",
        attached: true,
      },
      {
        targetId: "service-worker-1",
        type: "service_worker",
        title: "Service Worker",
        url: "https://example.com/sw.js",
        attached: false,
      },
      {
        targetId: "page-orphan",
        openerId: "opener-root",
        type: "page",
        title: "Orphan",
        url: "https://example.com/orphan",
        attached: false,
      },
    ],
  });
  const client = new DevtoolsBrowserClient(browser);

  const inventory = await client.listLivePageInventory();

  assert.deepEqual(inventory, [
    {
      pageId: 0,
      targetId: "page-home",
      openerId: "opener-root",
      url: "https://example.com/home",
      title: "Home",
    },
    {
      pageId: 1,
      targetId: "page-inbox",
      openerId: "page-home",
      url: "https://example.com/inbox",
      title: "Inbox",
    },
  ]);
});

test("devtools browser client keeps duplicate title/url pages distinct by targetId", async () => {
  const { browser } = createHarnessBrowser({
    pages: [
      createPage({
        url: "https://example.com/thread/42",
        title: "Thread",
        targetInfo: {
          targetId: "page-thread-a",
          type: "page",
          openerId: "page-home",
          title: "Thread",
          url: "https://example.com/thread/42",
          attached: true,
        },
      }),
      createPage({
        url: "https://example.com/thread/42",
        title: "Thread",
        targetInfo: {
          targetId: "page-thread-b",
          type: "page",
          openerId: "page-home",
          title: "Thread",
          url: "https://example.com/thread/42",
          attached: true,
        },
      }),
    ],
    targetInfos: [
      {
        targetId: "page-thread-b",
        type: "page",
        openerId: "page-home",
        title: "Thread",
        url: "https://example.com/thread/42",
        attached: true,
      },
      {
        targetId: "page-thread-a",
        type: "page",
        openerId: "page-home",
        title: "Thread",
        url: "https://example.com/thread/42",
        attached: true,
      },
    ],
  });
  const client = new DevtoolsBrowserClient(browser);

  const inventory = await client.listLivePageInventory();

  assert.deepEqual(inventory, [
    {
      pageId: 0,
      targetId: "page-thread-a",
      openerId: "page-home",
      url: "https://example.com/thread/42",
      title: "Thread",
    },
    {
      pageId: 1,
      targetId: "page-thread-b",
      openerId: "page-home",
      url: "https://example.com/thread/42",
      title: "Thread",
    },
  ]);
});

test("devtools browser client listLivePageInventory does not block on a page title that never resolves", async () => {
  const hungPage = createPage({
    url: "about:blank",
    title: "",
    targetInfo: {
      targetId: "page-hung",
      type: "page",
      openerId: "",
      title: "Recovered From Target Info",
      url: "https://example.com/hung",
      attached: true,
    },
  });
  hungPage.title = async () => new Promise(() => {});

  const { browser } = createHarnessBrowser({
    pages: [hungPage],
    targetInfos: [
      {
        targetId: "page-hung",
        type: "page",
        openerId: "",
        title: "Recovered From Target Info",
        url: "https://example.com/hung",
        attached: true,
      },
    ],
  });
  const client = new DevtoolsBrowserClient(browser);

  const inventory = await Promise.race([
    client.listLivePageInventory(),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
  ]);

  assert.notEqual(inventory, "timeout");
  assert.deepEqual(inventory, [
    {
      pageId: 0,
      targetId: "page-hung",
      openerId: "",
      url: "https://example.com/hung",
      title: "Recovered From Target Info",
    },
  ]);
});

test("devtools browser client listPages does not block on a page title that never resolves", async () => {
  const hungPage = createPage({
    url: "about:blank",
    title: "",
    targetInfo: {
      targetId: "page-hung",
      type: "page",
      openerId: "",
      title: "Recovered From Target Info",
      url: "https://example.com/hung",
      attached: true,
    },
  });
  hungPage.title = async () => new Promise(() => {});

  const { browser } = createHarnessBrowser({
    pages: [hungPage],
    targetInfos: [
      {
        targetId: "page-hung",
        type: "page",
        openerId: "",
        title: "Recovered From Target Info",
        url: "https://example.com/hung",
        attached: true,
      },
    ],
  });
  const client = new DevtoolsBrowserClient(browser);

  const pageListText = await Promise.race([
    client.listPages(),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
  ]);

  assert.notEqual(pageListText, "timeout");
  assert.equal(pageListText, "## Pages\n- 0 [Recovered From Target Info](https://example.com/hung)");
});

test("devtools browser client listPages does not block on page activity that never resolves", async () => {
  const hungPage = createPage({
    url: "https://example.com/hung",
    title: "Hung",
  });
  hungPage.evaluate = async () => new Promise(() => {});

  const { browser } = createHarnessBrowser({
    pages: [
      hungPage,
      createPage({
        url: "https://example.com/visible",
        title: "Visible",
        activity: {
          hasFocus: true,
          visibilityState: "visible",
          hidden: false,
        },
      }),
    ],
    targetInfos: [],
  });
  const client = new DevtoolsBrowserClient(browser);

  const pageListText = await Promise.race([
    client.listPages(),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 50)),
  ]);

  assert.notEqual(pageListText, "timeout");
  assert.equal(
    pageListText,
    "## Pages\n- 0 [Hung](https://example.com/hung)\n- 1 (current) [Visible](https://example.com/visible)",
  );
});

test("devtools browser client marks the visible focused page as current in page inventory text", async () => {
  const { browser } = createHarnessBrowser({
    pages: [
      createPage({
        url: "https://example.com/home",
        title: "Home",
        activity: {
          hasFocus: false,
          visibilityState: "hidden",
          hidden: true,
        },
      }),
      createPage({
        url: "https://example.com/publish",
        title: "Publish",
        activity: {
          hasFocus: true,
          visibilityState: "visible",
          hidden: false,
        },
      }),
    ],
    targetInfos: [],
  });
  const client = new DevtoolsBrowserClient(browser);

  const pageList = await client.listPages();

  assert.match(pageList, /\- 0 \[Home\]\(https:\/\/example\.com\/home\)/);
  assert.match(pageList, /\- 1 \(current\) \[Publish\]\(https:\/\/example\.com\/publish\)/);
});

test("devtools browser client captures a snapshot for an explicit pageId", async () => {
  const { browser } = createHarnessBrowser({
    pages: [
      createPage({
        url: "https://example.com/home",
        title: "Home",
      }),
      createPage({
        url: "https://example.com/thread/42",
        title: "Thread",
      }),
    ],
    targetInfos: [],
    axNodes: [
      {
        nodeId: "1_0",
        role: { value: "RootWebArea" },
        name: { value: "Thread" },
      },
    ],
  });
  const client = new DevtoolsBrowserClient(browser);

  const snapshot = await client.captureSnapshotForPage(1);

  assert.match(snapshot, /url="https:\/\/example\.com\/thread\/42"/);
  assert.match(snapshot, /RootWebArea "Thread"/);
});

test("devtools browser client opens a workspace tab inside the connected browser context", async () => {
  const existingPage = createPage({
    url: "https://example.com/home",
    title: "Home",
  });
  const openedPage = createPage({
    url: "about:blank",
    title: "",
  });
  const { browser, context } = createHarnessBrowser({
    pages: [existingPage],
    nextNewPage: openedPage,
    targetInfos: [],
  });
  const client = new DevtoolsBrowserClient(browser);

  const result = await client.openWorkspaceTab("https://example.com/workspace");

  assert.deepEqual(result, {
    pageId: 1,
    targetId: "",
    url: "https://example.com/workspace",
    title: "Workspace",
  });
  assert.equal(context.newPageCalls, 1);
  assert.deepEqual(openedPage.gotoCalls, ["https://example.com/workspace"]);
  assert.equal(openedPage.bringToFrontCalls, 0);
});

test("devtools browser client captures a queryable accessibility snapshot and reuses uid handles for actions", async () => {
  const page = createPage({
    url: "https://example.com/compose",
    title: "Compose",
  });
  const { browser, context } = createHarnessBrowser({
    pages: [page],
    targetInfos: [],
    axNodes: [
      {
        nodeId: "1_0",
        role: { value: "RootWebArea" },
        name: { value: "Compose" },
        childIds: ["1_1", "1_2"],
      },
      {
        nodeId: "1_1",
        role: { value: "button" },
        name: { value: "Compose" },
        backendDOMNodeId: 101,
      },
      {
        nodeId: "1_2",
        role: { value: "textbox" },
        name: { value: "Message" },
        backendDOMNodeId: 102,
      },
    ],
  });
  const client = new DevtoolsBrowserClient(browser);

  const snapshot = await client.captureSnapshot();
  await client.click({ pageId: 0, uid: "1_1" });
  await client.fill({ pageId: 0, uid: "1_2", value: "hello" });
  await client.press({ pageId: 0, key: "Enter" });

  assert.match(snapshot, /uid=1_0 RootWebArea "Compose" url="https:\/\/example.com\/compose"/);
  assert.match(snapshot, /uid=1_1 button "Compose" interactive=true/);
  assert.match(snapshot, /uid=1_2 textbox "Message" interactive=true/);
  assert.deepEqual(
    context.cdpCalls.slice(0, 8).map((call) => call.method),
    [
      "Accessibility.enable",
      "Accessibility.getFullAXTree",
      "DOM.resolveNode",
      "DOMDebugger.getEventListeners",
      "Runtime.callFunctionOn",
      "DOM.resolveNode",
      "DOMDebugger.getEventListeners",
      "Runtime.callFunctionOn",
    ],
  );
  assert.deepEqual(
    context.cdpCalls.slice(-4).map((call) => call.method),
    [
      "DOM.resolveNode",
      "Runtime.callFunctionOn",
      "DOM.resolveNode",
      "Runtime.callFunctionOn",
    ],
  );
  assert.equal(page.locatorCalls.length, 0);
  assert.deepEqual(
    context.runtimeFunctionCalls.slice(-2).map((call) => ({
      objectId: call.objectId,
      arguments: call.arguments,
    })),
    [
      {
        objectId: "object-101",
        arguments: [],
      },
      {
        objectId: "object-102",
        arguments: [{ value: "hello" }],
      },
    ],
  );
  assert.deepEqual(page.fillCalls, []);
  assert.deepEqual(page.clickCalls, []);
  assert.deepEqual(page.keyboardCalls, ["Enter"]);
  assert.equal(page.bringToFrontCalls, 0);
});

test("devtools browser client enriches accessibility snapshot lines with actionable metadata", async () => {
  const page = createPage({
    url: "https://example.com/inbox",
    title: "Inbox",
  });
  const { browser } = createHarnessBrowser({
    pages: [page],
    targetInfos: [],
    axNodes: [
      {
        nodeId: "1_0",
        role: { value: "RootWebArea" },
        name: { value: "Inbox" },
        childIds: ["1_1"],
      },
      {
        nodeId: "1_1",
        role: { value: "generic" },
        name: { value: "" },
        backendDOMNodeId: 101,
        childIds: ["1_2"],
      },
      {
        nodeId: "1_2",
        role: { value: "StaticText" },
        name: { value: "客户消息" },
      },
    ],
    eventListenersByBackendNodeId: {
      101: [{ type: "click" }],
    },
    domNodeDetailsByBackendNodeId: {
      101: {
        tagName: "DIV",
        role: "",
        tabIndex: -1,
        disabled: false,
        readOnly: false,
        isContentEditable: false,
        hasHref: false,
        cursor: "pointer",
        pointerEvents: "auto",
      },
    },
  });
  const client = new DevtoolsBrowserClient(browser);

  const snapshot = await client.captureSnapshot();

  assert.match(snapshot, /uid=1_1 generic interactive=true/);
  assert.match(snapshot, /uid=1_2 StaticText "客户消息" actionableUid=1_1/);
});

test("devtools browser client browser-tool actions accept uid handles from the latest snapshot", async () => {
  const page = createPage({
    url: "https://example.com/compose",
    title: "Compose",
  });
  const { browser, context } = createHarnessBrowser({
    pages: [page],
    targetInfos: [],
    axNodes: [
      {
        nodeId: "1_0",
        role: { value: "RootWebArea" },
        name: { value: "Compose" },
        childIds: ["1_1", "1_2"],
      },
      {
        nodeId: "1_1",
        role: { value: "button" },
        name: { value: "Compose" },
        backendDOMNodeId: 101,
      },
      {
        nodeId: "1_2",
        role: { value: "textbox" },
        name: { value: "Message" },
        backendDOMNodeId: 102,
      },
    ],
  });
  const client = new DevtoolsBrowserClient(browser);

  await client.captureSnapshot();
  await client.callBrowserTool("click", { uid: "1_1" });
  await client.callBrowserTool("fill", { uid: "1_2", value: "hello" });

  assert.deepEqual(
    context.cdpCalls.slice(0, 8).map((call) => call.method),
    [
      "Accessibility.enable",
      "Accessibility.getFullAXTree",
      "DOM.resolveNode",
      "DOMDebugger.getEventListeners",
      "Runtime.callFunctionOn",
      "DOM.resolveNode",
      "DOMDebugger.getEventListeners",
      "Runtime.callFunctionOn",
    ],
  );
  assert.deepEqual(
    context.cdpCalls.slice(-4).map((call) => call.method),
    [
      "DOM.resolveNode",
      "Runtime.callFunctionOn",
      "DOM.resolveNode",
      "Runtime.callFunctionOn",
    ],
  );
  assert.equal(page.locatorCalls.length, 0);
  assert.deepEqual(page.clickCalls, []);
  assert.deepEqual(page.fillCalls, []);
});

test("devtools browser client explicit selector helpers stay on the resolved page without bringToFront", async () => {
  const page = createPage({
    url: "https://example.com/compose",
    title: "Compose",
  });
  const { browser } = createHarnessBrowser({
    pages: [page],
    targetInfos: [],
  });
  const client = new DevtoolsBrowserClient(browser);

  await client.click({ pageId: 0, selector: "[data-uid='compose']" });
  await client.fill({ pageId: 0, selector: "[data-uid='message']", value: "hello" });

  assert.deepEqual(page.locatorCalls, ["[data-uid='compose']", "[data-uid='message']"]);
  assert.deepEqual(page.clickCalls, ["[data-uid='compose']"]);
  assert.deepEqual(page.fillCalls, [
    {
      selector: "[data-uid='message']",
      value: "hello",
    },
  ]);
  assert.deepEqual(page.keyboardCalls, []);
  assert.equal(page.bringToFrontCalls, 0);
});

test("devtools browser client click routes to the explicit pageId without a shared selected-page cursor", async () => {
  const pages = [
    createPage({
      url: "https://example.com/inbox",
      title: "Inbox",
    }),
    createPage({
      url: "https://example.com/details",
      title: "Details",
    }),
  ];
  const { browser } = createHarnessBrowser({
    pages,
    targetInfos: [],
  });
  const client = new DevtoolsBrowserClient(browser);

  await client.callBrowserTool("click", {
    pageId: 1,
    selector: "[data-uid='reply_button']",
  });

  assert.deepEqual(pages[0].clickCalls, []);
  assert.deepEqual(pages[1].clickCalls, ["[data-uid='reply_button']"]);
});

function createHarnessBrowser({
  pages,
  targetInfos,
  axNodes = [],
  nextNewPage = null,
  eventListenersByBackendNodeId = {},
  domNodeDetailsByBackendNodeId = {},
}) {
  const livePages = [...pages];
  const newCDPSessionCalls = [];
  const cdpCalls = [];
  const runtimeFunctionCalls = [];

  const context = {
    newPageCalls: 0,
    newCDPSessionCalls,
    cdpCalls,
    runtimeFunctionCalls,
    pages: () => livePages,
    newPage: async () => {
      context.newPageCalls += 1;
      const created = nextNewPage ?? createPage({ url: "about:blank", title: "" });
      livePages.push(created);
      return created;
    },
    newCDPSession: async (page) => {
      newCDPSessionCalls.push(page);
      return {
        send: async (method, params = {}) => {
          cdpCalls.push({ method, params });
          if (method === "Target.getTargets") {
            return { targetInfos };
          }
          if (method === "Target.getTargetInfo") {
            return page.targetInfo
              ? { targetInfo: page.targetInfo }
              : { targetInfo: null };
          }
          if (method === "Accessibility.enable") {
            return {};
          }
          if (method === "Accessibility.getFullAXTree") {
            return { nodes: axNodes };
          }
          if (method === "DOM.resolveNode") {
            return {
              object: {
                objectId: `object-${params.backendNodeId}`,
              },
            };
          }
          if (method === "DOMDebugger.getEventListeners") {
            const backendNodeId = Number(String(params.objectId ?? "").replace("object-", ""));
            return {
              listeners: eventListenersByBackendNodeId[backendNodeId] ?? [],
            };
          }
          if (method === "Runtime.callFunctionOn") {
            runtimeFunctionCalls.push(params);
            if (String(params.functionDeclaration).includes("getComputedStyle")) {
              const backendNodeId = Number(String(params.objectId ?? "").replace("object-", ""));
              return {
                result: {
                  value: domNodeDetailsByBackendNodeId[backendNodeId] ?? {},
                },
              };
            }
            return {
              result: {
                value: true,
              },
            };
          }
          throw new Error(`unexpected CDP method ${method}`);
        },
        detach: async () => {},
      };
    },
  };

  for (const page of livePages) {
    page.__context = context;
  }

  const browser = {
    contexts: () => [context],
    close: async () => {},
  };

  return { browser, context };
}

function createPage({
  url,
  title,
  targetInfo = null,
  activity = null,
}) {
  const page = {
    gotoCalls: [],
    locatorCalls: [],
    clickCalls: [],
    fillCalls: [],
    keyboardCalls: [],
    bringToFrontCalls: 0,
    url: () => page.currentUrl,
    title: async () => page.currentTitle,
    evaluate: async () => activity ?? {
      hasFocus: false,
      visibilityState: "",
      hidden: true,
    },
    goto: async (nextUrl) => {
      page.gotoCalls.push(nextUrl);
      page.currentUrl = nextUrl;
      page.currentTitle = new URL(nextUrl).pathname.replace(/^\//, "") || "Workspace";
      page.currentTitle = page.currentTitle.charAt(0).toUpperCase() + page.currentTitle.slice(1);
    },
    locator: (selector) => {
      page.locatorCalls.push(selector);
      return {
        click: async () => {
          page.clickCalls.push(selector);
        },
        fill: async (value) => {
          page.fillCalls.push({ selector, value });
        },
      };
    },
    keyboard: {
      press: async (key) => {
        page.keyboardCalls.push(key);
      },
    },
    bringToFront: async () => {
      page.bringToFrontCalls += 1;
    },
    context: () => page.__context,
    currentUrl: url,
    currentTitle: title,
    targetInfo,
  };

  return page;
}
