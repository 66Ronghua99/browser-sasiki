import type { KnowledgeHit, SkillPageIdentity, SkillTabInventoryItem } from "../lib/types.js";

export const SESSION_RPC_METHODS = [
  "health",
  "capture",
  "navigate",
  "click",
  "type",
  "press",
  "selectTab",
  "querySnapshot",
  "readKnowledge",
  "recordKnowledge",
  "shutdown",
] as const;

export type SessionRpcMethod = (typeof SESSION_RPC_METHODS)[number];

export const SESSION_RPC_REQUEST_FIELDS = {
  health: [],
  capture: ["tabRef", "tabIndex"],
  navigate: ["tabRef", "url"],
  click: ["tabRef", "uid"],
  type: ["tabRef", "uid", "text"],
  press: ["tabRef", "key"],
  selectTab: ["tabRef", "pageId"],
  querySnapshot: ["tabRef", "snapshotRef", "snapshotPath", "mode", "query", "role", "uid", "includeSnapshot"],
  readKnowledge: ["tabRef", "snapshotRef", "snapshotPath", "knowledgeRef", "page"],
  recordKnowledge: ["tabRef", "snapshotRef", "snapshotPath", "page", "guide", "keywords", "rationale", "knowledgeRef"],
  shutdown: [],
} as const satisfies Record<SessionRpcMethod, readonly string[]>;

export interface SessionRpcRequestMap {
  health: Record<string, never>;
  capture: {
    tabRef?: string;
    tabIndex?: number;
  };
  navigate: {
    tabRef: string;
    url: string;
  };
  click: {
    tabRef: string;
    uid: string;
  };
  type: {
    tabRef: string;
    uid: string;
    text: string;
    submit?: boolean;
    slowly?: boolean;
  };
  press: {
    tabRef: string;
    key: string;
  };
  selectTab: {
    tabRef: string;
    pageId: number;
  };
  querySnapshot: {
    tabRef?: string;
    snapshotRef?: string;
    snapshotPath?: string;
    mode?: "search" | "auto" | "full";
    query?: string;
    role?: string;
    uid?: string;
    includeSnapshot?: boolean;
  };
  readKnowledge: {
    tabRef?: string;
    snapshotRef?: string;
    snapshotPath?: string;
    knowledgeRef?: string;
    page?: SkillPageIdentity;
  };
  recordKnowledge: {
    tabRef?: string;
    snapshotRef?: string;
    snapshotPath?: string;
    page: SkillPageIdentity;
    guide: string;
    keywords: string[];
    rationale?: string;
    knowledgeRef?: string;
  };
  shutdown: Record<string, never>;
}

export interface SessionRpcRequestEnvelope<M extends SessionRpcMethod = SessionRpcMethod> {
  requestId: string;
  method: M;
  params: SessionRpcRequestMap[M];
}

export interface SessionRuntimeRef {
  snapshotRef: string;
  snapshotPath: string;
  knowledgeRef?: string;
}

export interface SessionRpcResultBase extends SessionRuntimeRef {
  ok: true;
  tabRef: string;
  page: SkillPageIdentity;
  knowledgeHits: KnowledgeHit[];
  summary: string;
}

export interface SessionCaptureResult extends SessionRpcResultBase {
  tabs: SkillTabInventoryItem[];
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
}

function assertInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer`);
  }
}

function assertPageIdentity(page: unknown): asserts page is SkillPageIdentity {
  assertRecord(page, "page");
  assertString(page.origin, "page.origin");
  assertString(page.normalizedPath, "page.normalizedPath");
  assertString(page.title, "page.title");
}

function assertKnowledgeHits(value: unknown): asserts value is KnowledgeHit[] {
  if (!Array.isArray(value)) {
    throw new TypeError("knowledgeHits must be an array");
  }

  for (const [index, hit] of value.entries()) {
    assertRecord(hit, `knowledgeHits[${index}]`);
    assertString(hit.guide, `knowledgeHits[${index}].guide`);
    if (!Array.isArray(hit.keywords)) {
      throw new TypeError(`knowledgeHits[${index}].keywords must be an array`);
    }
    for (const [keywordIndex, keyword] of hit.keywords.entries()) {
      assertString(keyword, `knowledgeHits[${index}].keywords[${keywordIndex}]`);
    }
    if (hit.rationale !== undefined) {
      assertString(hit.rationale, `knowledgeHits[${index}].rationale`);
    }
  }
}

function assertTabInventoryItem(tab: unknown, index: number): asserts tab is SkillTabInventoryItem {
  assertRecord(tab, `tabs[${index}]`);
  assertInteger(tab.index, `tabs[${index}].index`);
  if (tab.index < 0) {
    throw new TypeError(`tabs[${index}].index must be non-negative`);
  }
  assertString(tab.title, `tabs[${index}].title`);
  assertString(tab.url, `tabs[${index}].url`);
  assertBoolean(tab.active, `tabs[${index}].active`);
}

function assertTabs(value: unknown): asserts value is SkillTabInventoryItem[] {
  if (!Array.isArray(value)) {
    throw new TypeError("tabs must be an array");
  }
  value.forEach((tab, index) => assertTabInventoryItem(tab, index));
}

function assertSessionRuntimeRef(value: unknown): asserts value is SessionRuntimeRef {
  assertRecord(value, "result");
  assertString(value.snapshotRef, "snapshotRef");
  assertString(value.snapshotPath, "snapshotPath");
  if (value.knowledgeRef !== undefined) {
    assertString(value.knowledgeRef, "knowledgeRef");
  }
}

export function assertSessionRpcResult(value: unknown): asserts value is SessionRpcResultBase {
  assertSessionRuntimeRef(value);
  if ((value as SessionRpcResultBase).ok !== true) {
    throw new TypeError("ok must be true");
  }
  assertString((value as SessionRpcResultBase).tabRef, "tabRef");
  assertPageIdentity((value as SessionRpcResultBase).page);
  assertKnowledgeHits((value as SessionRpcResultBase).knowledgeHits);
  assertString((value as SessionRpcResultBase).summary, "summary");
}

export function assertSessionCaptureResult(value: unknown): asserts value is SessionCaptureResult {
  assertSessionRpcResult(value);
  assertTabs((value as SessionCaptureResult).tabs);
}

function assertSessionPageIdentity(value: unknown, label: string): asserts value is SkillPageIdentity {
  assertRecord(value, label);
  assertString(value.origin, `${label}.origin`);
  assertString(value.normalizedPath, `${label}.normalizedPath`);
  assertString(value.title, `${label}.title`);
}

function assertSessionRpcParams(method: SessionRpcMethod, params: unknown): asserts params is SessionRpcRequestMap[SessionRpcMethod] {
  assertRecord(params, "params");

  switch (method) {
    case "health":
    case "shutdown":
      if (Object.keys(params).length > 0) {
        throw new TypeError(`${method} params must be empty`);
      }
      return;
    case "capture":
      if (params.tabRef !== undefined) {
        assertString(params.tabRef, "params.tabRef");
      }
      if (params.tabIndex !== undefined) {
        assertInteger(params.tabIndex, "params.tabIndex");
      }
      return;
    case "navigate":
    case "click":
    case "press":
    case "selectTab":
      assertString(params.tabRef, "params.tabRef");
      if (method === "navigate") {
        assertString(params.url, "params.url");
      } else if (method === "click") {
        assertString(params.uid, "params.uid");
      } else if (method === "press") {
        assertString(params.key, "params.key");
      } else if (method === "selectTab") {
        assertInteger(params.pageId, "params.pageId");
      }
      return;
    case "type":
      assertString(params.tabRef, "params.tabRef");
      assertString(params.uid, "params.uid");
      assertString(params.text, "params.text");
      if (params.submit !== undefined) {
        assertBoolean(params.submit, "params.submit");
      }
      if (params.slowly !== undefined) {
        assertBoolean(params.slowly, "params.slowly");
      }
      return;
    case "querySnapshot":
      if (params.tabRef === undefined && params.snapshotRef === undefined && params.snapshotPath === undefined) {
        throw new TypeError("querySnapshot params must include tabRef, snapshotRef, or snapshotPath");
      }
      if (params.tabRef !== undefined) {
        assertString(params.tabRef, "params.tabRef");
      }
      if (params.snapshotRef !== undefined) {
        assertString(params.snapshotRef, "params.snapshotRef");
      }
      if (params.snapshotPath !== undefined) {
        assertString(params.snapshotPath, "params.snapshotPath");
      }
      if (params.mode !== undefined && params.mode !== "search" && params.mode !== "auto" && params.mode !== "full") {
        throw new TypeError("params.mode must be search, auto, or full");
      }
      if (params.query !== undefined) {
        assertString(params.query, "params.query");
      }
      if (params.role !== undefined) {
        assertString(params.role, "params.role");
      }
      if (params.uid !== undefined) {
        assertString(params.uid, "params.uid");
      }
      if (params.includeSnapshot !== undefined) {
        assertBoolean(params.includeSnapshot, "params.includeSnapshot");
      }
      return;
    case "readKnowledge":
      if (params.tabRef === undefined && params.snapshotRef === undefined && params.snapshotPath === undefined && params.knowledgeRef === undefined && params.page === undefined) {
        throw new TypeError("readKnowledge params must include a lookup hint");
      }
      if (params.tabRef !== undefined) {
        assertString(params.tabRef, "params.tabRef");
      }
      if (params.snapshotRef !== undefined) {
        assertString(params.snapshotRef, "params.snapshotRef");
      }
      if (params.snapshotPath !== undefined) {
        assertString(params.snapshotPath, "params.snapshotPath");
      }
      if (params.knowledgeRef !== undefined) {
        assertString(params.knowledgeRef, "params.knowledgeRef");
      }
      if (params.page !== undefined) {
        assertSessionPageIdentity(params.page, "params.page");
      }
      return;
    case "recordKnowledge":
      if (params.tabRef !== undefined) {
        assertString(params.tabRef, "params.tabRef");
      }
      if (params.snapshotRef !== undefined) {
        assertString(params.snapshotRef, "params.snapshotRef");
      }
      if (params.snapshotPath !== undefined) {
        assertString(params.snapshotPath, "params.snapshotPath");
      }
      assertSessionPageIdentity(params.page, "params.page");
      assertString(params.guide, "params.guide");
      if (!Array.isArray(params.keywords)) {
        throw new TypeError("params.keywords must be an array");
      }
      if (params.keywords.length === 0) {
        throw new TypeError("params.keywords must not be empty");
      }
      for (const [index, keyword] of params.keywords.entries()) {
        assertString(keyword, `params.keywords[${index}]`);
      }
      if (params.rationale !== undefined) {
        assertString(params.rationale, "params.rationale");
      }
      if (params.knowledgeRef !== undefined) {
        assertString(params.knowledgeRef, "params.knowledgeRef");
      }
  }
}

export function assertSessionRpcRequest(value: unknown): asserts value is SessionRpcRequestEnvelope {
  assertRecord(value, "request");
  assertString(value.requestId, "requestId");
  if (!SESSION_RPC_METHODS.includes(value.method as SessionRpcMethod)) {
    throw new TypeError("method must be a supported session rpc method");
  }
  assertSessionRpcParams(value.method as SessionRpcMethod, value.params);
}
