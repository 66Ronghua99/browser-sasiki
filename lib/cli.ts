import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  SessionRpcMethod,
  SessionRpcRequestEnvelope,
  SessionRpcRequestMap,
} from "../runtime/session-rpc-types.js";

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

type SessionRpcSender = <M extends SessionRpcMethod>(
  request: SessionRpcRequestEnvelope<M>,
) => Promise<unknown>;

let sessionRpcSenderOverride: SessionRpcSender | undefined;

async function defaultSessionRpcSender<M extends SessionRpcMethod>(
  request: SessionRpcRequestEnvelope<M>,
): Promise<unknown> {
  const moduleUrl = new URL("../runtime/session-client.js", import.meta.url);
  const { sendSessionRpcRequest } = await import(moduleUrl.href);
  return (sendSessionRpcRequest as SessionRpcSender)(request);
}

export function setSessionRpcRequestSenderForTesting(sender: SessionRpcSender | undefined): void {
  sessionRpcSenderOverride = sender;
}

export function hasSessionRpcRequestSenderOverride(): boolean {
  return sessionRpcSenderOverride !== undefined;
}

export async function sendSessionRpcRequest<M extends SessionRpcMethod>(
  method: M,
  params: SessionRpcRequestMap[M],
): Promise<unknown> {
  const request: SessionRpcRequestEnvelope<M> = {
    requestId: randomUUID(),
    method,
    params,
  };
  const sender = sessionRpcSenderOverride ?? defaultSessionRpcSender;
  return sender(request);
}

export function withSnapshotRefFirst<T extends {
  ok: true;
  snapshotRef: string;
  snapshotPath: string;
  tabRef: string;
  page: unknown;
  knowledgeHits: unknown;
  summary: string;
  knowledgeRef?: string;
}>(result: T): T {
  const ordered: Record<string, unknown> = {
    ok: result.ok,
    snapshotRef: result.snapshotRef,
    snapshotPath: result.snapshotPath,
    tabRef: result.tabRef,
    page: result.page,
    knowledgeHits: result.knowledgeHits,
    summary: result.summary,
  };

  if (result.knowledgeRef !== undefined) {
    ordered.knowledgeRef = result.knowledgeRef;
  }

  for (const [key, value] of Object.entries(result)) {
    if (key in ordered) {
      continue;
    }
    ordered[key] = value;
  }

  return ordered as T;
}
