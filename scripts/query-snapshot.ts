import process from "node:process";

import { formatCliError, isDirectCliInvocation, readCliArgs, sendSessionRpcRequest } from "../lib/cli.js";
import { optionalCliStringArgWithAliases, requireCliStringArg } from "../lib/browser-action.js";
import { querySnapshotText } from "../lib/knowledge-query.js";
import { pageIdentityFromSnapshotText, normalizePagePath } from "../lib/page-identity.js";
import type { SessionRpcRequestMap } from "../runtime/session-rpc-types.js";

export interface QuerySnapshotCliArgs {
  mode: "search" | "auto" | "full";
  tabRef?: string;
  snapshotRef?: string;
  snapshotText?: string;
  text?: string;
  role?: string;
  uid?: string;
  ref?: string;
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
  uid?: string;
  ref?: string;
}): void {
  if (args.text !== undefined || args.role !== undefined || args.uid !== undefined || args.ref !== undefined) {
    return;
  }

  throw new Error("search mode requires at least one selector (--text, --query, --role, --uid, or --ref)");
}

function resolveHandleSelector(uid: string | undefined, ref: string | undefined): { uid?: string; ref?: string } {
  if (uid !== undefined && ref !== undefined && uid !== ref) {
    throw new Error("--uid and --ref must match when both are provided");
  }

  return {
    uid: uid ?? ref,
    ref,
  };
}

export function parseQuerySnapshotCliArgs(args: Record<string, string | boolean>): QuerySnapshotCliArgs {
  const tabRef = optionalCliStringArgWithAliases(args, "tabRef", "tab-ref", "tabRef");
  const snapshotRef = optionalCliStringArgWithAliases(args, "snapshotRef", "snapshot-ref", "snapshotRef");
  const snapshotText = optionalCliStringArgWithAliases(args, "snapshotText", "snapshot-text", "snapshotText");
  const text = optionalCliStringArgWithAliases(args, "text", "text");
  const query = optionalCliStringArgWithAliases(args, "query", "query");
  const role = optionalCliStringArgWithAliases(args, "role", "role");
  const uid = optionalCliStringArgWithAliases(args, "uid", "uid");
  const ref = optionalCliStringArgWithAliases(args, "ref", "ref");
  const origin = optionalCliStringArgWithAliases(args, "origin", "origin");
  const normalizedPath = optionalCliStringArgWithAliases(args, "path", "path");
  const title = optionalCliStringArgWithAliases(args, "title", "title");
  const modeValue = requireCliStringArg(args, "mode", "mode");

  if (optionalCliStringArgWithAliases(args, "knowledgeFile", "knowledge-file", "knowledgeFile") !== undefined) {
    throw new Error("query-snapshot no longer accepts --knowledge-file; daemon-backed retrieval owns knowledge hits");
  }

  if (optionalCliStringArgWithAliases(args, "snapshotPath", "snapshot-path", "snapshotPath") !== undefined) {
    throw new Error("query-snapshot no longer accepts --snapshot-path; use --tab-ref, --snapshot-ref, or --snapshot-text");
  }

  if (tabRef === undefined && snapshotRef === undefined && snapshotText === undefined) {
    throw new Error("query-snapshot requires --tab-ref, --snapshot-ref, or --snapshot-text");
  }

  const selectorText = text ?? query;
  const handleSelector = resolveHandleSelector(uid, ref);
  const mode = requireValidMode(modeValue);
  if (mode === "search") {
    requireSearchSelector({
      text: selectorText,
      role,
      uid: handleSelector.uid,
      ref: handleSelector.ref,
    });
  }

  return {
    mode,
    tabRef,
    snapshotRef,
    snapshotText,
    text: selectorText,
    role,
    uid: handleSelector.uid,
    ref: handleSelector.ref,
    origin,
    path: normalizedPath,
    title,
  };
}

function buildSnapshotQueryRequest(args: QuerySnapshotCliArgs): SessionRpcRequestMap["querySnapshot"] {
  return {
    ...(args.tabRef !== undefined ? { tabRef: args.tabRef } : {}),
    ...(args.snapshotRef !== undefined ? { snapshotRef: args.snapshotRef } : {}),
    mode: args.mode,
    ...(args.text !== undefined ? { query: args.text } : {}),
    ...(args.role !== undefined ? { role: args.role } : {}),
    ...(args.uid !== undefined ? { uid: args.uid } : {}),
  };
}

function resolveSessionQueryResult(value: unknown): ReturnType<typeof querySnapshotText> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("querySnapshot session response must be an object");
  }

  const result = value as Record<string, unknown>;
  if (result.mode === "search" || result.mode === "auto" || result.mode === "full") {
    const { snapshotPath: _snapshotPath, ...publicResult } = result;
    return publicResult as unknown as ReturnType<typeof querySnapshotText>;
  }

  throw new Error("querySnapshot session response must be a completed query result");
}

export async function runQuerySnapshotCommand(args: QuerySnapshotCliArgs): Promise<ReturnType<typeof querySnapshotText>> {
  if (args.snapshotText !== undefined && args.tabRef === undefined && args.snapshotRef === undefined) {
    const page = (() => {
      if (args.origin && args.path) {
        return {
          origin: args.origin,
          normalizedPath: normalizePagePath(args.path),
          title: args.title ?? "Unknown",
        };
      }

      return pageIdentityFromSnapshotText(args.snapshotText);
    })();

    return querySnapshotText({
      snapshotText: args.snapshotText,
      mode: args.mode,
      text: args.text,
      role: args.role,
      uid: args.uid,
      ref: args.ref,
      knowledgeHits: [],
      page,
    });
  }

  const sessionResult = await sendSessionRpcRequest("querySnapshot", buildSnapshotQueryRequest(args));
  return resolveSessionQueryResult(sessionResult);
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runQuerySnapshotCommand(parseQuerySnapshotCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
