import process from "node:process";

import { formatCliError, isDirectCliInvocation, readCliArgs } from "../lib/cli.js";
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
  args: { tabRef: string; pageId: number },
  deps?: BrowserActionDeps,
) {
  return runWithBrowserActionDeps(deps, (resolvedDeps) =>
    runBrowserAction(
      {
        action: "select-tab",
        tabRef: args.tabRef,
        toolName: "select_page",
        toolArgs: {
          pageId: args.pageId,
          bringToFront: false,
        },
        preselectBoundTab: false,
        nextBrowserTabIndex: args.pageId,
      },
      resolvedDeps,
    ),
  );
}

export function parseSelectTabCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  pageId: number;
} {
  const pageIdValue =
    readCliStringArg(args, "page-id")
    ?? readCliStringArg(args, "index")
    ?? readCliStringArg(args, "tab-index");
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
