import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";

import { readCliArgs } from "../lib/cli.js";
import { defaultRuntimeRoots } from "../lib/paths.js";
import { KnowledgeStore } from "../lib/knowledge-store.js";
import { normalizePagePath } from "../lib/page-identity.js";

function cliString(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function resolveStore(args: Record<string, string | boolean>): KnowledgeStore {
  const knowledgeFile = cliString(args, "knowledge-file") ?? defaultRuntimeRoots().knowledgeFile;
  return new KnowledgeStore(path.resolve(knowledgeFile));
}

function parseKeywords(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export async function runRecordKnowledgeCommand(args: Record<string, string | boolean>) {
  const origin = cliString(args, "origin");
  const normalizedPath = cliString(args, "path");
  const guide = cliString(args, "guide");
  const keywords = parseKeywords(cliString(args, "keywords"));

  if (!origin || !normalizedPath) {
    throw new Error("record-knowledge requires --origin and --path");
  }
  if (!guide) {
    throw new Error("record-knowledge requires --guide");
  }
  if (keywords.length === 0) {
    throw new Error("record-knowledge requires at least one keyword");
  }

  const createdAt = new Date().toISOString();
  const record = {
    id: cliString(args, "id") ?? `knowledge_${randomUUID()}`,
    page: {
      origin,
      normalizedPath: normalizePagePath(normalizedPath),
    },
    guide,
    keywords,
    createdAt,
    updatedAt: createdAt,
    sourceSnapshotPath: cliString(args, "snapshot-path"),
    sourceAction: cliString(args, "source-action"),
    rationale: cliString(args, "rationale"),
  };

  const store = resolveStore(args);
  await store.append(record);

  return {
    ok: true as const,
    record,
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runRecordKnowledgeCommand(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
