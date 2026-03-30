import process from "node:process";

import { isDirectCliInvocation, readCliArgs } from "../lib/cli.js";
import {
  optionalCliStringArg,
  parseCliIntegerArg,
  runCaptureFlow,
  runWithBrowserActionDeps,
  type BrowserActionDeps,
} from "../lib/browser-action.js";

export async function runCaptureCommand(
  args: { tabIndex?: number; tabRef?: string },
  deps?: BrowserActionDeps,
) {
  return runWithBrowserActionDeps(deps, (resolvedDeps) => runCaptureFlow(args, resolvedDeps));
}

export function parseCaptureCliArgs(args: Record<string, string | boolean>): {
  tabIndex?: number;
  tabRef?: string;
} {
  const tabRef = optionalCliStringArg(args, "tab-ref", "tabRef");
  const tabIndexValue = optionalCliStringArg(args, "tab-index", "tabIndex");

  return {
    ...(tabIndexValue !== undefined
      ? { tabIndex: parseCliIntegerArg(tabIndexValue, "tabIndex") as number }
      : {}),
    ...(tabRef !== undefined ? { tabRef } : {}),
  };
}

async function main(): Promise<void> {
  const args = readCliArgs(process.argv.slice(2));
  const result = await runCaptureCommand(parseCaptureCliArgs(args));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
