import { randomUUID } from "node:crypto";
import { access, readFile, rm, stat } from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { defaultRuntimeRoots } from "../lib/paths.js";
import { assertSessionMetadata, type SessionMetadata } from "./session-metadata.js";
import { resolveSessionSocketPath } from "./session-paths.js";
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
import { sendSocketRequest } from "./socket-client.js";
import type { BrowserSessionDaemonOptions } from "./browser-sessiond.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;
const DEFAULT_RUNTIME_VERSION = "0.1.0";
const injectedSessionCache = new Map<string, SessionMetadata>();

interface SessionPaths {
  sessionRoot: string;
  metadataPath: string;
  socketPath: string;
}

export interface SessionClientOptions {
  env?: Record<string, string | undefined>;
  sessionRoot?: string;
  runtimeVersion?: string;
  startupTimeoutMs?: number;
  launchDaemon?: (options: BrowserSessionDaemonOptions) => Promise<void>;
}

interface SessionRpcResponseMap {
  health: SessionMetadata;
  capture: SessionCaptureResult;
  navigate: SessionRpcResultBase;
  click: SessionRpcResultBase;
  type: SessionRpcResultBase;
  press: SessionRpcResultBase;
  selectTab: SessionRpcResultBase;
  querySnapshot: unknown;
  readKnowledge: unknown;
  recordKnowledge: unknown;
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
      && fs.existsSync(cached.socketPath)
    ) {
      return cached;
    }
    if (cached) {
      await requestShutdown(cached.socketPath);
      injectedSessionCache.delete(paths.sessionRoot);
    }
  }
  const existing = await readSessionMetadata(paths.metadataPath);

  if (existing) {
    if (
      options.launchDaemon
      && existing.runtimeVersion === runtimeVersion
      && isProcessAlive(existing.pid)
      && fs.existsSync(existing.socketPath)
    ) {
      injectedSessionCache.set(paths.sessionRoot, existing);
      return existing;
    }

    const healthy = await tryHealthcheck(existing.socketPath);
    if (healthy && healthy.runtimeVersion === runtimeVersion) {
      if (options.launchDaemon) {
        injectedSessionCache.set(paths.sessionRoot, healthy);
      }
      return healthy;
    }

    if (healthy) {
      await requestShutdown(existing.socketPath);
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
      const healthy = await tryHealthcheck(metadata.socketPath);
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
  const result = await sendSocketRequest(metadata.socketPath, envelope);
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
      assertSessionRpcResult(result);
      return result;
    case "shutdown":
      return result;
    case "querySnapshot":
    case "readKnowledge":
    case "recordKnowledge":
      return result;
  }
}

async function defaultLaunchDaemon(options: BrowserSessionDaemonOptions): Promise<void> {
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
    env: sanitizeEnv(options.env ?? process.env as Record<string, string | undefined>),
  });
  child.unref();
}

function resolveDaemonEntry(): { command: string; args: string[]; entryPath: string } {
  const thisFile = fileURLToPath(import.meta.url);
  const runtimeDir = path.dirname(thisFile);
  const packageRoot = path.resolve(runtimeDir, "..");
  const jsEntry = path.join(runtimeDir, "browser-sessiond.js");
  if (fs.existsSync(jsEntry)) {
    return {
      command: process.execPath,
      args: [],
      entryPath: jsEntry,
    };
  }

  const tsEntry = path.join(runtimeDir, "browser-sessiond.ts");
  const tsxCli = path.join(packageRoot, "node_modules", "tsx", "dist", "cli.mjs");
  return {
    command: process.execPath,
    args: [tsxCli],
    entryPath: tsEntry,
  };
}

function resolveSessionPaths(sessionRootOverride?: string): SessionPaths {
  const tempRoot = defaultRuntimeRoots().tempRoot;
  const sessionRoot = sessionRootOverride ?? path.join(tempRoot, "session");
  return {
    sessionRoot,
    metadataPath: path.join(sessionRoot, "session.json"),
    socketPath: resolveSessionSocketPath(sessionRoot, tempRoot),
  };
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

async function tryHealthcheck(socketPath: string): Promise<SessionMetadata | null> {
  try {
    await access(socketPath);
    const result = await sendSocketRequest(socketPath, {
      requestId: randomUUID(),
      method: "health",
      params: {},
    });
    assertSessionMetadata(result);
    return result;
  } catch {
    return null;
  }
}

async function cleanupStaleSession(paths: SessionPaths): Promise<void> {
  await rm(paths.metadataPath, { force: true }).catch(() => {});
  await rm(paths.socketPath, { force: true }).catch(() => {});
}

async function requestShutdown(socketPath: string): Promise<void> {
  try {
    await sendSocketRequest(socketPath, {
      requestId: randomUUID(),
      method: "shutdown",
      params: {},
    });
  } catch {
    // Best effort only. We still clean stale metadata/socket afterwards.
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
