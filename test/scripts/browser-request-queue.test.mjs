import assert from "node:assert/strict";
import test from "node:test";

import { BrowserRequestQueue } from "../../scripts/browser-request-queue.mjs";

test("browser request queue runs one workspace-scoped request at a time", async () => {
  const events = [];
  let releaseFirst;
  const gate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const queue = new BrowserRequestQueue();

  const first = queue.run("click", async () => {
    events.push("first:start");
    await gate;
    events.push("first:end");
    return "first";
  });
  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);

  const second = queue.run("query", async () => {
    events.push("second:start");
    events.push("second:end");
    return "second";
  });

  releaseFirst();
  const results = await Promise.all([first, second]);

  assert.deepEqual(results, ["first", "second"]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});
