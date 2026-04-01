import assert from "node:assert/strict";
import test from "node:test";

import { appendBrowserDebugLog } from "../../scripts/browser-debug-log.mjs";

test("appendBrowserDebugLog is best-effort when the configured log path is not writable", async () => {
  await assert.doesNotReject(
    appendBrowserDebugLog(
      "workspace-transaction:start",
      { workspaceRef: "workspace_main" },
      {
        env: {
          SASIKI_BROWSER_DEBUG_LOG: "1",
          SASIKI_BROWSER_DEBUG_LOG_PATH: "/dev/null/browser-sessiond.log",
        },
      },
    ),
  );
});
