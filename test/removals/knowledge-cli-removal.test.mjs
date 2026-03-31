import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const removedKnowledgeScripts = ["query-snapshot", "read-knowledge", "record-knowledge"].map(
  (name) => fileURLToPath(new URL(`../../scripts/${name}.ts`, import.meta.url)),
);

test("knowledge-oriented CLI scripts are removed in favor of HTTP-only endpoints", async () => {
  for (const scriptPath of removedKnowledgeScripts) {
    await assert.rejects(access(scriptPath), /ENOENT/);
  }
});
