export const SESSION_METADATA_KEYS = [
  "pid",
  "port",
  "baseUrl",
  "browserUrl",
  "connectionMode",
  "startedAt",
  "lastSeenAt",
  "runtimeVersion",
];

export function assertSessionMetadata(value) {
  assertRecord(value, "session metadata");

  if (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid <= 0) {
    throw new TypeError("pid must be a positive integer");
  }
  if ("socketPath" in value) {
    throw new TypeError("socketPath is not allowed");
  }
  if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port <= 0) {
    throw new TypeError("port must be a positive integer");
  }
  assertString(value.baseUrl, "baseUrl");
  if (value.browserUrl !== null) {
    assertString(value.browserUrl, "browserUrl");
  }
  if (
    value.connectionMode !== null
    && value.connectionMode !== "browserUrl"
    && value.connectionMode !== "http"
  ) {
    throw new TypeError("connectionMode must be browserUrl, http, or null");
  }
  if (value.connectionMode === "browserUrl" && value.browserUrl === null) {
    throw new TypeError("browserUrl must be set when connectionMode is browserUrl");
  }
  assertString(value.startedAt, "startedAt");
  assertString(value.lastSeenAt, "lastSeenAt");
  assertString(value.runtimeVersion, "runtimeVersion");
}

function assertRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}
