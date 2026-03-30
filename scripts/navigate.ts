import process from "node:process";

import { formatCliError, isDirectCliInvocation, readCliArgs } from "../lib/cli.js";
import {
  requireCliStringArg,
  runBrowserAction,
  runWithBrowserActionDeps,
  type BrowserActionDeps,
} from "../lib/browser-action.js";

export async function runNavigateCommand(
  args: { tabRef: string; url: string },
  deps?: BrowserActionDeps,
) {
  return runWithBrowserActionDeps(deps, (resolvedDeps) =>
    runBrowserAction(
      {
        action: "navigate",
        tabRef: args.tabRef,
        toolName: "navigate_page",
        toolArgs: {
          type: "url",
          url: args.url,
        },
      },
      resolvedDeps,
    ),
  );
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
