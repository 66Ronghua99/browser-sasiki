import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { SessionRpcRequestEnvelope } from "./session-rpc-types.js";

interface SocketResponse {
  ok: true;
  requestId: string;
  result: unknown;
}

interface SocketErrorResponse {
  ok: false;
  requestId: string;
  error: string;
}

export type SessionSocketResponse = SocketResponse | SocketErrorResponse;

export type SessionSocketRequestHandler = (
  request: SessionRpcRequestEnvelope,
) => Promise<unknown>;

export class SessionSocketServer {
  private readonly server: net.Server;

  constructor(
    private readonly socketPath: string,
    private readonly handleRequest: SessionSocketRequestHandler,
  ) {
    this.server = net.createServer((socket) => {
      let buffer = "";
      socket.setEncoding("utf8");

      socket.on("data", (chunk) => {
        buffer += chunk;
        while (buffer.includes("\n")) {
          const newlineIndex = buffer.indexOf("\n");
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length === 0) {
            continue;
          }
          void this.respond(socket, line);
        }
      });
    });
  }

  async listen(): Promise<void> {
    await mkdir(path.dirname(this.socketPath), { recursive: true });
    await rm(this.socketPath, { force: true }).catch(() => {});

    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }).catch(() => {});
    await rm(this.socketPath, { force: true }).catch(() => {});
  }

  private async respond(socket: net.Socket, rawLine: string): Promise<void> {
    let requestId = "unknown";
    let response: SessionSocketResponse;

    try {
      const request = JSON.parse(rawLine) as SessionRpcRequestEnvelope;
      requestId = request.requestId;
      const result = await this.handleRequest(request);
      response = {
        ok: true,
        requestId,
        result,
      };
    } catch (error) {
      response = {
        ok: false,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    socket.write(`${JSON.stringify(response)}\n`);
  }
}
