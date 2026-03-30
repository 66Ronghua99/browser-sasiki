import process from "node:process";

import { isDirectCliInvocation, readCliArgs } from "../lib/cli.js";
import {
  parseCliIntegerArg,
  readCliStringArg,
  requireCliIntegerArg,
  requireCliStringArg,
  runBrowserAction,
  runWithBrowserActionDeps,
  type BrowserActionDeps,
} from "../lib/browser-action.js";

export async function runSelectTabCommand(
  args: { tabRef: string; tabIndex: number },
  deps?: BrowserActionDeps,
) {
  return runWithBrowserActionDeps(deps, (resolvedDeps) =>
    runBrowserAction(
      {
        action: "select-tab",
        tabRef: args.tabRef,
        toolName: "browser_tabs",
        toolArgs: {
          action: "select",
          index: args.tabIndex,
        },
        preselectBoundTab: false,
        nextBrowserTabIndex: args.tabIndex,
      },
      resolvedDeps,
    ),
  );
}

export function parseSelectTabCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  tabIndex: number;
} {
  const tabIndexValue = readCliStringArg(args, "index") ?? readCliStringArg(args, "tab-index");
  if (tabIndexValue === undefined) {
    throw new Error("index is required (--index)");
  }

  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    tabIndex: parseCliIntegerArg(tabIndexValue, "index") ?? requireCliIntegerArg(args, "index", "index"),
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runSelectTabCommand(parseSelectTabCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
