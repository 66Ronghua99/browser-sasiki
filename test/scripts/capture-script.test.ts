import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { setSessionRpcRequestSenderForTesting } from "../../lib/cli.js";
import { parseCaptureCliArgs, runCaptureCommand } from "../../scripts/capture.js";

afterEach(() => {
  setSessionRpcRequestSenderForTesting(undefined);
});

function createCaptureResult() {
  return {
    ok: true as const,
    tabRef: "tab_demo",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current",
      title: "Inbox",
    },
    knowledgeHits: [],
    summary: "capture ready",
    snapshotPath: "/tmp/snapshot.md",
    snapshotRef: "snapshot_demo",
    tabs: [
      {
        index: 2,
        title: "Inbox",
        url: "https://example.com/chat/inbox/current",
        active: true,
      },
    ],
  };
}

test("capture forwards tab selection to the session sender and hides snapshotPath from CLI output", async () => {
  const requests: Array<{ requestId: string; method: string; params: unknown }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push(request);
    return createCaptureResult();
  });

  const result = await runCaptureCommand({ tabRef: "main", pageId: 2 });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "capture");
  assert.ok(typeof requests[0]?.requestId === "string" && String(requests[0]?.requestId).length > 0);
  assert.deepEqual(requests[0]?.params, {
    tabRef: "main",
    pageId: 2,
  });
  assert.deepEqual(Object.keys(result).slice(0, 3), ["ok", "snapshotRef", "tabRef"]);
  assert.equal(result.snapshotRef, "snapshot_demo");
  assert.equal("snapshotPath" in result, false);
  assert.equal(result.tabs[0]?.active, true);
});

test("capture CLI parsing rejects valueless optional flags and still accepts absent ones", () => {
  assert.deepEqual(parseCaptureCliArgs({}), {});

  assert.deepEqual(
    parseCaptureCliArgs({ "tab-ref": "tab_demo", "tab-index": "1" }),
    {
      tabRef: "tab_demo",
      pageId: 1,
    },
  );

  assert.throws(
    () => parseCaptureCliArgs({ "tab-ref": true }),
    /tabRef.*--tab-ref/i,
  );

  assert.throws(
    () => parseCaptureCliArgs({ "tab-index": true }),
    /pageId.*--tab-index/i,
  );
});
