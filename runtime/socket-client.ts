import net from "node:net";

import type { SessionRpcRequestEnvelope } from "./session-rpc-types.js";
import type { SessionSocketResponse } from "./socket-server.js";

export async function sendSessionSocketRequest(
  socketPath: string,
  request: SessionRpcRequestEnvelope,
): Promise<unknown> {
  const response = await new Promise<SessionSocketResponse>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";

    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) {
        return;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      socket.end();
      if (line.length === 0) {
        reject(new Error("session socket returned an empty response"));
        return;
      }
      try {
        resolve(JSON.parse(line) as SessionSocketResponse);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
  });

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.result;
}

export const sendSocketRequest = sendSessionSocketRequest;
