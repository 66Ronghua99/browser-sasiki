export const SESSION_METADATA_KEYS = [
  "pid",
  "socketPath",
  "browserUrl",
  "connectionMode",
  "startedAt",
  "lastSeenAt",
  "runtimeVersion",
] as const;

export type SessionMetadataKey = (typeof SESSION_METADATA_KEYS)[number];

export type SessionConnectionMode = "browserUrl" | "autoConnect";

export interface SessionMetadata {
  pid: number;
  socketPath: string;
  browserUrl: string | null;
  connectionMode: SessionConnectionMode;
  startedAt: string;
  lastSeenAt: string;
  runtimeVersion: string;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

export function assertSessionMetadata(value: unknown): asserts value is SessionMetadata {
  assertRecord(value, "session metadata");

  if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) {
    throw new TypeError("pid must be a positive integer");
  }
  assertString(value.socketPath, "socketPath");
  if (value.browserUrl !== null) {
    assertString(value.browserUrl, "browserUrl");
  }
  if (value.connectionMode !== "browserUrl" && value.connectionMode !== "autoConnect") {
    throw new TypeError("connectionMode must be browserUrl or autoConnect");
  }
  if (value.connectionMode === "browserUrl" && value.browserUrl === null) {
    throw new TypeError("browserUrl must be set when connectionMode is browserUrl");
  }
  assertString(value.startedAt, "startedAt");
  assertString(value.lastSeenAt, "lastSeenAt");
  assertString(value.runtimeVersion, "runtimeVersion");
}
