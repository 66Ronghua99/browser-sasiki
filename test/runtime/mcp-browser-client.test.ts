import assert from "node:assert/strict";
import test from "node:test";

import { McpBrowserClient } from "../../lib/mcp-browser-client.js";

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
    if (name === "browser_snapshot") {
      return {
        content: [
          {
            type: "text",
            text: "### Snapshot\n- button \"Go\" [ref=go]",
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

test("mcp browser client captures snapshots through browser_snapshot", async () => {
  const toolClient = new StubToolClient();
  const client = new McpBrowserClient(toolClient);

  const snapshotText = await client.captureSnapshot();

  assert.equal(snapshotText, "### Snapshot\n- button \"Go\" [ref=go]");
  assert.deepEqual(toolClient.calls, [{ name: "browser_snapshot", args: {} }]);
});

test("mcp browser client rejects browser_snapshot error payloads", async () => {
  const toolClient = new StubToolClient();
  toolClient.callTool = async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
    toolClient.calls.push({ name, args });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "### Error\nbrowser_snapshot failed before a valid observation was produced",
        },
      ],
    };
  };
  const client = new McpBrowserClient(toolClient);

  await assert.rejects(
    () => client.captureSnapshot(),
    /browser_snapshot returned an error/i
  );
  assert.deepEqual(toolClient.calls, [{ name: "browser_snapshot", args: {} }]);
});

test("mcp browser client forwards generic browser tools unchanged", async () => {
  const toolClient = new StubToolClient();
  const client = new McpBrowserClient(toolClient);

  const result = await client.callBrowserTool("browser_click", { ref: "go" });

  assert.equal(toolClient.calls[0]?.name, "browser_click");
  assert.deepEqual(toolClient.calls[0]?.args, { ref: "go" });
  assert.equal((result.content as Array<{ text?: string }> | undefined)?.[0]?.text, "called:browser_click");
});
