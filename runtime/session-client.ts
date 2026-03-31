import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { requestJson } from "../server/http-client.mjs";
import { assertSessionMetadata, type SessionMetadata } from "./session-metadata.js";
import {
  assertSessionCaptureResult,
  assertSessionRpcRequest,
  assertSessionRpcResult,
  type SessionCaptureResult,
  type SessionRpcMethod,
  type SessionRpcRequestEnvelope,
  type SessionRpcRequestMap,
  type SessionRpcResultBase,
} from "./session-rpc-types.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_VERSION = "0.1.0";
const injectedSessionCache = new Map<string, SessionMetadata>();

interface SessionPaths {
  sessionRoot: string;
  metadataPath: string;
}

export interface SessionClientOptions {
  env?: Record<string, string | undefined>;
  sessionRoot?: string;
  runtimeVersion?: string;
  startupTimeoutMs?: number;
  launchDaemon?: (options: SessionDaemonLaunchOptions) => Promise<void>;
}

export interface SessionDaemonLaunchOptions {
  env?: Record<string, string | undefined>;
  sessionRoot?: string;
  runtimeVersion?: string;
}

interface SessionRpcResponseMap {
  health: SessionMetadata;
  capture: SessionCaptureResult;
  navigate: SessionRpcResultBase;
  click: SessionRpcResultBase;
  type: SessionRpcResultBase;
  press: SessionRpcResultBase;
  selectTab: SessionRpcResultBase;
  querySnapshot: SessionRpcResultBase;
  recordKnowledge: SessionRpcResultBase;
  shutdown: { ok: true };
}

export async function ensureSessionDaemon(options: SessionClientOptions = {}): Promise<SessionMetadata> {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
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

export async function sendSessionRpcRequest<M extends SessionRpcMethod>(
  request: SessionRpcRequestEnvelope<M>,
  options?: SessionClientOptions,
): Promise<SessionRpcResponseMap[M]>;
export async function sendSessionRpcRequest<M extends SessionRpcMethod>(
  method: M,
  params: SessionRpcRequestMap[M],
  options?: SessionClientOptions,
): Promise<SessionRpcResponseMap[M]>;
export async function sendSessionRpcRequest<M extends SessionRpcMethod>(
  requestOrMethod: SessionRpcRequestEnvelope<M> | M,
  paramsOrOptions?: SessionRpcRequestMap[M] | SessionClientOptions,
  maybeOptions?: SessionClientOptions,
): Promise<SessionRpcResponseMap[M]> {
  const envelope = normalizeRequest(requestOrMethod, paramsOrOptions);
  const options = isEnvelope(requestOrMethod)
    ? (paramsOrOptions as SessionClientOptions | undefined)
    : maybeOptions;
  assertSessionRpcRequest(envelope);

  const metadata = await ensureSessionDaemon(options);
  const result = await sendHttpSessionRequest(metadata.baseUrl, envelope);
  return validateSessionResult(envelope.method, result) as SessionRpcResponseMap[M];
}

function normalizeRequest<M extends SessionRpcMethod>(
  requestOrMethod: SessionRpcRequestEnvelope<M> | M,
  paramsOrOptions?: SessionRpcRequestMap[M] | SessionClientOptions,
): SessionRpcRequestEnvelope<M> {
  if (isEnvelope(requestOrMethod)) {
    return requestOrMethod;
  }

  return {
    requestId: randomUUID(),
    method: requestOrMethod,
    params: (paramsOrOptions ?? {}) as SessionRpcRequestMap[M],
  };
}

function isEnvelope<M extends SessionRpcMethod>(
  value: SessionRpcRequestEnvelope<M> | M,
): value is SessionRpcRequestEnvelope<M> {
  return typeof value === "object" && value !== null && "method" in value;
}

async function sendHttpSessionRequest<M extends SessionRpcMethod>(
  baseUrl: string,
  request: SessionRpcRequestEnvelope<M>,
): Promise<unknown> {
  const endpoint = request.method === "selectTab"
    ? "/select-tab"
    : request.method === "querySnapshot"
      ? "/query-snapshot"
      : request.method === "recordKnowledge"
        ? "/record-knowledge"
        : request.method === "health"
          ? "/health"
          : request.method === "shutdown"
            ? "/shutdown"
            : `/${request.method}`;
  const body = request.method === "health" || request.method === "shutdown" ? undefined : request.params;
  return requestJson(
    request.method === "health" ? "GET" : "POST",
    new URL(endpoint, baseUrl).href,
    body,
  );
}

function validateSessionResult(method: SessionRpcMethod, result: unknown): unknown {
  switch (method) {
    case "health":
      assertSessionMetadata(result);
      return result;
    case "capture":
      assertSessionCaptureResult(result);
      return result;
    case "navigate":
    case "click":
    case "type":
    case "press":
    case "selectTab":
    case "querySnapshot":
    case "recordKnowledge":
      assertSessionRpcResult(result);
      return result;
    case "shutdown":
      return result;
  }
}

async function defaultLaunchDaemon(options: SessionDaemonLaunchOptions): Promise<void> {
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
    env: sanitizeEnv(options.env ?? (process.env as Record<string, string | undefined>)),
  });
  child.unref();
}

function resolveDaemonEntry(): { command: string; args: string[]; entryPath: string } {
  const thisFile = fileURLToPath(import.meta.url);
  const runtimeDir = path.dirname(thisFile);
  const packageRoot = path.resolve(runtimeDir, "..");
  const entryPath = path.join(packageRoot, "server", "browser-sessiond.mjs");

  return {
    command: process.execPath,
    args: [],
    entryPath,
  };
}

function resolveSessionPaths(sessionRootOverride?: string): SessionPaths {
  const sessionRoot = sessionRootOverride ?? resolveDefaultSessionRoot();
  return {
    sessionRoot,
    metadataPath: path.join(sessionRoot, "session.json"),
  };
}

function resolveDefaultSessionRoot(): string {
  return path.join(os.homedir(), ".sasiki", "browser-skill", "http-session");
}

async function readSessionMetadata(metadataPath: string): Promise<SessionMetadata | null> {
  try {
    const raw = JSON.parse(await readFile(metadataPath, "utf8")) as unknown;
    assertSessionMetadata(raw);
    return raw;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    return null;
  }
}

async function tryHealthcheck(baseUrl: string): Promise<SessionMetadata | null> {
  try {
    const result = await requestJson("GET", new URL("/health", baseUrl).href);
    assertSessionMetadata(result);
    return result;
  } catch {
    return null;
  }
}

async function cleanupStaleSession(paths: SessionPaths): Promise<void> {
  await rm(paths.metadataPath, { force: true }).catch(() => {});
}

async function requestShutdown(baseUrl: string): Promise<void> {
  try {
    await requestJson("POST", new URL("/shutdown", baseUrl).href, {});
  } catch {
    // Best effort only. We still clean stale metadata afterwards.
  }
}

async function resolveRequestedRuntimeVersion(options: SessionClientOptions): Promise<string> {
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

function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      clean[key] = value;
    }
  }
  return clean;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
