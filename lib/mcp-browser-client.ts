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
