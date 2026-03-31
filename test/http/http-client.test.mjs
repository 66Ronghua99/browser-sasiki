import test from "node:test";
import assert from "node:assert/strict";

test("browser skill ESM runtime chain imports without dist artifacts", async () => {
  const modules = await Promise.all([
    import("../../scripts/types.mjs"),
    import("../../scripts/paths.mjs"),
    import("../../scripts/page-identity.mjs"),
    import("../../scripts/snapshot-parser.mjs"),
    import("../../scripts/snapshot-store.mjs"),
    import("../../scripts/tab-binding-store.mjs"),
    import("../../scripts/knowledge-store.mjs"),
    import("../../scripts/knowledge-query.mjs"),
  ]);

  assert.equal(typeof modules[0].assertCaptureResult, "function");
  assert.equal(typeof modules[7].querySnapshotText, "function");
});
