import os from "node:os";
import path from "node:path";
import { mkdir, appendFile } from "node:fs/promises";

const DEFAULT_DEBUG_LOG_PATH = path.join(os.homedir(), ".sasiki", "browser-skill", "tmp", "debug", "browser-sessiond.log");

export async function appendBrowserDebugLog(event, payload = {}, options = {}) {
  const env = options.env ?? process.env;
  if (!shouldWriteBrowserDebugLog(env)) {
    return;
  }

  const logPath = resolveBrowserDebugLogPath(env);
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...sanitizeForJson(payload),
  };

  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    return;
  }
}

function shouldWriteBrowserDebugLog(env) {
  return env.SASIKI_BROWSER_DEBUG_LOG === "1";
}

function resolveBrowserDebugLogPath(env) {
  const configured = env.SASIKI_BROWSER_DEBUG_LOG_PATH?.trim();
  return configured && configured.length > 0 ? configured : DEFAULT_DEBUG_LOG_PATH;
}

function sanitizeForJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForJson(entry));
  }

  if (value && typeof value === "object") {
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = sanitizeForJson(entry);
    }
    return clone;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  return value;
}
