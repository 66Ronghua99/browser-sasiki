import process from "node:process";

import { formatCliError, isDirectCliInvocation, readCliArgs } from "../lib/cli.js";
import {
  requireCliStringArg,
  runBrowserAction,
  runWithBrowserActionDeps,
  type BrowserActionDeps,
} from "../lib/browser-action.js";

export async function runClickCommand(
  args: { tabRef: string; uid: string },
  deps?: BrowserActionDeps,
) {
  return runWithBrowserActionDeps(deps, (resolvedDeps) =>
    runBrowserAction(
      {
        action: "click",
        tabRef: args.tabRef,
        toolName: "click",
        toolArgs: {
          uid: args.uid,
        },
      },
      resolvedDeps,
    ),
  );
}

export function parseClickCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  uid: string;
} {
  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    uid: requireCliStringArg(args, "uid", "uid"),
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
