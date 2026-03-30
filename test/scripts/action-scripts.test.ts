import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { callToolWithLegacyFallback } from "../../lib/browser-action.js";
import { KnowledgeStore } from "../../lib/knowledge-store.js";
import { SnapshotStore } from "../../lib/snapshot-store.js";
import { TabBindingStore } from "../../lib/tab-binding-store.js";
import { runCaptureCommand } from "../../scripts/capture.js";
import { parseClickCliArgs, runClickCommand } from "../../scripts/click.js";
import { parseNavigateCliArgs, runNavigateCommand } from "../../scripts/navigate.js";
import { parsePressCliArgs, runPressCommand } from "../../scripts/press.js";
import { parseSelectTabCliArgs, runSelectTabCommand } from "../../scripts/select-tab.js";
import { parseTypeCliArgs, runTypeCommand } from "../../scripts/type.js";

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
      "- button \"Open conversation\" [ref=el-open-tab]",
      "- textbox \"Search\" [ref=el-input]",
      "```",
    ].join("\n");
  }

  async callBrowserTool(name: string, args: Record<string, unknown>): Promise<{ content: Array<{ text: string }> }> {
    this.calls.push({ name, args });
    if (name === "browser_tabs" && args.action === "select") {
      this.selectedTabIndex = Number(args.index);
    }
    if (name === "browser_navigate" && typeof args.url === "string") {
      const activeTab = this.tabs.find((tab) => tab.index === this.selectedTabIndex);
      if (activeTab) {
        activeTab.url = args.url;
        activeTab.title = new URL(args.url).pathname === "/chat/inbox/current" ? "Inbox" : "Page";
      }
    }
    if (name === "browser_click" && args.ref === "el-open-tab") {
      this.selectedTabIndex = 2;
    }
    return {
      content: [{ text: `${name} ok` }],
    };
  }
}

