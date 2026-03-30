import path from "node:path";
import process from "node:process";

import { formatCliError, isDirectCliInvocation, readCliArgs, sendSessionRpcRequest } from "../lib/cli.js";
import { optionalCliStringArg, requireCliStringArg } from "../lib/browser-action.js";
import { querySnapshotText } from "../lib/knowledge-query.js";
import { pageIdentityFromSnapshotText, normalizePagePath } from "../lib/page-identity.js";
import type { SessionRpcRequestMap } from "../runtime/session-rpc-types.js";

export interface QuerySnapshotCliArgs {
  mode: "search" | "auto" | "full";
  tabRef?: string;
  snapshotRef?: string;
  snapshotPath?: string;
  snapshotText?: string;
  text?: string;
  role?: string;
  uid?: string;
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
  const tabRef = optionalCliStringArg(args, "tab-ref", "tabRef");
  const snapshotRef = optionalCliStringArg(args, "snapshot-ref", "snapshotRef");
  const snapshotPath = optionalCliStringArg(args, "snapshot-path", "snapshotPath");
  const snapshotText = optionalCliStringArg(args, "snapshot-text", "snapshotText");
  const text = optionalCliStringArg(args, "text", "text");
  const query = optionalCliStringArg(args, "query", "query");
  const role = optionalCliStringArg(args, "role", "role");
  const uid = optionalCliStringArg(args, "uid", "uid");
  const ref = optionalCliStringArg(args, "ref", "ref");
  const knowledgeFile = optionalCliStringArg(args, "knowledge-file", "knowledgeFile");
  const origin = optionalCliStringArg(args, "origin", "origin");
  const normalizedPath = optionalCliStringArg(args, "path", "path");
  const title = optionalCliStringArg(args, "title", "title");
  const modeValue = requireCliStringArg(args, "mode", "mode");

  if (tabRef === undefined && snapshotRef === undefined && snapshotPath === undefined && snapshotText === undefined) {
    throw new Error("query-snapshot requires --tab-ref, --snapshot-ref, --snapshot-path, or --snapshot-text");
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
    snapshotPath,
    snapshotText,
    text: selectorText,
    role,
    uid: handleSelector.uid,
    ref: handleSelector.ref,
    knowledgeFile,
    origin,
    path: normalizedPath,
    title,
  };
}

function buildSnapshotQueryRequest(args: QuerySnapshotCliArgs): SessionRpcRequestMap["querySnapshot"] {
  return {
    ...(args.tabRef !== undefined ? { tabRef: args.tabRef } : {}),
    ...(args.snapshotRef !== undefined ? { snapshotRef: args.snapshotRef } : {}),
    ...(args.snapshotPath !== undefined ? { snapshotPath: path.resolve(args.snapshotPath) } : {}),
    mode: args.mode,
    ...(args.text !== undefined ? { query: args.text } : {}),
    ...(args.uid !== undefined ? { uid: args.uid } : {}),
    includeSnapshot: true,
  };
}

function resolveSessionQueryResult(args: QuerySnapshotCliArgs, value: unknown): ReturnType<typeof querySnapshotText> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("querySnapshot session response must be an object");
  }

  const result = value as Record<string, unknown>;
  if (result.mode === "search" || result.mode === "auto" || result.mode === "full") {
    return value as ReturnType<typeof querySnapshotText>;
  }

  if (typeof result.snapshotText === "string") {
    const page =
      typeof result.page === "object" && result.page !== null
        ? (result.page as ReturnType<typeof pageIdentityFromSnapshotText>)
        : pageIdentityFromSnapshotText(result.snapshotText);
    return querySnapshotText({
      snapshotText: result.snapshotText,
      mode: args.mode,
      text: args.text,
      role: args.role,
      uid: args.uid,
      ref: args.ref,
      knowledgeHits: Array.isArray(result.knowledgeHits) ? (result.knowledgeHits as ReturnType<typeof querySnapshotText>["knowledgeHits"]) : [],
      page,
    });
  }

  throw new Error("querySnapshot session response must include snapshotText or a completed query result");
}

export async function runQuerySnapshotCommand(args: QuerySnapshotCliArgs): Promise<ReturnType<typeof querySnapshotText>> {
  if (args.snapshotText !== undefined && args.tabRef === undefined && args.snapshotRef === undefined && args.snapshotPath === undefined) {
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
  return resolveSessionQueryResult(args, sessionResult);
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
