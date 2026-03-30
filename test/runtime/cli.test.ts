import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { formatCliError, isDirectCliInvocation, readCliArgs } from "../../lib/cli.js";

test("readCliArgs parses key-value pairs and bare flags", () => {
  assert.deepEqual(readCliArgs(["--tab-ref", "main", "--submit"]), {
    "tab-ref": "main",
    submit: true,
  });
});

test("isDirectCliInvocation treats symlinked argv1 as the same entry file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-cli-"));
  const realDir = path.join(root, "real");
  const linkDir = path.join(root, "link");
  const realFile = path.join(realDir, "capture.js");
  const linkedFile = path.join(linkDir, "capture.js");

  await mkdir(realDir, { recursive: true });
  await writeFile(realFile, "export {};\n", "utf8");
  await symlink(realDir, linkDir);

  assert.equal(isDirectCliInvocation(pathToFileURL(realFile).href, linkedFile), true);
});

test("isDirectCliInvocation returns false when argv1 targets a different file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-cli-"));
  const one = path.join(root, "one.js");
  const two = path.join(root, "two.js");

  await writeFile(one, "export {};\n", "utf8");
  await writeFile(two, "export {};\n", "utf8");

  assert.equal(isDirectCliInvocation(pathToFileURL(one).href, two), false);
  assert.equal(isDirectCliInvocation(pathToFileURL(one).href, undefined), false);
});

test("formatCliError prefers readable messages over stack traces", () => {
  const error = new Error("human-friendly failure");
  error.stack = "Error: human-friendly failure\n    at noisy-stack";

  assert.equal(formatCliError(error), "human-friendly failure");
  assert.equal(formatCliError("plain failure"), "plain failure");
});
