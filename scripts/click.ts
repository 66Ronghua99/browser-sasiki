import process from "node:process";

import {
  formatCliError,
  isDirectCliInvocation,
  readCliArgs,
  sendSessionRpcRequest,
  withSnapshotRefFirst,
} from "../lib/cli.js";
import { optionalCliStringArg, requireCliStringArg } from "../lib/browser-action.js";
import { assertSessionRpcResult } from "../runtime/session-rpc-types.js";
import type { ActionResult } from "../lib/types.js";

export async function runClickCommand(
  args: { tabRef: string; uid: string },
): Promise<ActionResult> {
  const result = await sendSessionRpcRequest("click", {
    tabRef: args.tabRef,
    uid: args.uid,
  });
  assertSessionRpcResult(result);
  const actionResult = {
    ...result,
    action: "click" as const,
  };
  return withSnapshotRefFirst(actionResult);
}

export function parseClickCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  uid: string;
} {
  const uid = optionalCliStringArg(args, "uid", "uid");
  const ref = optionalCliStringArg(args, "ref", "ref");
  if (uid !== undefined && ref !== undefined && uid !== ref) {
    throw new Error("--uid and --ref must match when both are provided");
  }

  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    uid: uid ?? ref ?? requireCliStringArg(args, "uid", "uid"),
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runClickCommand(parseClickCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
