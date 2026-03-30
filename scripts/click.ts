import process from "node:process";

import { readCliArgs } from "../lib/cli.js";
import {
  requireCliStringArg,
  runBrowserAction,
  runWithBrowserActionDeps,
  type BrowserActionDeps,
} from "../lib/browser-action.js";

export async function runClickCommand(
  args: { tabRef: string; ref: string },
  deps?: BrowserActionDeps,
) {
  return runWithBrowserActionDeps(deps, (resolvedDeps) =>
    runBrowserAction(
      {
        action: "click",
        tabRef: args.tabRef,
        toolName: "browser_click",
        toolArgs: {
          ref: args.ref,
        },
      },
      resolvedDeps,
    ),
  );
}

export function parseClickCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  ref: string;
} {
  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    ref: requireCliStringArg(args, "ref", "ref"),
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runClickCommand(parseClickCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
