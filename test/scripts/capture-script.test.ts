import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { KnowledgeStore } from "../../lib/knowledge-store.js";
import { SnapshotStore } from "../../lib/snapshot-store.js";
import { TabBindingStore } from "../../lib/tab-binding-store.js";
import { parseCaptureCliArgs, runCaptureCommand } from "../../scripts/capture.js";

class StubBrowser {
  private selectedTabIndex: number;

  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(
    private readonly tabs: Array<{
      index: number;
      title: string;
      url: string;
    }>,
    initialTabIndex: number,
  ) {
    this.selectedTabIndex = initialTabIndex;
  }

  async readActiveTabIndex(): Promise<number> {
    return this.selectedTabIndex;
  }

  async captureSnapshot(): Promise<string> {
    const activeTab = this.tabs.find((tab) => tab.index === this.selectedTabIndex);
    if (!activeTab) {
      throw new Error(`missing tab for index ${this.selectedTabIndex}`);
    }
    return [
      "### Open tabs",
      ...this.tabs.map((tab) =>
        `- ${tab.index}: ${tab.index === this.selectedTabIndex ? "(current) " : ""}[${tab.title}](${tab.url})`
      ),
      "### Page",
      `- Page URL: ${activeTab.url}`,
      `- Page Title: ${activeTab.title}`,
      "### Snapshot",
      "```yaml",
      "- button \"Customer messages\" [ref=el-msg]",
      "```",
    ].join("\n");
  }

  async callBrowserTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ text: string }> }> {
    this.calls.push({ name, args });
    if (name === "browser_tabs" && args.action === "select") {
      this.selectedTabIndex = Number(args.index);
    }
    return {
      content: [{ text: `${name} ok` }],
    };
  }
}

class BrowserTabsListFallbackStub extends StubBrowser {
  override async callBrowserTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ text: string }> }> {
    if (name === "browser_tabs" && args.action === "list") {
      return {
        content: [{ text: "tabs listed without a parseable active marker" }],
      };
    }
    return super.callBrowserTool(name, args);
  }
}

async function createHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-capture-"));
  const runtimeRoot = path.join(root, ".sasiki", "browser-skill", "tmp");
  const browser = new StubBrowser(
    [
      { index: 0, title: "Home", url: "https://example.com/home" },
      { index: 1, title: "Inbox", url: "https://example.com/chat/inbox/current" },
    ],
    1,
  );
  const tabBindings = new TabBindingStore(path.join(runtimeRoot, "tab-state"));
  const snapshots = new SnapshotStore(path.join(runtimeRoot, "snapshots"), { ttlMs: 60_000 });
  const knowledgeFile = path.join(root, "skill", "knowledge", "page-knowledge.jsonl");
  await mkdir(path.dirname(knowledgeFile), { recursive: true });
  const knowledge = new KnowledgeStore(knowledgeFile);
  await knowledge.append({
    id: "knowledge_inbox",
    page: {
      origin: "https://example.com",
      normalizedPath: "/chat/inbox/current",
    },
    guide: "Prioritize the conversation list first.",
    keywords: ["customer messages", "inbox"],
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
  });

  return {
    browser,
    tabBindings,
    snapshots,
    knowledge,
  };
}

test("capture binds the current tab and returns a tabRef plus snapshotPath", async () => {
  const harness = await createHarness();

  const result = await runCaptureCommand({ tabIndex: 1 }, harness);

  assert.equal(result.ok, true);
  assert.match(result.tabRef, /^tab_/);
  assert.match(result.snapshotPath, /browser-skill\/tmp\/snapshots/);
  assert.equal(result.page.normalizedPath, "/chat/inbox/current");
  assert.equal(result.knowledgeHits.length, 1);
  assert.equal(result.tabs.length, 2);
  assert.equal(result.tabs[1]?.active, true);

  const binding = await harness.tabBindings.read(result.tabRef);
  assert.equal(binding.browserTabIndex, 1);
  assert.equal(binding.snapshotPath, result.snapshotPath);
  assert.equal(binding.page.normalizedPath, "/chat/inbox/current");
});

test("capture accepts a fresh explicit tabRef and creates the first binding", async () => {
  const harness = await createHarness();

  const result = await runCaptureCommand({ tabRef: "main" }, harness);

  assert.equal(result.ok, true);
  assert.equal(result.tabRef, "main");
  assert.equal(result.page.normalizedPath, "/chat/inbox/current");

  const binding = await harness.tabBindings.read("main");
  assert.equal(binding.browserTabIndex, 1);
  assert.equal(binding.page.normalizedPath, "/chat/inbox/current");
});

test("capture falls back to snapshot tab inventory when browser_tabs list output is not parseable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-capture-fallback-"));
  const runtimeRoot = path.join(root, ".sasiki", "browser-skill", "tmp");
  const browser = new BrowserTabsListFallbackStub(
    [
      { index: 0, title: "Home", url: "https://example.com/home" },
      { index: 1, title: "Inbox", url: "https://example.com/chat/inbox/current" },
    ],
    1,
  );
  const tabBindings = new TabBindingStore(path.join(runtimeRoot, "tab-state"));
  const snapshots = new SnapshotStore(path.join(runtimeRoot, "snapshots"), { ttlMs: 60_000 });
  const knowledgeFile = path.join(root, "skill", "knowledge", "page-knowledge.jsonl");
  await mkdir(path.dirname(knowledgeFile), { recursive: true });
  const knowledge = new KnowledgeStore(knowledgeFile);

  const result = await runCaptureCommand({}, { browser, tabBindings, snapshots, knowledge });

  assert.equal(result.ok, true);
  assert.equal(result.page.normalizedPath, "/chat/inbox/current");
  assert.equal(result.tabs[1]?.active, true);
});

test("capture CLI parsing rejects valueless optional flags and still accepts absent ones", () => {
  assert.deepEqual(parseCaptureCliArgs({}), {});

  assert.deepEqual(
    parseCaptureCliArgs({ "tab-ref": "tab_demo", "tab-index": "1" }),
    {
      tabRef: "tab_demo",
      tabIndex: 1,
    },
  );

  assert.throws(
    () => parseCaptureCliArgs({ "tab-ref": true }),
    /tabRef.*--tab-ref/i,
  );

  assert.throws(
    () => parseCaptureCliArgs({ "tab-index": true }),
    /tabIndex.*--tab-index/i,
  );
});
