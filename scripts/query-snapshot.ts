import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { readCliArgs } from "../lib/cli.js";
import { optionalCliStringArg, requireCliStringArg } from "../lib/browser-action.js";
import { defaultRuntimeRoots } from "../lib/paths.js";
import { KnowledgeStore } from "../lib/knowledge-store.js";
import { pageIdentityFromSnapshotText, normalizePagePath } from "../lib/page-identity.js";
import { querySnapshotText } from "../lib/knowledge-query.js";
import { TabBindingStore } from "../lib/tab-binding-store.js";

export interface QuerySnapshotCliArgs {
  mode: "search" | "auto" | "full";
  tabRef?: string;
  snapshotPath?: string;
  snapshotText?: string;
  text?: string;
  role?: string;
  ref?: string;
  knowledgeFile?: string;
  origin?: string;
  path?: string;
  title?: string;
}

function requireValidMode(mode: string): QuerySnapshotCliArgs["mode"] {
  if (mode === "search" || mode === "auto" || mode === "full") {
    return mode;
  }

  throw new Error(`mode must be one of: search, auto, full (received ${mode})`);
}

function requireSearchSelector(args: {
  text?: string;
  role?: string;
  ref?: string;
}): void {
  if (args.text !== undefined || args.role !== undefined || args.ref !== undefined) {
    return;
  }

  throw new Error("search mode requires at least one selector (--text, --query, --role, or --ref)");
}

async function resolveSnapshotText(args: QuerySnapshotCliArgs): Promise<string> {
  const inlineSnapshotText = args.snapshotText;
  if (inlineSnapshotText !== undefined) {
    return Promise.resolve(inlineSnapshotText);
  }

  if (args.snapshotPath !== undefined) {
    return fs.readFile(path.resolve(args.snapshotPath), "utf8");
  }

  if (args.tabRef !== undefined) {
    const roots = defaultRuntimeRoots();
    const tabBindings = new TabBindingStore(path.join(roots.tempRoot, "tab-state"));
    const binding = await tabBindings.read(args.tabRef);
    return fs.readFile(path.resolve(binding.snapshotPath), "utf8");
  }

  throw new Error("query-snapshot requires --tab-ref, --snapshot-path, or --snapshot-text");
}

function resolveKnowledgeStore(args: QuerySnapshotCliArgs): KnowledgeStore {
  const knowledgeFile = args.knowledgeFile ?? defaultRuntimeRoots().knowledgeFile;
  return new KnowledgeStore(path.resolve(knowledgeFile));
}

function resolvePage(args: QuerySnapshotCliArgs, snapshotText: string) {
  const origin = args.origin;
  const normalizedPath = args.path;
  const title = args.title;
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

export function parseQuerySnapshotCliArgs(args: Record<string, string | boolean>): QuerySnapshotCliArgs {
  const tabRef = optionalCliStringArg(args, "tab-ref", "tabRef");
  const snapshotPath = optionalCliStringArg(args, "snapshot-path", "snapshotPath");
  const snapshotText = optionalCliStringArg(args, "snapshot-text", "snapshotText");
  const text = optionalCliStringArg(args, "text", "text");
  const query = optionalCliStringArg(args, "query", "query");
  const role = optionalCliStringArg(args, "role", "role");
  const ref = optionalCliStringArg(args, "ref", "ref");
  const knowledgeFile = optionalCliStringArg(args, "knowledge-file", "knowledgeFile");
  const origin = optionalCliStringArg(args, "origin", "origin");
  const normalizedPath = optionalCliStringArg(args, "path", "path");
  const title = optionalCliStringArg(args, "title", "title");
  const modeValue = requireCliStringArg(args, "mode", "mode");

  if (tabRef === undefined && snapshotPath === undefined && snapshotText === undefined) {
    throw new Error("query-snapshot requires --tab-ref, --snapshot-path, or --snapshot-text");
  }

  const selectorText = text ?? query;
  const mode = requireValidMode(modeValue);
  if (mode === "search") {
    requireSearchSelector({
      text: selectorText,
      role,
      ref,
    });
  }

  return {
    mode,
    tabRef,
    snapshotPath,
    snapshotText,
    text: selectorText,
    role,
    ref,
    knowledgeFile,
    origin,
    path: normalizedPath,
    title,
  };
}

export async function runQuerySnapshotCommand(args: QuerySnapshotCliArgs) {
  const snapshotText = await resolveSnapshotText(args);
  const page = resolvePage(args, snapshotText);
  const store = resolveKnowledgeStore(args);
  const knowledgeHits = await store.queryByPage(page);

  return querySnapshotText({
    snapshotText,
    mode: args.mode,
    text: args.text,
    role: args.role,
    ref: args.ref,
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
  const result = await runQuerySnapshotCommand(parseQuerySnapshotCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
