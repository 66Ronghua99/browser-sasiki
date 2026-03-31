import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCaptureFlow, type BrowserRuntime } from "../../lib/browser-action.js";
import { KnowledgeStore } from "../../lib/knowledge-store.js";
import { SnapshotStore } from "../../lib/snapshot-store.js";
import { TabBindingStore } from "../../lib/tab-binding-store.js";

test("runCaptureFlow reuses the selected new_page result for a fresh workspace tab instead of re-selecting it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-capture-flow-"));
  const browserCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const newPageListText = [
    "## Pages",
    "1: https://example.com/home",
    "2: chrome://new-tab-page/ [selected]",
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
    async callBrowserTool(name: string, args: Record<string, unknown>) {
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
  } as unknown as BrowserRuntime;

  const result = await runCaptureFlow(
    { tabRef: "x-work" },
    {
      browser,
      tabBindings: new TabBindingStore(path.join(root, "tab-state")),
      snapshots: new SnapshotStore(path.join(root, "snapshots"), {
        ttlMs: 60_000,
      }),
      knowledge: new KnowledgeStore(path.join(root, "knowledge", "page-knowledge.jsonl")),
    },
  );

  assert.equal(browserCalls.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.tabRef, "x-work");
  assert.equal(result.page.title, "New Tab");
  assert.equal(result.tabs.find((tab) => tab.active)?.index, 2);
});
