import assert from "node:assert/strict";
import test from "node:test";

import { McpBrowserClient } from "../../lib/mcp-browser-client.js";
import { resolveBrowserMcpLaunchOptions } from "../../lib/browser-action.js";

interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface ToolCallResult {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

interface ToolClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<ToolDefinition[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
}

class StubToolClient implements ToolClient {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async listTools(): Promise<ToolDefinition[]> {
    return [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    this.calls.push({ name, args });
    if (name === "take_snapshot") {
      return {
        content: [
          {
            type: "text",
            text: "## Latest page snapshot\nuid=1_0 RootWebArea \"Go\" url=\"https://example.com/go\"",
          },
        ],
      };
    }
    if (name === "list_pages") {
      return {
        content: [
          {
            type: "text",
            text: "## Pages\n1: https://example.com/home [selected]\n2: https://example.com/inbox",
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `called:${name}`,
        },
      ],
      extra: args,
    };
  }
}

test("browser action defaults to chrome-devtools-mcp auto-connect launch args", () => {
  assert.deepEqual(resolveBrowserMcpLaunchOptions({}, { runningChromeCommands: [] }), {
    command: "npx",
    args: ["chrome-devtools-mcp@latest", "--autoConnect"],
  });
});

test("browser action prefers an explicit browser URL env override", () => {
  assert.deepEqual(
    resolveBrowserMcpLaunchOptions({
      SASIKI_BROWSER_URL: "http://127.0.0.1:64942",
    }),
    {
      command: "npx",
      args: ["chrome-devtools-mcp@latest", "--browserUrl", "http://127.0.0.1:64942"],
    },
  );
});

test("browser action auto-detects an existing remote-debugging Chrome before falling back to autoConnect", () => {
  assert.deepEqual(
    resolveBrowserMcpLaunchOptions(
      {},
      {
        runningChromeCommands: [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=64942 --user-data-dir=/tmp/profile",
        ],
      },
    ),
    {
      command: "npx",
      args: ["chrome-devtools-mcp@latest", "--browserUrl", "http://127.0.0.1:64942"],
    },
  );
});

test("browser action auto-detects an existing remote-debugging Chrome address override", () => {
  assert.deepEqual(
    resolveBrowserMcpLaunchOptions(
      {},
      {
        runningChromeCommands: [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-address=0.0.0.0 --remote-debugging-port=9333",
        ],
      },
    ),
    {
      command: "npx",
      args: ["chrome-devtools-mcp@latest", "--browserUrl", "http://0.0.0.0:9333"],
    },
  );
});

test("browser action keeps explicit MCP launch env overrides", () => {
  assert.deepEqual(
    resolveBrowserMcpLaunchOptions({
      SASIKI_BROWSER_MCP_COMMAND: "node",
      SASIKI_BROWSER_MCP_ARGS: "/tmp/chrome-devtools.js --browserUrl http://127.0.0.1:9222",
    }),
    {
      command: "node",
      args: ["/tmp/chrome-devtools.js", "--browserUrl", "http://127.0.0.1:9222"],
    },
  );
});

test("mcp browser client captures snapshots through take_snapshot", async () => {
  const toolClient = new StubToolClient();
  const client = new McpBrowserClient(toolClient);

  const snapshotText = await client.captureSnapshot();

  assert.equal(
    snapshotText,
    "## Latest page snapshot\nuid=1_0 RootWebArea \"Go\" url=\"https://example.com/go\"",
  );
  assert.deepEqual(toolClient.calls, [{ name: "take_snapshot", args: {} }]);
});

test("mcp browser client lists Chrome DevTools pages through list_pages", async () => {
  const toolClient = new StubToolClient();
  const client = new McpBrowserClient(toolClient);

  const pagesText = await client.listPages();

  assert.equal(pagesText, "## Pages\n1: https://example.com/home [selected]\n2: https://example.com/inbox");
  assert.deepEqual(toolClient.calls, [{ name: "list_pages", args: {} }]);
});

test("mcp browser client selects Chrome DevTools pages through select_page", async () => {
  const toolClient = new StubToolClient();
  const client = new McpBrowserClient(toolClient);

  const pagesText = await client.selectPage(2);

  assert.equal(pagesText, "called:select_page");
  assert.deepEqual(toolClient.calls, [{ name: "select_page", args: { pageId: 2, bringToFront: true } }]);
});

test("mcp browser client opens a new workspace tab through new_page", async () => {
  const toolClient = new StubToolClient();
  const client = new McpBrowserClient(toolClient);

  const pagesText = await client.newPage("chrome://newtab/");

  assert.equal(pagesText, "called:new_page");
  assert.deepEqual(toolClient.calls, [{ name: "new_page", args: { url: "chrome://newtab/" } }]);
});

test("mcp browser client rejects take_snapshot error payloads", async () => {
  const toolClient = new StubToolClient();
  toolClient.callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    toolClient.calls.push({ name, args });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Could not connect to Chrome. Check if Chrome is running.",
        },
      ],
    };
  };
  const client = new McpBrowserClient(toolClient);

  await assert.rejects(
    () => client.captureSnapshot(),
    /take_snapshot could not attach to the running Chrome session/i,
  );
  assert.deepEqual(toolClient.calls, [{ name: "take_snapshot", args: {} }]);
});

test("mcp browser client adds remote-debugging guidance when Chrome is not attachable", async () => {
  const toolClient = new StubToolClient();
  toolClient.callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    toolClient.calls.push({ name, args });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: [
            "Could not connect to Chrome. Check if Chrome is running.",
            "Cause: Could not find DevToolsActivePort for chrome at /tmp/DevToolsActivePort",
          ].join("\n"),
        },
      ],
    };
  };
  const client = new McpBrowserClient(toolClient);

  await assert.rejects(
    () => client.listPages(),
    /chrome:\/\/inspect\/#remote-debugging/i,
  );
  await assert.rejects(
    () => client.listPages(),
    /node dist\/scripts\/capture\.js --tab-ref main/i,
  );
});

test("mcp browser client adds remote-debugging guidance when MCP tool calls throw Chrome connection errors", async () => {
  const toolClient = new StubToolClient();
  toolClient.callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    toolClient.calls.push({ name, args });
    throw new Error("Could not connect to Chrome. Check if Chrome is running.");
  };
  const client = new McpBrowserClient(toolClient);

  await assert.rejects(
    () => client.captureSnapshot(),
    /allow Chrome DevTools MCP to connect/i,
  );
});

test("mcp browser client rejects malformed take_snapshot success payloads", async () => {
  const toolClient = new StubToolClient();
  toolClient.callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    toolClient.calls.push({ name, args });
    return {
      content: [
        {
          type: "json",
          value: { unexpected: true },
        },
      ],
    };
  };
  const client = new McpBrowserClient(toolClient);

  await assert.rejects(
    () => client.captureSnapshot(),
    /take_snapshot returned a malformed payload/i,
  );
});

test("mcp browser client forwards generic browser tools unchanged", async () => {
  const toolClient = new StubToolClient();
  const client = new McpBrowserClient(toolClient);

  const result = await client.callBrowserTool("browser_click", { ref: "go" });

  assert.equal(toolClient.calls[0]?.name, "browser_click");
  assert.deepEqual(toolClient.calls[0]?.args, { ref: "go" });
  assert.equal((result.content as Array<{ text?: string }> | undefined)?.[0]?.text, "called:browser_click");
});
