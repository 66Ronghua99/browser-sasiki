import { realpathSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { requestJson } from "./http-client.mjs";
import { assertSessionMetadata } from "./session-metadata.mjs";

const DEFAULT_STARTUP_TIMEOUT_MS = 20_000;
const DEFAULT_RUNTIME_VERSION = "0.1.0";
const browserSessionCache = new Map();

const USAGE = [
  "Usage:",
  "  node scripts/ensure-browser-session.mjs [--session-root <path>] [--runtime-version <version>] [--startup-timeout-ms <ms>]",
].join("\n");

export async function ensureBrowserSession(options = {}) {
  const env = options.env ?? process.env;
  const paths = resolveSessionPaths(options.sessionRoot);
  const runtimeVersion = await resolveRequestedRuntimeVersion(options);
  const now = options.now ?? Date.now;
  const sleepFn = options.sleep ?? sleep;

  if (options.launchDaemon) {
    const cached = browserSessionCache.get(paths.sessionRoot);
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
      browserSessionCache.delete(paths.sessionRoot);
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
      browserSessionCache.set(paths.sessionRoot, existing);
      return existing;
    }

    const healthy = await tryHealthcheck(existing.baseUrl);
    if (healthy && healthy.runtimeVersion === runtimeVersion) {
      if (options.launchDaemon) {
        browserSessionCache.set(paths.sessionRoot, healthy);
      }
      return healthy;
    }

    if (healthy) {
      await requestShutdown(existing.baseUrl);
    }

    await cleanupStaleSession(paths);
    browserSessionCache.delete(paths.sessionRoot);
  }

  const launchDaemon = options.launchDaemon ?? defaultLaunchBrowserSessionDaemon;
  await launchDaemon({
    env,
    sessionRoot: paths.sessionRoot,
    runtimeVersion,
  });

  if (options.launchDaemon) {
    const launchedMetadata = await readSessionMetadata(paths.metadataPath);
    if (launchedMetadata) {
      browserSessionCache.set(paths.sessionRoot, launchedMetadata);
      return launchedMetadata;
    }
  }

  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const deadline = now() + startupTimeoutMs;
  while (now() < deadline) {
    const metadata = await readSessionMetadata(paths.metadataPath);
    if (metadata) {
      const healthy = await tryHealthcheck(metadata.baseUrl);
      if (healthy) {
        if (options.launchDaemon) {
          browserSessionCache.set(paths.sessionRoot, healthy);
        }
        return healthy;
      }
    }
    await sleepFn(50);
  }

  throw new Error(
    `Timed out waiting for browser-sessiond to become healthy after ${startupTimeoutMs}ms`,
  );
}

export async function runEnsureBrowserSessionCli(argv = process.argv.slice(2), deps = {}) {
  const options = parseCliArgs(argv);
  return (deps.ensureBrowserSession ?? ensureBrowserSession)(options);
}

function parseCliArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--session-root") {
      options.sessionRoot = requireOptionValue(argv, ++index, "--session-root");
      continue;
    }
    if (arg === "--runtime-version") {
      options.runtimeVersion = requireOptionValue(argv, ++index, "--runtime-version");
      continue;
    }
    if (arg === "--startup-timeout-ms") {
      const raw = requireOptionValue(argv, ++index, "--startup-timeout-ms");
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--startup-timeout-ms must be a positive integer");
      }
      options.startupTimeoutMs = parsed;
      continue;
    }
    if (arg === "--help") {
      throw new Error(USAGE);
    }
    throw new Error(
      `ensure-browser-session does not accept positional commands or action payloads. Use the HTTP endpoints after startup.\n\n${USAGE}`,
    );
  }

  return options;
}

function requireOptionValue(argv, index, flag) {
  const value = argv[index];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export async function main(argv = process.argv.slice(2)) {
  const result = await runEnsureBrowserSessionCli(argv);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function isDirectRunEntry(importMetaUrl, argv1 = process.argv[1]) {
  if (!argv1) {
    return false;
  }

  try {
    return realpathSync(fileURLToPath(importMetaUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

async function defaultLaunchBrowserSessionDaemon(options) {
  const daemonEntry = resolveBrowserSessionDaemonEntry();
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

function resolveBrowserSessionDaemonEntry() {
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
    const daemonEntry = resolveBrowserSessionDaemonEntry();
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

if (isDirectRunEntry(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown error"}\n`);
    process.exitCode = 1;
  });
}
