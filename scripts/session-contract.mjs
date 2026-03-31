export const SESSION_RPC_METHODS = Object.freeze([
  "health",
  "capture",
  "navigate",
  "click",
  "type",
  "press",
  "selectTab",
  "querySnapshot",
  "recordKnowledge",
  "shutdown",
]);

export const SESSION_RPC_REQUEST_FIELDS = Object.freeze({
  health: [],
  capture: ["tabRef", "pageId"],
  navigate: ["tabRef", "url"],
  click: ["tabRef", "uid"],
  type: ["tabRef", "uid", "text", "submit", "slowly"],
  press: ["tabRef", "key"],
  selectTab: ["tabRef", "pageId"],
  querySnapshot: ["tabRef", "snapshotRef", "mode", "query", "role", "uid"],
  recordKnowledge: ["tabRef", "snapshotRef", "page", "guide", "keywords", "rationale", "knowledgeRef"],
  shutdown: [],
});

export function assertSessionRpcResult(value) {
  assertSessionRuntimeRef(value);
  if (value.ok !== true) {
    throw new TypeError("ok must be true");
  }
  assertString(value.tabRef, "tabRef");
  assertPageIdentity(value.page);
  assertKnowledgeHits(value.knowledgeHits);
  assertString(value.summary, "summary");
}

export function assertSessionCaptureResult(value) {
  assertSessionRpcResult(value);
  assertTabs(value.tabs);
}

export function assertSessionRpcRequest(value) {
  assertRecord(value, "request");
  assertString(value.requestId, "requestId");
  if (!SESSION_RPC_METHODS.includes(value.method)) {
    throw new TypeError("method must be a supported session rpc method");
  }
  assertSessionRpcParams(value.method, value.params);
}

function assertSessionRpcParams(method, params) {
  assertRecord(params, "params");
  assertAllowedRequestFields(method, params);

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
      if (params.pageId !== undefined) {
        assertInteger(params.pageId, "params.pageId");
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
      } else {
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
      if (params.tabRef === undefined && params.snapshotRef === undefined) {
        throw new TypeError("querySnapshot params must include tabRef or snapshotRef");
      }
      if (params.tabRef !== undefined) {
        assertString(params.tabRef, "params.tabRef");
      }
      if (params.snapshotRef !== undefined) {
        assertString(params.snapshotRef, "params.snapshotRef");
      }
      if (params.mode !== undefined && params.mode !== "search" && params.mode !== "auto" && params.mode !== "full") {
        throw new TypeError('params.mode must be search, auto, or full');
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
      return;
    case "recordKnowledge":
      if (params.tabRef !== undefined) {
        assertString(params.tabRef, "params.tabRef");
      }
      if (params.snapshotRef !== undefined) {
        assertString(params.snapshotRef, "params.snapshotRef");
      }
      if (params.page !== undefined) {
        assertSessionPageIdentity(params.page, "params.page");
      } else if (params.tabRef === undefined && params.snapshotRef === undefined) {
        throw new TypeError("recordKnowledge params must include page, tabRef, or snapshotRef");
      }
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

function assertAllowedRequestFields(method, params) {
  const allowedFields = new Set(SESSION_RPC_REQUEST_FIELDS[method]);
  for (const key of Object.keys(params)) {
    if (!allowedFields.has(key)) {
      throw new TypeError(`${method} params contain unknown field ${key}`);
    }
  }
}

function assertSessionRuntimeRef(value) {
  assertRecord(value, "result");
  if ("snapshotPath" in value) {
    throw new TypeError("snapshotPath is not allowed");
  }
  assertString(value.snapshotRef, "snapshotRef");
  if (value.knowledgeRef !== undefined) {
    assertString(value.knowledgeRef, "knowledgeRef");
  }
}

function assertSessionPageIdentity(value, label) {
  assertRecord(value, label);
  assertString(value.origin, `${label}.origin`);
  assertString(value.normalizedPath, `${label}.normalizedPath`);
  assertString(value.title, `${label}.title`);
}

function assertPageIdentity(page) {
  assertRecord(page, "page");
  assertString(page.origin, "page.origin");
  assertString(page.normalizedPath, "page.normalizedPath");
  assertString(page.title, "page.title");
}

function assertKnowledgeHits(value) {
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

function assertTabInventoryItem(tab, index) {
  assertRecord(tab, `tabs[${index}]`);
  assertInteger(tab.index, `tabs[${index}].index`);
  if (tab.index < 0) {
    throw new TypeError(`tabs[${index}].index must be non-negative`);
  }
  assertString(tab.title, `tabs[${index}].title`);
  assertString(tab.url, `tabs[${index}].url`);
  assertBoolean(tab.active, `tabs[${index}].active`);
}

function assertTabs(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("tabs must be an array");
  }
  value.forEach((tab, index) => assertTabInventoryItem(tab, index));
}

function assertRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
}

function assertInteger(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer`);
  }
}
