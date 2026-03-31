import process from "node:process";

import {
  formatCliError,
  isDirectCliInvocation,
  readCliArgs,
  sendSessionRpcRequest,
  withSnapshotRefFirst,
} from "../lib/cli.js";
import { requireCliStringArg } from "../lib/browser-action.js";
import { assertSessionRpcResult } from "../runtime/session-rpc-types.js";
import type { PublicActionResult } from "../lib/types.js";

export async function runNavigateCommand(
  args: { tabRef: string; url: string },
): Promise<PublicActionResult> {
  const result = await sendSessionRpcRequest("navigate", {
    tabRef: args.tabRef,
    url: args.url,
  });
  assertSessionRpcResult(result);
  const actionResult = {
    ...result,
    action: "navigate" as const,
  };
  return withSnapshotRefFirst(actionResult);
}

export function parseNavigateCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  url: string;
} {
  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    url: requireCliStringArg(args, "url", "url"),
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runNavigateCommand(parseNavigateCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
