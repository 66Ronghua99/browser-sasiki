import process from "node:process";

import {
  formatCliError,
  isDirectCliInvocation,
  readCliArgs,
  sendSessionRpcRequest,
} from "../lib/cli.js";
import { KnowledgeStore, type DurableKnowledgeRecord } from "../lib/knowledge-store.js";
import { normalizePagePath } from "../lib/page-identity.js";

function cliString(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function buildPage(args: Record<string, string | boolean>): {
  origin: string;
  normalizedPath: string;
  title: string;
} | undefined {
  const origin = cliString(args, "origin");
  const normalizedPath = cliNormalizedPath(args);
  if (!origin || !normalizedPath) {
    return undefined;
  }

  return {
    origin,
    normalizedPath: normalizePagePath(normalizedPath),
    title: cliString(args, "title") ?? "Unknown",
  };
}

function cliMaybeKnowledgeId(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "id") ?? cliString(args, "knowledge-id");
}

function cliMaybeSnapshotRef(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "snapshot-ref") ?? cliString(args, "snapshotRef");
}

function cliMaybeTabRef(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "tab-ref") ?? cliString(args, "tabRef");
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
  const knowledgeRef = cliString(args, "knowledge-ref") ?? cliString(args, "knowledgeRef");
  const snapshotRef = cliMaybeSnapshotRef(args);
  const tabRef = cliMaybeTabRef(args);
  const page = buildPage(args);
  const knowledgeFile = cliString(args, "knowledge-file");
  const useStandaloneKnowledgeFile = knowledgeFile !== undefined && snapshotRef === undefined && tabRef === undefined;

  if (useStandaloneKnowledgeFile) {
    const store = new KnowledgeStore(knowledgeFile);
    if (knowledgeId || knowledgeRef) {
      return {
        ok: true as const,
        mode: "id",
        knowledge: await store.readById(knowledgeRef ?? knowledgeId ?? ""),
      };
    }
    if (!page) {
      throw new Error("read-knowledge requires --origin and --normalized-path or --id");
    }
    return {
      ok: true as const,
      mode: "page",
      page: {
        origin: page.origin,
        normalizedPath: page.normalizedPath,
      },
      knowledge: await store.queryByPage(page),
    };
  }

  const request = {
    ...(tabRef !== undefined ? { tabRef } : {}),
    ...(snapshotRef !== undefined ? { snapshotRef } : {}),
    ...(knowledgeId !== undefined ? { knowledgeRef: knowledgeId } : {}),
    ...(knowledgeRef !== undefined ? { knowledgeRef } : {}),
    ...(page !== undefined ? { page } : {}),
  };

  return (await sendSessionRpcRequest("readKnowledge", request)) as ReadKnowledgeResult;
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