async function createHarness() {
  const root = await mkdtemp(path.join(os.tmpdir(), "browser-skill-actions-"));
  const runtimeRoot = path.join(root, ".sasiki", "browser-skill", "tmp");
  const browser = new StubBrowser(
    [
      { index: 0, title: "Home", url: "https://example.com/home" },
      { index: 1, title: "Inbox", url: "https://example.com/chat/inbox/current" },
      { index: 2, title: "Conversation", url: "https://example.com/chat/thread/42" },
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
    guide: "Check the inbox surface before deeper navigation.",
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

test("navigate requires a tabRef and refreshes the bound snapshot", async () => {
  const harness = await createHarness();
  const capture = await runCaptureCommand({}, harness);

  const result = await runNavigateCommand(
    { tabRef: capture.tabRef, url: "https://example.com/chat/inbox/current" },
    harness,
  );

  assert.equal(result.action, "navigate");
  assert.equal(result.tabRef, capture.tabRef);
  assert.equal(result.page.normalizedPath, "/chat/inbox/current");
  assert.notEqual(result.snapshotPath, capture.snapshotPath);
  assert.equal(result.knowledgeHits.length, 1);

  const binding = await harness.tabBindings.read(capture.tabRef);
  assert.equal(binding.snapshotPath, result.snapshotPath);
  assert.equal(binding.page.normalizedPath, "/chat/inbox/current");
});

test("click rejects missing tabRef instead of falling back to the active tab", async () => {
  const harness = await createHarness();

  await assert.rejects(
    () => runClickCommand({ ref: "el-msg" } as unknown as { tabRef: string; ref: string }, harness),
    /tabRef/,
  );
});

test("click, type, and press return compact action results for the bound tab", async () => {
  const harness = await createHarness();
  const capture = await runCaptureCommand({}, harness);

  const clicked = await runClickCommand({ tabRef: capture.tabRef, ref: "el-msg" }, harness);
  const typed = await runTypeCommand({ tabRef: capture.tabRef, ref: "el-input", text: "hello" }, harness);
  const pressed = await runPressCommand({ tabRef: capture.tabRef, key: "Enter" }, harness);

  assert.equal(clicked.action, "click");
  assert.equal(typed.action, "type");
  assert.equal(pressed.action, "press");
  assert.equal(clicked.tabRef, capture.tabRef);
  assert.equal(typed.tabRef, capture.tabRef);
  assert.equal(pressed.tabRef, capture.tabRef);
  assert.ok(typed.snapshotPath.length > 0);
  assert.ok(pressed.snapshotPath.length > 0);
});

test("select-tab updates the bound tab index before refreshing the snapshot", async () => {
  const harness = await createHarness();
  const capture = await runCaptureCommand({}, harness);

  const result = await runSelectTabCommand({ tabRef: capture.tabRef, tabIndex: 0 }, harness);

  assert.equal(result.action, "select-tab");
  assert.equal(result.page.normalizedPath, "/home");

  const binding = await harness.tabBindings.read(capture.tabRef);
  assert.equal(binding.browserTabIndex, 0);
  assert.equal(binding.page.normalizedPath, "/home");
});

test("click keeps the persisted binding aligned when the mutation opens a new active tab", async () => {
  const harness = await createHarness();
  const capture = await runCaptureCommand({}, harness);

  const result = await runClickCommand({ tabRef: capture.tabRef, ref: "el-open-tab" }, harness);

  assert.equal(result.action, "click");
  assert.equal(result.page.normalizedPath, "/chat/thread/42");
  assert.equal(result.tabRef, capture.tabRef);

  const binding = await harness.tabBindings.read(capture.tabRef);
  assert.equal(binding.browserTabIndex, 2);
  assert.equal(binding.page.normalizedPath, "/chat/thread/42");
});

test("navigate, click, type, and press CLI parsing fail fast on missing required flags", () => {
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
    /ref.*--ref/i,
  );

  assert.throws(
    () => parseTypeCliArgs({ "tab-ref": "tab_demo", ref: "el-input" }),
    /text.*--text/i,
  );

  assert.throws(
    () => parsePressCliArgs({ "tab-ref": "tab_demo" }),
    /key.*--key/i,
  );
});

test("select-tab CLI parsing accepts documented --index and rejects missing or invalid tab index", () => {
  assert.deepEqual(
    parseSelectTabCliArgs({ "tab-ref": "tab_demo", index: "2" }),
    {
      tabRef: "tab_demo",
      tabIndex: 2,
    },
  );

  assert.deepEqual(
    parseSelectTabCliArgs({ "tab-ref": "tab_demo", "tab-index": "1" }),
    {
      tabRef: "tab_demo",
      tabIndex: 1,
    },
  );

  assert.throws(
    () => parseSelectTabCliArgs({ "tab-ref": "tab_demo" }),
    /index.*--index/i,
  );

  assert.throws(
    () => parseSelectTabCliArgs({ "tab-ref": "tab_demo", index: "-1" }),
    /index/i,
  );
});

test("legacy callTool fallback only retries signature-mismatch failures", async () => {
  const signatureMismatchCalls: Array<{ mode: string; args: unknown[] }> = [];
  const signatureMismatchSession = {
    async callTool(...args: unknown[]) {
      signatureMismatchCalls.push({
        mode: typeof args[0] === "string" ? "legacy" : "object",
        args,
      });
      if (typeof args[0] === "string") {
        return { content: [{ text: "legacy ok" }] };
      }
      throw new TypeError("callTool expects a tool name and arguments");
    },
  };

  const signatureMismatchResult = await callToolWithLegacyFallback(
    signatureMismatchSession,
    "browser_click",
    { ref: "el-msg" },
  );

  assert.equal((signatureMismatchResult.content as Array<{ text: string }>)[0]?.text, "legacy ok");
  assert.deepEqual(
    signatureMismatchCalls.map((call) => call.mode),
    ["object", "legacy"],
  );

  const duplicateRiskCalls: Array<{ mode: string; args: unknown[] }> = [];
  const duplicateRiskSession = {
    async callTool(...args: unknown[]) {
      duplicateRiskCalls.push({
        mode: typeof args[0] === "string" ? "legacy" : "object",
        args,
      });
      throw new Error("browser click failed after execution");
    },
  };

  await assert.rejects(
    () => callToolWithLegacyFallback(duplicateRiskSession, "browser_click", { ref: "el-msg" }),
    /after execution/i,
  );
  assert.deepEqual(
    duplicateRiskCalls.map((call) => call.mode),
    ["object"],
  );
});
