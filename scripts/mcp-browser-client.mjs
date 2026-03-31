import process from "node:process";

class StdioToolClient {
  constructor(launchOptions, env) {
    this.launchOptions = launchOptions;
    this.env = env;
    this.processStarted = false;
    this.session = null;
    this.transport = null;
  }

  async connect() {
    if (this.processStarted) {
      return;
    }

    const clientModule = await import("@modelcontextprotocol/sdk/client/index.js");
    const stdioModule = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new stdioModule.StdioClientTransport({
      command: this.launchOptions.command,
      args: this.launchOptions.args,
      env: sanitizeEnv(this.env),
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

export class McpBrowserClient {
  constructor(toolClient) {
    this.toolClient = toolClient;
  }

  async captureSnapshot() {
    const result = await this.callTool("take_snapshot", {});
    if (result.isError === true) {
      throw toChromeAwareToolError("take_snapshot", describeToolResult(result));
    }
    const snapshotText = readToolText(result);
    if (snapshotText === null) {
      throw new Error("take_snapshot returned a malformed payload: expected text content");
    }
    return snapshotText;
  }

  async listPages() {
    return this.readTextToolResult("list_pages", {});
  }

  async newPage(url, background = false) {
    return this.readTextToolResult("new_page", background ? { url, background } : { url });
  }

  async selectPage(pageId, bringToFront = true) {
    return this.readTextToolResult("select_page", { pageId, bringToFront });
  }

  async callBrowserTool(name, args) {
    return this.callTool(name, args);
  }

  async readTextToolResult(name, args) {
    const result = await this.callTool(name, args);
    if (result.isError === true) {
      throw toChromeAwareToolError(name, describeToolResult(result));
    }
    const text = readToolText(result);
    if (text === null) {
      throw new Error(`${name} returned a malformed payload: expected text content`);
    }
    return text;
  }

  async callTool(name, args) {
    try {
      return await this.toolClient.callTool(name, args);
    } catch (error) {
      throw toChromeAwareToolError(name, error);
    }
  }
}

export async function createConnectedMcpBrowserClient(
  launchOptions,
  env = process.env,
) {
  const toolClient = new StdioToolClient(launchOptions, env);
  await toolClient.connect();

  return {
    client: new McpBrowserClient(toolClient),
    close: async () => {
      await toolClient.disconnect();
    },
  };
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
      if (typeof text === "string" && text.trim()) {
        return text;
      }
    }
  }
  return null;
}

function describeToolResult(result) {
  const text = readToolText(result);
  if (text !== null) {
    return text;
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function toChromeAwareToolError(name, detail) {
  const message = typeof detail === "string"
    ? detail
    : detail instanceof Error
      ? detail.stack ?? detail.message
      : String(detail);

  if (!isChromeConnectionFailure(message)) {
    return new Error(`${name} returned an error: ${message}`);
  }

  return new Error(formatChromeConnectionGuidance(name, message));
}

function isChromeConnectionFailure(message) {
  return [
    /Could not connect to Chrome/i,
    /DevToolsActivePort/i,
    /remote debugging/i,
    /autoConnect/i,
  ].some((pattern) => pattern.test(message));
}

function formatChromeConnectionGuidance(name, detail) {
  return [
    `${name} could not attach to the running Chrome session.`,
    "",
    "To enable browser automation for this skill:",
    "1. Open Google Chrome in the session you want to automate.",
    "2. In Chrome, open chrome://inspect/#remote-debugging.",
    "3. Turn on remote debugging for that Chrome session.",
    "4. If Chrome prompts you to allow Chrome DevTools MCP to connect, click Allow.",
    "5. Re-run the direct-run browser session daemon and try again.",
    "",
    `Original MCP error: ${detail}`,
  ].join("\n");
}

function sanitizeEnv(env) {
  const clean = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      clean[key] = value;
    }
  }
  return clean;
}

function toRecord(value) {
  if (value && typeof value === "object") {
    return value;
  }
  return {};
}

async function callToolWithLegacyFallback(session, name, args) {
  try {
    return toRecord(await session.callTool({ name, arguments: args }));
  } catch (error) {
    if (!shouldRetryLegacyCallTool(error)) {
      throw error;
    }
    return toRecord(await session.callTool(name, args));
  }
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
