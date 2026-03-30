import { createHash } from "node:crypto";
import path from "node:path";

const DEFAULT_SOCKET_BASENAME = "browser-sessiond.sock";
const MAX_UNIX_SOCKET_PATH_BYTES = 100;

export function resolveSessionSocketPath(sessionRoot: string, tempRoot: string): string {
  const directSocketPath = path.join(sessionRoot, DEFAULT_SOCKET_BASENAME);
  if (Buffer.byteLength(directSocketPath, "utf8") <= MAX_UNIX_SOCKET_PATH_BYTES) {
    return directSocketPath;
  }

  const sessionHash = createHash("sha256").update(sessionRoot).digest("hex").slice(0, 12);
  return path.join(tempRoot, "session", `browser-sessiond-${sessionHash}.sock`);
}
