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
  ]);
  assert.equal(context.newCDPSessionCalls.length, 1);
  assert.equal(context.newPageCalls, 0);
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
  assert.match(snapshot, /uid=1_1 button "Compose"/);
  assert.match(snapshot, /uid=1_2 textbox "Message"/);
  assert.deepEqual(
    context.cdpCalls.map((call) => call.method),
    [
      "Accessibility.enable",
      "Accessibility.getFullAXTree",
      "DOM.resolveNode",
      "Runtime.callFunctionOn",
      "DOM.resolveNode",
      "Runtime.callFunctionOn",
    ],
  );
  assert.equal(page.locatorCalls.length, 0);
  assert.deepEqual(
    context.runtimeFunctionCalls.map((call) => ({
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
    context.cdpCalls.map((call) => call.method),
    [
      "Accessibility.enable",
      "Accessibility.getFullAXTree",
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

function createHarnessBrowser({
  pages,
  targetInfos,
  axNodes = [],
  nextNewPage = null,
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
          if (method === "Runtime.callFunctionOn") {
            runtimeFunctionCalls.push(params);
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
  };

  return page;
}
