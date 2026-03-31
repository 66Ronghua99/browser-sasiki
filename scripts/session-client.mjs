import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { requestJson } from "./http-client.mjs";
import { assertSessionMetadata } from "./session-metadata.mjs";
import { HTTP_ENDPOINTS, HTTP_REQUEST_QUERY_FIELDS } from "./http-contract.mjs";
import {
  assertSessionRpcRequest,
  assertWorkspaceResult,
  assertWorkspaceTabResult,
  assertWorkspaceTabsResult,
} from "./session-contract.mjs";

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_VERSION = "0.1.0";
const injectedSessionCache = new Map();

export async function ensureSessionDaemon(options = {}) {
  const env = options.env ?? process.env;
  const paths = resolveSessionPaths(options.sessionRoot);
  const runtimeVersion = await resolveRequestedRuntimeVersion(options);

  if (options.launchDaemon) {
    const cached = injectedSessionCache.get(paths.sessionRoot);
    if (
      cached
      && cached.runtimeVersion === runtimeVersion
      && isProcessAlive(cached.pid)
      && (await tryHealthcheck(cached.baseUrl)) !== null
    ) {
      return cached;
    }

    if (cached) {
      await requestShutdown(cached.baseUrl);
      injectedSessionCache.delete(paths.sessionRoot);
    }
  }

  const existing = await readSessionMetadata(paths.metadataPath);

  if (existing) {
    if (
      options.launchDaemon
      && existing.runtimeVersion === runtimeVersion
      && isProcessAlive(existing.pid)
      && (await tryHealthcheck(existing.baseUrl)) !== null
    ) {
      injectedSessionCache.set(paths.sessionRoot, existing);
      return existing;
    }

    const healthy = await tryHealthcheck(existing.baseUrl);
    if (healthy && healthy.runtimeVersion === runtimeVersion) {
      if (options.launchDaemon) {
        injectedSessionCache.set(paths.sessionRoot, healthy);
      }
      return healthy;
    }

    if (healthy) {
      await requestShutdown(existing.baseUrl);
    }

    await cleanupStaleSession(paths);
    injectedSessionCache.delete(paths.sessionRoot);
  }

  const launchDaemon = options.launchDaemon ?? defaultLaunchDaemon;
  await launchDaemon({
    env,
    sessionRoot: paths.sessionRoot,
    runtimeVersion,
  });

  if (options.launchDaemon) {
    const launchedMetadata = await readSessionMetadata(paths.metadataPath);
    if (launchedMetadata) {
      injectedSessionCache.set(paths.sessionRoot, launchedMetadata);
      return launchedMetadata;
    }
  }

  const deadline = Date.now() + (options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const metadata = await readSessionMetadata(paths.metadataPath);
    if (metadata) {
      const healthy = await tryHealthcheck(metadata.baseUrl);
      if (healthy) {
        if (options.launchDaemon) {
          injectedSessionCache.set(paths.sessionRoot, healthy);
        }
        return healthy;
      }
    }
    await sleep(50);
  }

  throw new Error("Timed out waiting for browser-sessiond to become healthy");
}

export async function sendSessionRpcRequest(requestOrMethod, paramsOrOptions, maybeOptions) {
  const envelope = normalizeRequest(requestOrMethod, paramsOrOptions);
  const options = isEnvelope(requestOrMethod)
    ? paramsOrOptions
    : maybeOptions;
  assertSessionRpcRequest(envelope);

  const metadata = await ensureSessionDaemon(options);
  const result = await sendHttpSessionRequest(metadata.baseUrl, envelope);
  return validateSessionResult(envelope.method, result);
}

function normalizeRequest(requestOrMethod, paramsOrOptions) {
  if (isEnvelope(requestOrMethod)) {
    return requestOrMethod;
  }

  return {
    requestId: randomUUID(),
    method: requestOrMethod,
    params: paramsOrOptions ?? {},
  };
}

function isEnvelope(value) {
  return typeof value === "object" && value !== null && "method" in value;
}

