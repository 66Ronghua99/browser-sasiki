import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { readCliArgs } from "../lib/cli.js";
import { defaultRuntimeRoots } from "../lib/paths.js";
import { KnowledgeStore } from "../lib/knowledge-store.js";
import { pageIdentityFromSnapshotText, normalizePagePath } from "../lib/page-identity.js";
import { querySnapshotText } from "../lib/knowledge-query.js";

function cliString(args: Record<string, string | boolean>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function resolveSnapshotText(args: Record<string, string | boolean>): Promise<string> {
  const inlineSnapshotText = cliString(args, "snapshot-text");
  if (inlineSnapshotText !== undefined) {
    return Promise.resolve(inlineSnapshotText);
  }

  const snapshotPath = cliString(args, "snapshot-path");
  if (snapshotPath === undefined) {
    throw new Error("query-snapshot requires --snapshot-path or --snapshot-text");
  }

  return fs.readFile(path.resolve(snapshotPath), "utf8");
}

function resolveKnowledgeStore(args: Record<string, string | boolean>): KnowledgeStore {
  const knowledgeFile = cliString(args, "knowledge-file") ?? defaultRuntimeRoots().knowledgeFile;
  return new KnowledgeStore(path.resolve(knowledgeFile));
}

function resolvePage(args: Record<string, string | boolean>, snapshotText: string) {
  const origin = cliString(args, "origin");
  const normalizedPath = cliString(args, "path");
  const title = cliString(args, "title");
  if (origin && normalizedPath) {
    let snapshotTitle = "Unknown";
    try {
      snapshotTitle = pageIdentityFromSnapshotText(snapshotText).title;
    } catch {
      snapshotTitle = "Unknown";
    }

    return {
      origin,
      normalizedPath: normalizePagePath(normalizedPath),
      title: title ?? snapshotTitle,
    };
  }

  return pageIdentityFromSnapshotText(snapshotText);
}

export async function runQuerySnapshotCommand(args: Record<string, string | boolean>) {
  const snapshotText = await resolveSnapshotText(args);
  const page = resolvePage(args, snapshotText);
  const store = resolveKnowledgeStore(args);
  const knowledgeHits = await store.queryByPage(page);

  return querySnapshotText({
    snapshotText,
    mode: (cliString(args, "mode") ?? "search") as "search" | "auto" | "full",
    text: cliString(args, "text"),
    role: cliString(args, "role"),
    ref: cliString(args, "ref"),
    knowledgeHits: knowledgeHits.map((record) => ({
      guide: record.guide,
      keywords: record.keywords,
      rationale: record.rationale,
    })),
    page,
  });
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runQuerySnapshotCommand(args);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
