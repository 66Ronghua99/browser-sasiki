import process from "node:process";
import path from "node:path";

import { formatCliError, isDirectCliInvocation, readCliArgs } from "../lib/cli.js";
import { defaultRuntimeRoots } from "../lib/paths.js";
import { KnowledgeStore, type DurableKnowledgeRecord } from "../lib/knowledge-store.js";
import { normalizePagePath } from "../lib/page-identity.js";

function cliString(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function resolveStore(args: Record<string, string | boolean>): KnowledgeStore {
  const knowledgeFile = cliString(args, "knowledge-file") ?? defaultRuntimeRoots().knowledgeFile;
  return new KnowledgeStore(path.resolve(knowledgeFile));
}

function cliMaybeKnowledgeId(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "id") ?? cliString(args, "knowledge-id");
}

function cliNormalizedPath(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "normalized-path") ?? cliString(args, "path");
}

export type ReadKnowledgeResult =
  | {
      ok: true;
      mode: "page";
      page: {
        origin: string;
        normalizedPath: string;
      };
      knowledge: DurableKnowledgeRecord[];
    }
  | {
      ok: true;
      mode: "id";
      knowledge: DurableKnowledgeRecord;
    };

export async function runReadKnowledgeCommand(args: Record<string, string | boolean>): Promise<ReadKnowledgeResult> {
  const knowledgeId = cliMaybeKnowledgeId(args);
  if (knowledgeId) {
    const store = resolveStore(args);
    const knowledge = await store.readById(knowledgeId);
    return {
      ok: true as const,
      mode: "id",
      knowledge,
    };
  }

  const origin = cliString(args, "origin");
  const normalizedPath = cliNormalizedPath(args);
  if (!origin || !normalizedPath) {
    throw new Error("read-knowledge requires --origin and --normalized-path or --id");
  }

  const store = resolveStore(args);
  const knowledge = await store.queryByPage({
    origin,
    normalizedPath: normalizePagePath(normalizedPath),
  });

  return {
    ok: true as const,
    mode: "page",
    page: {
      origin,
      normalizedPath: normalizePagePath(normalizedPath),
    },
    knowledge,
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runReadKnowledgeCommand(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
