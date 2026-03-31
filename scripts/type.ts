import process from "node:process";

import {
  formatCliError,
  isDirectCliInvocation,
  readCliArgs,
  sendSessionRpcRequest,
  withSnapshotRefFirst,
} from "../lib/cli.js";
import {
  optionalCliStringArg,
  parseCliBooleanArg,
  requireCliStringArg,
} from "../lib/browser-action.js";
import { assertSessionRpcResult } from "../runtime/session-rpc-types.js";
import type { PublicActionResult } from "../lib/types.js";

export async function runTypeCommand(
  args: { tabRef: string; uid: string; text: string; slowly?: boolean; submit?: boolean },
): Promise<PublicActionResult> {
  if (args.submit) {
    throw new Error("type submit is unsupported: Chrome DevTools MCP requires a separate press command");
  }

  if (args.slowly) {
    throw new Error("type slowly is unsupported: Chrome DevTools MCP fill does not support slow typing");
  }

  const result = await sendSessionRpcRequest("type", {
    tabRef: args.tabRef,
    uid: args.uid,
    text: args.text,
  });
  assertSessionRpcResult(result);
  const actionResult = {
    ...result,
    action: "type" as const,
  };
  return withSnapshotRefFirst(actionResult);
}

export function parseTypeCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  uid: string;
  text: string;
  slowly?: boolean;
  submit?: boolean;
} {
  const uid = optionalCliStringArg(args, "uid", "uid");
  const ref = optionalCliStringArg(args, "ref", "ref");
  if (uid !== undefined && ref !== undefined && uid !== ref) {
    throw new Error("--uid and --ref must match when both are provided");
  }

  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    uid: uid ?? ref ?? requireCliStringArg(args, "uid", "uid"),
    text: requireCliStringArg(args, "text", "text"),
    slowly: parseCliBooleanArg(args.slowly),
    submit: parseCliBooleanArg(args.submit),
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runTypeCommand(parseTypeCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatCliError(error)}\n`);
    process.exitCode = 1;
  });
}
