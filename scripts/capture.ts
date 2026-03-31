import process from "node:process";

import {
  formatCliError,
  isDirectCliInvocation,
  readCliArgs,
  sendSessionRpcRequest,
  withSnapshotRefFirst,
} from "../lib/cli.js";
import { optionalCliStringArg, optionalCliStringArgWithAliases, parseCliIntegerArg } from "../lib/browser-action.js";
import type { PublicCaptureResult } from "../lib/types.js";
import { assertSessionCaptureResult } from "../runtime/session-rpc-types.js";

export async function runCaptureCommand(
  args: { pageId?: number; tabRef?: string },
): Promise<PublicCaptureResult> {
  const params: { pageId?: number; tabRef?: string } = {};
  if (args.pageId !== undefined) {
    params.pageId = args.pageId;
  }
  if (args.tabRef !== undefined) {
    params.tabRef = args.tabRef;
  }

  const result = await sendSessionRpcRequest("capture", params);
  assertSessionCaptureResult(result);
  return withSnapshotRefFirst(result);
}

export function parseCaptureCliArgs(args: Record<string, string | boolean>): {
  pageId?: number;
  tabRef?: string;
} {
  const tabRef = optionalCliStringArg(args, "tab-ref", "tabRef");
  const pageIdValue = optionalCliStringArgWithAliases(args, "pageId", "page-id", "tab-index", "tabIndex");

  return {
    ...(pageIdValue !== undefined
      ? { pageId: parseCliIntegerArg(pageIdValue, "pageId") as number }
      : {}),
    ...(tabRef !== undefined ? { tabRef } : {}),
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runCaptureCommand(parseCaptureCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
