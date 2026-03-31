import process from "node:process";

import {
  formatCliError,
  isDirectCliInvocation,
  readCliArgs,
  sendSessionRpcRequest,
  withSnapshotRefFirst,
} from "../lib/cli.js";
import {
  optionalCliStringArgWithAliases,
  parseCliIntegerArg,
  requireCliIntegerArg,
  requireCliStringArg,
} from "../lib/browser-action.js";
import { assertSessionRpcResult } from "../runtime/session-rpc-types.js";
import type { PublicActionResult } from "../lib/types.js";

export async function runSelectTabCommand(
  args: { tabRef: string; pageId: number },
): Promise<PublicActionResult> {
  const result = await sendSessionRpcRequest("selectTab", {
    tabRef: args.tabRef,
    pageId: args.pageId,
  });
  assertSessionRpcResult(result);
  const actionResult = {
    ...result,
    action: "select-tab" as const,
  };
  return withSnapshotRefFirst(actionResult);
}

export function parseSelectTabCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  pageId: number;
} {
  const pageIdValue = optionalCliStringArgWithAliases(args, "pageId", "page-id", "index", "tab-index");
  if (pageIdValue === undefined) {
    throw new Error("pageId is required (--page-id)");
  }

  const pageId = parseCliIntegerArg(pageIdValue, "pageId") ?? requireCliIntegerArg(args, "page-id", "pageId");
  if (pageId < 1) {
    throw new Error("pageId must be a positive integer");
  }

  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    pageId,
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runSelectTabCommand(parseSelectTabCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
