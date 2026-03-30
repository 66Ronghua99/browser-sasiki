import process from "node:process";
import path from "node:path";

import { readCliArgs } from "../lib/cli.js";
import { defaultRuntimeRoots } from "../lib/paths.js";
import { KnowledgeStore } from "../lib/knowledge-store.js";

function cliString(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function resolveStore(args: Record<string, string | boolean>): KnowledgeStore {
  const knowledgeFile = cliString(args, "knowledge-file") ?? defaultRuntimeRoots().knowledgeFile;
  return new KnowledgeStore(path.resolve(knowledgeFile));
}

export async function runReadKnowledgeCommand(args: Record<string, string | boolean>) {
  const origin = cliString(args, "origin");
  const normalizedPath = cliString(args, "path");
  if (!origin || !normalizedPath) {
    throw new Error("read-knowledge requires --origin and --path");
  }

  const store = resolveStore(args);
  const knowledge = await store.queryByPage({
    origin,
    normalizedPath,
  });

  return {
    ok: true as const,
    page: {
      origin,
      normalizedPath,
    },
    knowledge,
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runReadKnowledgeCommand(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
