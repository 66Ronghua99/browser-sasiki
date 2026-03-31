const ACTIVE_ENDPOINT_DEFINITIONS = [
  { name: "health", method: "GET", path: "/health", bodyFields: [], queryFields: [] },
  { name: "workspaces", method: "POST", path: "/workspaces", bodyFields: [], queryFields: [] },
  { name: "tabs", method: "GET", path: "/tabs", bodyFields: [], queryFields: ["workspaceRef"] },
  { name: "selectTab", method: "POST", path: "/select-tab", bodyFields: [], queryFields: ["workspaceRef", "workspaceTabRef"] },
  { name: "navigate", method: "POST", path: "/navigate", bodyFields: ["url"], queryFields: ["workspaceRef", "workspaceTabRef"] },
  { name: "click", method: "POST", path: "/click", bodyFields: ["uid"], queryFields: ["workspaceRef", "workspaceTabRef"] },
  { name: "type", method: "POST", path: "/type", bodyFields: ["uid", "text", "submit", "slowly"], queryFields: ["workspaceRef", "workspaceTabRef"] },
  { name: "press", method: "POST", path: "/press", bodyFields: ["key"], queryFields: ["workspaceRef", "workspaceTabRef"] },
  { name: "query", method: "POST", path: "/query", bodyFields: ["mode", "query", "role", "uid"], queryFields: ["workspaceRef", "workspaceTabRef"] },
  { name: "recordKnowledge", method: "POST", path: "/record-knowledge", bodyFields: ["guide", "keywords", "rationale"], queryFields: ["workspaceRef", "workspaceTabRef"] },
  { name: "shutdown", method: "POST", path: "/shutdown", bodyFields: [], queryFields: [] },
];

export const HTTP_ENDPOINT_NAMES = Object.freeze(ACTIVE_ENDPOINT_DEFINITIONS.map((definition) => definition.name));

export const HTTP_ENDPOINTS = Object.freeze(
  Object.fromEntries(
    ACTIVE_ENDPOINT_DEFINITIONS.map((definition) => [
      definition.name,
      Object.freeze({
        method: definition.method,
        path: definition.path,
      }),
    ]),
  ),
);

export const HTTP_PATH_TO_ENDPOINT = Object.freeze(
  Object.fromEntries(
    ACTIVE_ENDPOINT_DEFINITIONS.map((definition) => [definition.path, definition.name]),
  ),
);

export const HTTP_REQUEST_FIELDS = Object.freeze(
  Object.fromEntries(
    ACTIVE_ENDPOINT_DEFINITIONS.map((definition) => [definition.name, Object.freeze([...definition.bodyFields])]),
  ),
);

export const HTTP_REQUEST_QUERY_FIELDS = Object.freeze(
  Object.fromEntries(
    ACTIVE_ENDPOINT_DEFINITIONS.map((definition) => [definition.name, Object.freeze([...definition.queryFields])]),
  ),
);

export const HTTP_REQUIRED_QUERY_FIELDS = Object.freeze({
  tabs: ["workspaceRef"],
  selectTab: ["workspaceRef", "workspaceTabRef"],
  navigate: ["workspaceRef"],
  click: ["workspaceRef"],
  type: ["workspaceRef"],
  press: ["workspaceRef"],
  query: ["workspaceRef"],
  recordKnowledge: ["workspaceRef"],
});

export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.expose = options.expose ?? true;
    this.details = options.details;
  }
}

export function resolveHttpEndpoint(pathname) {
  return HTTP_PATH_TO_ENDPOINT[pathname] ?? null;
}

export function assertHttpRequestBody(endpoint, body) {
  if (!HTTP_ENDPOINTS[endpoint]) {
    throw new TypeError(`unknown endpoint "${endpoint}"`);
  }

  assertPlainObject(body, "body");
  assertAllowedFields(endpoint, body);

  switch (endpoint) {
    case "health":
    case "workspaces":
    case "tabs":
    case "selectTab":
    case "shutdown":
      assertEmptyObject(body, endpoint);
      return;
    case "navigate":
      assertNonEmptyString(body.url, "body.url");
      return;
    case "click":
      assertUid(body, "body");
      return;
    case "type":
      assertUid(body, "body");
      assertNonEmptyString(body.text, "body.text");
      if (body.submit !== undefined) {
        assertBoolean(body.submit, "body.submit");
      }
      if (body.slowly !== undefined) {
        assertBoolean(body.slowly, "body.slowly");
      }
      return;
    case "press":
      assertNonEmptyString(body.key, "body.key");
      return;
    case "query":
      if (body.mode === undefined) {
        throw new TypeError('body.mode must be one of "search" or "full"');
      }
      if (!["search", "full"].includes(body.mode)) {
        throw new TypeError('body.mode must be one of "search" or "full"');
      }
      if (body.query !== undefined) {
        assertNonEmptyString(body.query, "body.query");
      }
      if (body.role !== undefined) {
        assertNonEmptyString(body.role, "body.role");
      }
      if (body.uid !== undefined) {
        assertNonEmptyString(body.uid, "body.uid");
      }
      if (body.mode === "full" && (body.query !== undefined || body.role !== undefined || body.uid !== undefined)) {
        throw new TypeError('query body in full mode does not accept selector fields such as query, role, or uid');
      }
      if (body.mode === "search" && body.query === undefined && body.role === undefined && body.uid === undefined) {
        throw new TypeError('query body in search mode requires at least one selector: query, role, or uid');
      }
      return;
    case "recordKnowledge":
      if (body.guide === undefined) {
        throw new TypeError("recordKnowledge body must include guide");
      }
      if (body.keywords === undefined) {
        throw new TypeError("recordKnowledge body must include keywords");
      }
      if (body.rationale === undefined) {
        throw new TypeError("recordKnowledge body must include rationale");
      }
      assertNonEmptyString(body.guide, "body.guide");
      assertNonEmptyStringArray(body.keywords, "body.keywords");
      assertNonEmptyString(body.rationale, "body.rationale");
      return;
    default:
      throw new TypeError(`unsupported endpoint "${endpoint}"`);
  }
}

