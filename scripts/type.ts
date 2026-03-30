import process from "node:process";

import { formatCliError, isDirectCliInvocation, readCliArgs } from "../lib/cli.js";
import {
  parseCliBooleanArg,
  requireCliStringArg,
  runBrowserAction,
  runWithBrowserActionDeps,
  type BrowserActionDeps,
} from "../lib/browser-action.js";

export async function runTypeCommand(
  args: { tabRef: string; uid: string; text: string; slowly?: boolean; submit?: boolean },
  deps?: BrowserActionDeps,
) {
  if (args.submit) {
    throw new Error("type submit is unsupported: Chrome DevTools MCP requires a separate press command");
  }

  if (args.slowly) {
    throw new Error("type slowly is unsupported: Chrome DevTools MCP fill does not support slow typing");
  }

  return runWithBrowserActionDeps(deps, (resolvedDeps) =>
    runBrowserAction(
      {
        action: "type",
        tabRef: args.tabRef,
        toolName: "fill",
        toolArgs: {
          uid: args.uid,
          value: args.text,
        },
      },
      resolvedDeps,
    ),
  );
}

export function parseTypeCliArgs(args: Record<string, string | boolean>): {
  tabRef: string;
  uid: string;
  text: string;
  slowly?: boolean;
  submit?: boolean;
} {
  return {
    tabRef: requireCliStringArg(args, "tab-ref", "tabRef"),
    uid: requireCliStringArg(args, "uid", "uid"),
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
