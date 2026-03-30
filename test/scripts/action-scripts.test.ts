import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { setSessionRpcRequestSenderForTesting } from "../../lib/cli.js";
import { parseClickCliArgs, runClickCommand } from "../../scripts/click.js";
import { parseNavigateCliArgs, runNavigateCommand } from "../../scripts/navigate.js";
import { parsePressCliArgs, runPressCommand } from "../../scripts/press.js";
import { parseSelectTabCliArgs, runSelectTabCommand } from "../../scripts/select-tab.js";
import { parseTypeCliArgs, runTypeCommand } from "../../scripts/type.js";

afterEach(() => {
  setSessionRpcRequestSenderForTesting(undefined);
});

function createActionResult(action: "navigate" | "click" | "type" | "press" | "select-tab") {
  return {
    ok: true as const,
    action,
    tabRef: "tab_demo",
    page: {
      origin: "https://example.com",
      normalizedPath: action === "navigate" ? "/dashboard" : "/chat/inbox/current",
      title: "Inbox",
    },
    knowledgeHits: [],
    summary: `${action} ready`,
    snapshotPath: "/tmp/snapshot.md",
    snapshotRef: "snapshot_demo",
  };
}

test("navigate forwards the session RPC request and keeps snapshotRef first", async () => {
  const requests: Array<{ requestId: string; method: string; params: unknown }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push(request);
    return createActionResult("navigate");
  });

  const result = await runNavigateCommand({
    tabRef: "tab_demo",
    url: "https://example.com/dashboard",
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.method, "navigate");
  assert.deepEqual(requests[0]?.params, {
    tabRef: "tab_demo",
    url: "https://example.com/dashboard",
  });
  assert.deepEqual(Object.keys(result).slice(0, 4), ["ok", "snapshotRef", "snapshotPath", "tabRef"]);
  assert.equal(result.action, "navigate");
});

test("click, type, press, and select-tab forward the frozen request contract", async () => {
  const requests: Array<{ requestId: string; method: string; params: unknown }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push(request);
    switch (request.method) {
      case "click":
        return createActionResult("click");
      case "type":
        return createActionResult("type");
      case "press":
        return createActionResult("press");
      case "selectTab":
        return createActionResult("select-tab");
      default:
        throw new Error(`Unexpected method ${(request as { method: string }).method}`);
    }
  });

  const clicked = await runClickCommand({ tabRef: "tab_demo", uid: "uid-msg" });
  const typed = await runTypeCommand({ tabRef: "tab_demo", uid: "uid-input", text: "hello" });
  const pressed = await runPressCommand({ tabRef: "tab_demo", key: "Enter" });
  const selected = await runSelectTabCommand({ tabRef: "tab_demo", pageId: 1 });

  assert.deepEqual(
    requests.map((request) => request.method),
    ["click", "type", "press", "selectTab"],
  );
  assert.deepEqual(requests[0]?.params, { tabRef: "tab_demo", uid: "uid-msg" });
  assert.deepEqual(requests[1]?.params, { tabRef: "tab_demo", uid: "uid-input", text: "hello" });
  assert.deepEqual(requests[2]?.params, { tabRef: "tab_demo", key: "Enter" });
  assert.deepEqual(requests[3]?.params, { tabRef: "tab_demo", pageId: 1 });

  assert.equal(clicked.action, "click");
  assert.equal(typed.action, "type");
  assert.equal(pressed.action, "press");
  assert.equal(selected.action, "select-tab");
  assert.deepEqual(Object.keys(clicked).slice(0, 4), ["ok", "snapshotRef", "snapshotPath", "tabRef"]);
});

test("type rejects submit because the daemon-backed command still keeps the current explicit failure", async () => {
  const requests: Array<{ requestId: string; method: string; params: unknown }> = [];
  setSessionRpcRequestSenderForTesting(async (request) => {
    requests.push(request);
    return createActionResult("type");
  });

  await assert.rejects(
    () =>
      runTypeCommand({
        tabRef: "tab_demo",
        uid: "uid-input",
        text: "hello",
        submit: true,
      }),
    /submit/i,
  );
  assert.equal(requests.length, 0);
});

test("navigate, click, type, and press CLI parsing lock the new required flags while preserving documented aliases", () => {
  assert.deepEqual(parseClickCliArgs({ "tab-ref": "tab_demo", uid: "uid-msg" }), {
    tabRef: "tab_demo",
    uid: "uid-msg",
  });
  assert.deepEqual(parseClickCliArgs({ "tab-ref": "tab_demo", ref: "uid-msg" }), {
    tabRef: "tab_demo",
    uid: "uid-msg",
  });
  assert.deepEqual(
    parseTypeCliArgs({ "tab-ref": "tab_demo", uid: "uid-input", text: "hello", submit: "false" }),
    {
      tabRef: "tab_demo",
      uid: "uid-input",
      text: "hello",
      slowly: undefined,
      submit: false,
    },
  );
  assert.deepEqual(
    parseTypeCliArgs({ "tab-ref": "tab_demo", ref: "uid-input", text: "hello", submit: "false" }),
    {
      tabRef: "tab_demo",
      uid: "uid-input",
      text: "hello",
      slowly: undefined,
      submit: false,
    },
  );

  assert.throws(
    () => parseNavigateCliArgs({ url: "https://example.com" }),
    /tabRef.*--tab-ref/i,
  );
  assert.throws(
    () => parseNavigateCliArgs({ "tab-ref": "tab_demo" }),
    /url.*--url/i,
  );

  assert.throws(
    () => parseClickCliArgs({ "tab-ref": "tab_demo" }),
    /uid.*--uid/i,
  );
  assert.throws(
    () => parseClickCliArgs({ "tab-ref": "tab_demo", uid: "uid-msg", ref: "uid-other" }),
    /--uid and --ref must match/i,
  );

  assert.throws(
    () => parseTypeCliArgs({ "tab-ref": "tab_demo", uid: "uid-input" }),
    /text.*--text/i,
  );
  assert.throws(
    () => parseTypeCliArgs({ "tab-ref": "tab_demo", uid: "uid-input", ref: "uid-other", text: "hello" }),
    /--uid and --ref must match/i,
  );

  assert.throws(
    () => parsePressCliArgs({ "tab-ref": "tab_demo" }),
    /key.*--key/i,
  );
});

test("select-tab CLI parsing accepts pageId semantics and keeps --index as a legacy alias", () => {
  assert.deepEqual(
    parseSelectTabCliArgs({ "tab-ref": "tab_demo", "page-id": "2" }),
    {
      tabRef: "tab_demo",
      pageId: 2,
    },
  );

  assert.deepEqual(
    parseSelectTabCliArgs({ "tab-ref": "tab_demo", "tab-index": "1" }),
    {
      tabRef: "tab_demo",
      pageId: 1,
    },
  );

  assert.deepEqual(
    parseSelectTabCliArgs({ "tab-ref": "tab_demo", index: "3" }),
    {
      tabRef: "tab_demo",
      pageId: 3,
    },
  );

  assert.throws(
    () => parseSelectTabCliArgs({ "tab-ref": "tab_demo" }),
    /pageId.*--page-id/i,
  );

  assert.throws(
    () => parseSelectTabCliArgs({ "tab-ref": "tab_demo", "page-id": "0" }),
    /pageId/i,
  );
});
