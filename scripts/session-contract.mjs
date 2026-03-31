export const SESSION_RPC_METHODS = Object.freeze([
  "health",
  "openWorkspace",
  "listTabs",
  "selectTab",
  "navigate",
  "click",
  "type",
  "press",
  "query",
  "recordKnowledge",
  "shutdown",
]);

export const SESSION_RPC_REQUEST_FIELDS = Object.freeze({
  health: [],
  openWorkspace: [],
  listTabs: ["workspaceRef"],
  selectTab: ["workspaceRef", "workspaceTabRef"],
  navigate: ["workspaceRef", "workspaceTabRef", "url"],
  click: ["workspaceRef", "workspaceTabRef", "uid"],
  type: ["workspaceRef", "workspaceTabRef", "uid", "text", "submit", "slowly"],
  press: ["workspaceRef", "workspaceTabRef", "key"],
  query: ["workspaceRef", "workspaceTabRef", "mode", "query", "role", "uid"],
  recordKnowledge: ["workspaceRef", "workspaceTabRef", "guide", "keywords", "rationale"],
  shutdown: [],
});

export function assertWorkspaceResult(value) {
  assertWorkspaceResultShape(value);
}

export function assertWorkspaceTabsResult(value) {
  assertWorkspaceResultShape(value);
  assertTabs(value.tabs);
}

export function assertWorkspaceTabResult(value) {
  assertWorkspaceResultShape(value);
  assertWorkspaceTabIdentity(value);
}

export function assertSessionRpcResult(value) {
  assertWorkspaceTabResult(value);
}

export function assertSessionWorkspaceResult(value) {
  assertWorkspaceResultShape(value);
}

function assertWorkspaceResultShape(value) {
  assertRecord(value, "result");
  if (value.ok !== true) {
    throw new TypeError("ok must be true");
  }
  assertWorkspaceIdentity(value);
  if ("snapshotPath" in value) {
    throw new TypeError("snapshotPath is not allowed");
  }
  if ("tabRef" in value) {
    throw new TypeError("tabRef is not allowed");
  }
  if ("snapshotRef" in value) {
    throw new TypeError("snapshotRef is not allowed");
  }
  if ("pageId" in value) {
    throw new TypeError("pageId is not allowed");
  }
  if (value.knowledgeRef !== undefined) {
    assertString(value.knowledgeRef, "knowledgeRef");
  }
  assertPageIdentity(value.page);
  assertKnowledgeHits(value.knowledgeHits);
  assertString(value.summary, "summary");
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
    case "openWorkspace":
    case "shutdown":
      if (Object.keys(params).length > 0) {
        throw new TypeError(`${method} params must be empty`);
      }
      return;
    case "listTabs":
      assertWorkspaceRef(params, "params");
      return;
    case "selectTab":
      assertWorkspaceRef(params, "params");
      assertRequiredWorkspaceTabRef(params, "params");
      return;
    case "navigate":
      assertWorkspaceRef(params, "params");
      assertOptionalWorkspaceTabRef(params, "params");
      assertString(params.url, "params.url");
      return;
    case "click":
      assertWorkspaceRef(params, "params");
      assertOptionalWorkspaceTabRef(params, "params");
      assertUid(params, "params");
      return;
    case "type":
      assertWorkspaceRef(params, "params");
      assertOptionalWorkspaceTabRef(params, "params");
      assertUid(params, "params");
      assertString(params.text, "params.text");
      if (params.submit !== undefined) {
        assertBoolean(params.submit, "params.submit");
      }
      if (params.slowly !== undefined) {
        assertBoolean(params.slowly, "params.slowly");
      }
      return;
    case "press":
      assertWorkspaceRef(params, "params");
      assertOptionalWorkspaceTabRef(params, "params");
      assertString(params.key, "params.key");
      return;
    case "query":
      assertWorkspaceRef(params, "params");
      assertOptionalWorkspaceTabRef(params, "params");
      if (params.mode === undefined) {
        throw new TypeError('params.mode must be search or full');
      }
      if (params.mode !== "search" && params.mode !== "full") {
        throw new TypeError('params.mode must be search or full');
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
      if (params.mode === "full" && (params.query !== undefined || params.role !== undefined || params.uid !== undefined)) {
        throw new TypeError("query full mode does not accept selector fields such as query, role, or uid");
      }
      if (params.mode === "search" && params.query === undefined && params.role === undefined && params.uid === undefined) {
        throw new TypeError("query search mode requires at least one selector: query, role, or uid");
      }
      return;
    case "recordKnowledge":
      assertWorkspaceRef(params, "params");
      assertOptionalWorkspaceTabRef(params, "params");
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
      } else {
        throw new TypeError("params.rationale must be provided");
      }
      return;
    default:
      return;
  }
}

function assertAllowedRequestFields(method, params) {
  const allowedFields = new Set(SESSION_RPC_REQUEST_FIELDS[method]);
  for (const key of Object.keys(params)) {
    if (!allowedFields.has(key)) {
      throw new TypeError(
        `${method} params contain unknown field ${key}; allowed fields: ${SESSION_RPC_REQUEST_FIELDS[method].join(", ")}`,
      );
    }
  }
}

function assertUid(params, label) {
  if (params.uid === undefined) {
    throw new TypeError(`${label} must include uid`);
  }
  assertString(params.uid, `${label}.uid`);
}

function assertWorkspaceIdentity(value, label = "workspace") {
  assertRecord(value, label);
  assertString(value.workspaceRef, `${label}.workspaceRef`);
  if (value.workspaceTabRef !== undefined) {
    assertString(value.workspaceTabRef, `${label}.workspaceTabRef`);
  }
}

function assertWorkspaceRef(value, label = "workspace") {
  assertRecord(value, label);
  assertString(value.workspaceRef, `${label}.workspaceRef`);
}

function assertRequiredWorkspaceTabRef(value, label = "workspace") {
  assertRecord(value, label);
  assertString(value.workspaceTabRef, `${label}.workspaceTabRef`);
}

function assertWorkspaceTabIdentity(value, label = "workspace") {
  assertRecord(value, label);
  assertString(value.workspaceTabRef, `${label}.workspaceTabRef`);
}

function assertOptionalWorkspaceTabRef(value, label = "workspace") {
  assertRecord(value, label);
  if (value.workspaceTabRef !== undefined) {
    assertString(value.workspaceTabRef, `${label}.workspaceTabRef`);
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
  if ("index" in tab) {
    throw new TypeError(`tabs[${index}].index is not allowed`);
  }
  assertString(tab.workspaceTabRef, `tabs[${index}].workspaceTabRef`);
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
