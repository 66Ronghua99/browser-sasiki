import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function readCliArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

export function isDirectCliInvocation(importMetaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) {
    return false;
  }

  const entryPath = normalizeInvocationPath(argv1);
  const modulePath = normalizeInvocationPath(fileURLToPath(importMetaUrl));
  return entryPath === modulePath;
}

function normalizeInvocationPath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  try {
    return typeof fs.realpathSync.native === "function"
      ? fs.realpathSync.native(resolvedPath)
      : fs.realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

export function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
