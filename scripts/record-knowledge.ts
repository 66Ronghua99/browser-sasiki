import process from "node:process";

import {
  formatCliError,
  isDirectCliInvocation,
  readCliArgs,
  sendSessionRpcRequest,
} from "../lib/cli.js";
import { KnowledgeStore } from "../lib/knowledge-store.js";
import { normalizePagePath } from "../lib/page-identity.js";

function cliString(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function parseKeywords(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function cliNormalizedPath(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "normalized-path") ?? cliString(args, "path");
}

function cliMaybeSnapshotRef(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "snapshot-ref") ?? cliString(args, "snapshotRef");
}

function cliMaybeTabRef(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "tab-ref") ?? cliString(args, "tabRef");
}

function cliMaybeKnowledgeRef(args: Record<string, string | boolean>): string | undefined {
  return cliString(args, "knowledge-ref") ?? cliString(args, "knowledgeRef");
}

function cliTitle(args: Record<string, string | boolean>): string {
  return cliString(args, "title") ?? "Unknown";
}

export interface RecordKnowledgeResult {
  ok: true;
  record: {
    id: string;
    page: {
      origin: string;
      normalizedPath: string;
      title: string;
    };
    guide: string;
    keywords: string[];
    createdAt?: string;
    updatedAt?: string;
    sourceSnapshotPath?: string;
    sourceAction?: string;
    rationale?: string;
  };
}

export async function runRecordKnowledgeCommand(args: Record<string, string | boolean>): Promise<RecordKnowledgeResult> {
  const origin = cliString(args, "origin");
  const normalizedPath = cliNormalizedPath(args);
  const guide = cliString(args, "guide");
  const keywords = parseKeywords(cliString(args, "keywords"));
  const snapshotRef = cliMaybeSnapshotRef(args);
  const tabRef = cliMaybeTabRef(args);
  const knowledgeRef = cliMaybeKnowledgeRef(args);
  const knowledgeId = cliString(args, "id") ?? knowledgeRef;
  const knowledgeFile = cliString(args, "knowledge-file");
  const useStandaloneKnowledgeFile = knowledgeFile !== undefined && snapshotRef === undefined && tabRef === undefined;

  if (!origin || !normalizedPath) {
    throw new Error("record-knowledge requires --origin and --normalized-path");
  }
  if (!guide) {
    throw new Error("record-knowledge requires --guide");
  }
  if (keywords.length === 0) {
    throw new Error("record-knowledge requires at least one keyword");
  }

  const page = {
    origin,
    normalizedPath: normalizePagePath(normalizedPath),
    title: cliTitle(args),
  };

  if (useStandaloneKnowledgeFile) {
    const createdAt = new Date().toISOString();
    const record = {
      id: knowledgeId ?? `knowledge_${Date.now()}`,
      page,
      guide,
      keywords,
      createdAt,
      updatedAt: createdAt,
      rationale: cliString(args, "rationale"),
    };
    const store = new KnowledgeStore(knowledgeFile);
    await store.append({
      ...record,
      page: {
        origin: record.page.origin,
        normalizedPath: record.page.normalizedPath,
      },
    });
    return {
      ok: true as const,
      record,
    };
  }

  return (await sendSessionRpcRequest("recordKnowledge", {
    ...(tabRef !== undefined ? { tabRef } : {}),
    ...(snapshotRef !== undefined ? { snapshotRef } : {}),
    ...(knowledgeId !== undefined ? { knowledgeRef: knowledgeId } : {}),
    page,
    guide,
    keywords,
    ...(cliString(args, "rationale") !== undefined ? { rationale: cliString(args, "rationale") } : {}),
  })) as RecordKnowledgeResult;
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runRecordKnowledgeCommand(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
