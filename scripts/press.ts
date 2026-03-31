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

export async function runPressCommand(
  args: { tabRef: string; key: string },
): Promise<PublicActionResult> {
  const result = await sendSessionRpcRequest("press", {
    tabRef: args.tabRef,
    key: args.key,
  });
  assertSessionRpcResult(result);
  const actionResult = {
    ...result,
    action: "press" as const,
  };
  return withSnapshotRefFirst(actionResult);
}

export function parsePressCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  key: string;
} {
  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    key: requireCliStringArg(args, "key", "key"),
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runPressCommand(parsePressCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
