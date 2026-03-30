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
    const result = await this.toolClient.callTool("browser_snapshot", {});
    if (result.isError === true) {
      throw new Error(`browser_snapshot returned an error: ${readToolText(result)}`);
    }
    return readToolText(result);
  }

  async callBrowserTool(name: string, args: Record<string, unknown>): Promise<ToolCallResultLike> {
    return this.toolClient.callTool(name, args);
  }
}

function readToolText(result: ToolCallResultLike): string {
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
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
