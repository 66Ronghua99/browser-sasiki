import test from "node:test";
import assert from "node:assert/strict";

test("browser skill ESM runtime chain imports without dist artifacts", async () => {
  const modules = await Promise.all([
    import("../../lib/types.mjs"),
    import("../../lib/paths.mjs"),
    import("../../lib/page-identity.mjs"),
    import("../../lib/snapshot-parser.mjs"),
    import("../../lib/snapshot-store.mjs"),
    import("../../lib/tab-binding-store.mjs"),
    import("../../lib/knowledge-store.mjs"),
    import("../../lib/knowledge-query.mjs"),
  ]);

  assert.equal(typeof modules[0].assertCaptureResult, "function");
  assert.equal(typeof modules[7].querySnapshotText, "function");
});
