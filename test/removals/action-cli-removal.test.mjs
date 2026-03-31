import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const removedActionScripts = ["capture", "navigate", "click", "type", "press", "select-tab"].map(
  (name) => fileURLToPath(new URL(`../../scripts/${name}.ts`, import.meta.url)),
);

test("per-command browser action CLI scripts are removed in favor of the HTTP front door", async () => {
  for (const scriptPath of removedActionScripts) {
    await assert.rejects(access(scriptPath), /ENOENT/);
  }
});
