import process from "node:process";

import { readCliArgs } from "../lib/cli.js";
import {
  requireCliStringArg,
  runBrowserAction,
  runWithBrowserActionDeps,
  type BrowserActionDeps,
} from "../lib/browser-action.js";

export async function runPressCommand(
  args: { tabRef: string; key: string },
  deps?: BrowserActionDeps,
) {
  return runWithBrowserActionDeps(deps, (resolvedDeps) =>
    runBrowserAction(
      {
        action: "press",
        tabRef: args.tabRef,
        toolName: "browser_press_key",
        toolArgs: {
          key: args.key,
        },
      },
      resolvedDeps,
    ),
  );
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

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