async function sendHttpSessionRequest(baseUrl, request) {
  const endpoint = resolveHttpEndpointName(request.method);
  const definition = HTTP_ENDPOINTS[endpoint];
  const url = new URL(definition.path, baseUrl);
  const queryFields = HTTP_REQUEST_QUERY_FIELDS[endpoint] ?? [];
  for (const field of queryFields) {
    const value = request.params[field];
    if (value !== undefined) {
      url.searchParams.set(field, value);
    }
  }

  const body = buildRequestBody(request.params, queryFields);
  const requestBody = definition.method === "GET" ? undefined : (body ?? {});
  return requestJson(
    definition.method,
    url.href,
    requestBody,
  );
}

function validateSessionResult(method, result) {
  switch (method) {
    case "health":
      assertSessionMetadata(result);
      return result;
    case "openWorkspace":
    case "listTabs":
      assertWorkspaceTabsResult(result);
      return result;
    case "navigate":
    case "click":
    case "type":
    case "press":
    case "query":
    case "recordKnowledge":
      assertWorkspaceResult(result);
      return result;
    case "selectTab":
      assertWorkspaceTabResult(result);
      return result;
    case "shutdown":
      return result;
    default:
      return result;
  }
}

function resolveHttpEndpointName(method) {
  switch (method) {
    case "health":
    case "shutdown":
      return method;
    case "openWorkspace":
      return "workspaces";
    case "listTabs":
      return "tabs";
    case "selectTab":
    case "navigate":
    case "click":
    case "type":
    case "press":
    case "query":
    case "recordKnowledge":
      return method;
    default:
      return method;
  }
}

function buildRequestBody(params, queryFields) {
  if (queryFields.length === 0) {
    return Object.keys(params).length === 0 ? undefined : params;
  }

  const body = {};
  for (const [key, value] of Object.entries(params)) {
    if (queryFields.includes(key)) {
      continue;
    }
    body[key] = value;
  }
  return Object.keys(body).length === 0 ? undefined : body;
}

async function defaultLaunchDaemon(options) {
  const daemonEntry = resolveDaemonEntry();
  const args = [
    ...daemonEntry.args,
    daemonEntry.entryPath,
    "--session-root",
    options.sessionRoot ?? resolveSessionPaths(undefined).sessionRoot,
    "--runtime-version",
    options.runtimeVersion ?? DEFAULT_RUNTIME_VERSION,
  ];
  const child = spawn(daemonEntry.command, args, {
    detached: true,
    stdio: "ignore",
    env: sanitizeEnv(options.env ?? process.env),
  });
  child.unref();
}

function resolveDaemonEntry() {
  const thisFile = fileURLToPath(import.meta.url);
  const runtimeDir = path.dirname(thisFile);
  const packageRoot = path.resolve(runtimeDir, "..");
  const entryPath = path.join(packageRoot, "scripts", "browser-sessiond.mjs");

  return {
    command: process.execPath,
    args: [],
    entryPath,
  };
}

function resolveSessionPaths(sessionRootOverride) {
  const sessionRoot = sessionRootOverride ?? resolveDefaultSessionRoot();
  return {
    sessionRoot,
    metadataPath: path.join(sessionRoot, "session.json"),
  };
}

function resolveDefaultSessionRoot() {
  return path.join(os.homedir(), ".sasiki", "browser-skill", "http-session");
}

async function readSessionMetadata(metadataPath) {
  try {
    const raw = JSON.parse(await readFile(metadataPath, "utf8"));
    assertSessionMetadata(raw);
    return raw;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    return null;
  }
}

async function tryHealthcheck(baseUrl) {
  try {
    const result = await requestJson("GET", new URL("/health", baseUrl).href);
    assertSessionMetadata(result);
    return result;
  } catch {
    return null;
  }
}

async function cleanupStaleSession(paths) {
  await rm(paths.metadataPath, { force: true }).catch(() => {});
}

async function requestShutdown(baseUrl) {
  try {
    await requestJson("POST", new URL("/shutdown", baseUrl).href, {});
  } catch {
    // Best effort only. We still clean stale metadata afterwards.
  }
}

async function resolveRequestedRuntimeVersion(options) {
  if (options.runtimeVersion) {
    return options.runtimeVersion;
  }

  try {
    const daemonEntry = resolveDaemonEntry();
    const entryStat = await stat(daemonEntry.entryPath);
    return `${DEFAULT_RUNTIME_VERSION}+${Math.trunc(entryStat.mtimeMs)}`;
  } catch {
    return DEFAULT_RUNTIME_VERSION;
  }
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

function isMissingFileError(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
