import process from "node:process";

export interface ToolDefinitionLike {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolCallResultLike {
  content?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolClientLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<ToolDefinitionLike[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResultLike>;
}

export interface BrowserMcpLaunchOptions {
  command: string;
  args: string[];
}

class StdioToolClient implements ToolClientLike {
  private processStarted = false;
  private session: unknown | null = null;
  private transport: unknown | null = null;

  constructor(
    private readonly launchOptions: BrowserMcpLaunchOptions,
    private readonly env: Record<string, string | undefined>,
  ) {}

  async connect(): Promise<void> {
    if (this.processStarted) {
      return;
    }

    const clientModule: any = await import("@modelcontextprotocol/sdk/client/index.js");
    const stdioModule: any = await import("@modelcontextprotocol/sdk/client/stdio.js");
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

export class McpBrowserClient {
  constructor(private readonly toolClient: ToolClientLike) {}

  async captureSnapshot(): Promise<string> {
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

  async listPages(): Promise<string> {
    return this.readTextToolResult("list_pages", {});
  }

  async newPage(url: string, background = false): Promise<string> {
    return this.readTextToolResult("new_page", background ? { url, background } : { url });
  }

  async selectPage(pageId: number, bringToFront = true): Promise<string> {
    return this.readTextToolResult("select_page", { pageId, bringToFront });
  }

  async callBrowserTool(name: string, args: Record<string, unknown>): Promise<ToolCallResultLike> {
    return this.callTool(name, args);
  }

  private async readTextToolResult(name: string, args: Record<string, unknown>): Promise<string> {
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

  private async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResultLike> {
    try {
      return await this.toolClient.callTool(name, args);
    } catch (error) {
      throw toChromeAwareToolError(name, error);
    }
  }
}

export async function createConnectedMcpBrowserClient(
  launchOptions: BrowserMcpLaunchOptions,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<{
  client: McpBrowserClient;
  close(): Promise<void>;
}> {
  const toolClient = new StdioToolClient(launchOptions, env);
  await toolClient.connect();

  return {
    client: new McpBrowserClient(toolClient),
    close: async () => {
      await toolClient.disconnect();
    },
  };
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
      if (typeof text === "string" && text.trim()) {
        return text;
      }
    }
  }
  return null;
}

function describeToolResult(result: ToolCallResultLike): string {
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

function toChromeAwareToolError(name: string, detail: unknown): Error {
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

function isChromeConnectionFailure(message: string): boolean {
  return [
    /Could not connect to Chrome/i,
    /DevToolsActivePort/i,
    /remote debugging/i,
    /autoConnect/i,
  ].some((pattern) => pattern.test(message));
}

function formatChromeConnectionGuidance(name: string, detail: string): string {
  return [
    `${name} could not attach to the running Chrome session.`,
    "",
    "To enable browser automation for this skill:",
    "1. Open Google Chrome in the session you want to automate.",
    "2. In Chrome, open chrome://inspect/#remote-debugging.",
    "3. Turn on remote debugging for that Chrome session.",
    "4. If Chrome prompts you to allow Chrome DevTools MCP to connect, click Allow.",
    "5. Re-run: node dist/scripts/capture.js --tab-ref main",
    "",
    `Original MCP error: ${detail}`,
  ].join("\n");
}

function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      clean[key] = value;
    }
  }
  return clean;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

async function callToolWithLegacyFallback(
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
