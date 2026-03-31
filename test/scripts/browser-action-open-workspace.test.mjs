import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { openWorkspaceFlow } from "../../scripts/browser-action.mjs";
import { KnowledgeStore } from "../../scripts/knowledge-store.mjs";
import { SnapshotStore } from "../../scripts/snapshot-store.mjs";
import { WorkspaceBindingStore } from "../../scripts/workspace-binding-store.mjs";

test("openWorkspaceFlow reuses the selected new_page result for a fresh workspace tab instead of re-selecting it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-workspace-flow-"));
  const browserCalls = [];
  const newPageListText = [
    "## Pages",
    "- 1 [Home](https://example.com/home)",
    "- 2 [New Tab](chrome://new-tab-page/) (current)",
  ].join("\n");
  const rawSnapshotText = [
    "## Latest page snapshot",
    'uid=1_0 RootWebArea "New Tab" url="chrome://new-tab-page/"',
    '  uid=1_1 button "Search the web"',
  ].join("\n");

  const browser = {
    async captureSnapshot() {
      return rawSnapshotText;
    },
    async callBrowserTool(name, args) {
      browserCalls.push({ name, args });
      return {
        isError: true,
        content: [{ type: "text", text: "No page found" }],
      };
    },
    async readActiveTabIndex() {
      return 2;
    },
    async openWorkspaceTab() {
      return {
        pageId: 2,
        pageListText: newPageListText,
      };
    },
  };

  const result = await openWorkspaceFlow(
    { workspaceRef: "x-work" },
    {
      browser,
      workspaceBindings: new WorkspaceBindingStore(path.join(root, "workspace-bindings")),
      snapshots: new SnapshotStore(path.join(root, "snapshots"), {
        ttlMs: 60_000,
      }),
      knowledge: new KnowledgeStore(path.join(root, "knowledge", "page-knowledge.jsonl")),
    },
  );

  assert.equal(browserCalls.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.workspaceRef, "x-work");
  assert.equal(result.tabRef, undefined);
  assert.equal(result.page.title, "New Tab");
  assert.equal(result.tabs.find((tab) => tab.active)?.index, 2);
});
