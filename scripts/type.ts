import process from "node:process";

import { isDirectCliInvocation, readCliArgs } from "../lib/cli.js";
import {
  parseCliBooleanArg,
  requireCliStringArg,
  runBrowserAction,
  runWithBrowserActionDeps,
  type BrowserActionDeps,
} from "../lib/browser-action.js";

export async function runTypeCommand(
  args: { tabRef: string; ref: string; text: string; slowly?: boolean; submit?: boolean },
  deps?: BrowserActionDeps,
) {
  return runWithBrowserActionDeps(deps, (resolvedDeps) =>
    runBrowserAction(
      {
        action: "type",
        tabRef: args.tabRef,
        toolName: "browser_type",
        toolArgs: {
          ref: args.ref,
          text: args.text,
          ...(args.slowly !== undefined ? { slowly: args.slowly } : {}),
          ...(args.submit !== undefined ? { submit: args.submit } : {}),
        },
      },
      resolvedDeps,
    ),
  );
}

export function parseTypeCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  ref: string;
  text: string;
  slowly?: boolean;
  submit?: boolean;
} {
  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    ref: requireCliStringArg(args, "ref", "ref"),
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
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