export function shapeHttpPublicResult(value) {
  return cloneAndStripPublicRuntimeFields(value);
}

export function shapeHttpPublicResultForEndpoint(endpoint, value) {
  const rules = resolvePublicResultRules(endpoint);
  if (rules === null) {
    return cloneAndStripPublicRuntimeFields(value);
  }

  assertPublicWorkspaceResult(value, rules, endpoint);
  return cloneAndStripPublicRuntimeFields(value);
}

function assertAllowedFields(endpoint, body) {
  const allowed = new Set(HTTP_REQUEST_FIELDS[endpoint] ?? []);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `unknown field "${key}" for ${endpoint}; allowed fields: ${HTTP_REQUEST_FIELDS[endpoint].join(", ")}`,
      );
    }
  }
}

function assertUid(body, label) {
  if (body.uid === undefined) {
    throw new TypeError(`${label} must include uid`);
  }
  assertNonEmptyString(body.uid, `${label}.uid`);
}

function assertPlainObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertEmptyObject(value, label) {
  if (Object.keys(value).length > 0) {
    throw new TypeError(`${label} body must be empty`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} must be a boolean`);
  }
}

function assertNonEmptyStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }

  for (const [index, entry] of value.entries()) {
    assertNonEmptyString(entry, `${label}[${index}]`);
  }
}

function cloneAndStripPublicRuntimeFields(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneAndStripPublicRuntimeFields(entry));
  }

  if (value && typeof value === "object") {
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "snapshotPath" || key === "tabRef" || key === "snapshotRef" || key === "index" || key === "pageId") {
        continue;
      }
      clone[key] = cloneAndStripPublicRuntimeFields(entry);
    }
    return clone;
  }

  return value;
}

function resolvePublicResultRules(endpoint) {
  switch (endpoint) {
    case "workspaces":
      return { requireWorkspaceTabRef: false, requireTabs: true, requireTabsWorkspaceTabRef: true };
    case "tabs":
      return { requireWorkspaceTabRef: false, requireTabs: true, requireTabsWorkspaceTabRef: true };
    case "selectTab":
      return { requireWorkspaceTabRef: true, requireTabs: false, requireTabsWorkspaceTabRef: false };
    case "navigate":
    case "click":
    case "type":
    case "press":
    case "query":
    case "recordKnowledge":
      return { requireWorkspaceTabRef: false, requireTabs: false, requireTabsWorkspaceTabRef: false };
    default:
      return null;
  }
}

function assertPublicWorkspaceResult(value, rules, endpoint) {
  assertPlainObject(value, "result");
  if (value.ok !== true) {
    throw new TypeError("ok must be true");
  }
  assertNonEmptyString(value.workspaceRef, "result.workspaceRef");

  if (rules.requireWorkspaceTabRef) {
    assertNonEmptyString(value.workspaceTabRef, "result.workspaceTabRef");
  } else if (value.workspaceTabRef !== undefined) {
    assertNonEmptyString(value.workspaceTabRef, "result.workspaceTabRef");
  }

  assertPageIdentity(value.page, endpoint);
  assertKnowledgeHits(value.knowledgeHits, endpoint);
  assertNonEmptyString(value.summary, "result.summary");

  if (rules.requireTabs) {
    if (!Array.isArray(value.tabs)) {
      throw new TypeError("result.tabs must be an array");
    }
  }

  if (Array.isArray(value.tabs)) {
    assertTabs(value.tabs);
  }
}

function assertPageIdentity(value, label) {
  assertPlainObject(value, `${label}.page`);
  assertNonEmptyString(value.origin, `${label}.page.origin`);
  assertNonEmptyString(value.normalizedPath, `${label}.page.normalizedPath`);
  assertNonEmptyString(value.title, `${label}.page.title`);
}

function assertKnowledgeHits(value, label) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label}.knowledgeHits must be an array`);
  }

  for (const [index, hit] of value.entries()) {
    assertPlainObject(hit, `${label}.knowledgeHits[${index}]`);
    assertNonEmptyString(hit.guide, `${label}.knowledgeHits[${index}].guide`);
    if (!Array.isArray(hit.keywords)) {
      throw new TypeError(`${label}.knowledgeHits[${index}].keywords must be an array`);
    }
    for (const [keywordIndex, keyword] of hit.keywords.entries()) {
      assertNonEmptyString(keyword, `${label}.knowledgeHits[${index}].keywords[${keywordIndex}]`);
    }
    if (hit.rationale !== undefined) {
      assertNonEmptyString(hit.rationale, `${label}.knowledgeHits[${index}].rationale`);
    }
  }
}

function assertTabs(value) {
  for (const [index, tab] of value.entries()) {
    assertPlainObject(tab, `result.tabs[${index}]`);
    assertNonEmptyString(tab.workspaceTabRef, `result.tabs[${index}].workspaceTabRef`);
    assertNonEmptyString(tab.title, `result.tabs[${index}].title`);
    assertNonEmptyString(tab.url, `result.tabs[${index}].url`);
    if (typeof tab.active !== "boolean") {
      throw new TypeError(`result.tabs[${index}].active must be a boolean`);
    }
    if ("index" in tab) {
      throw new TypeError(`result.tabs[${index}].index is not allowed`);
    }
  }
}
