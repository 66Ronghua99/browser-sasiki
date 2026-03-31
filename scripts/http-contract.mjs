const ACTIVE_ENDPOINT_DEFINITIONS = [
  { name: "health", method: "GET", path: "/health", fields: [] },
  { name: "capture", method: "POST", path: "/capture", fields: ["tabRef", "pageId"] },
  { name: "navigate", method: "POST", path: "/navigate", fields: ["tabRef", "url"] },
  { name: "click", method: "POST", path: "/click", fields: ["tabRef", "uid", "ref"] },
  { name: "type", method: "POST", path: "/type", fields: ["tabRef", "uid", "ref", "text", "submit", "slowly"] },
  { name: "press", method: "POST", path: "/press", fields: ["tabRef", "key"] },
  { name: "selectTab", method: "POST", path: "/select-tab", fields: ["tabRef", "pageId"] },
  { name: "querySnapshot", method: "POST", path: "/query-snapshot", fields: ["tabRef", "snapshotRef", "mode", "query", "role", "uid", "ref"] },
  { name: "recordKnowledge", method: "POST", path: "/record-knowledge", fields: ["tabRef", "snapshotRef", "page", "guide", "keywords", "rationale"] },
  { name: "shutdown", method: "POST", path: "/shutdown", fields: [] },
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
    ACTIVE_ENDPOINT_DEFINITIONS.map((definition) => [definition.name, Object.freeze([...definition.fields])]),
  ),
);

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
    case "shutdown":
      assertEmptyObject(body, endpoint);
      return;
    case "capture":
      if (body.tabRef !== undefined) {
        assertNonEmptyString(body.tabRef, "body.tabRef");
      }
      if (body.pageId !== undefined) {
        assertNonNegativeInteger(body.pageId, "body.pageId");
      }
      return;
    case "navigate":
    case "click":
    case "press":
    case "selectTab":
      assertNonEmptyString(body.tabRef, "body.tabRef");
      if (endpoint === "navigate") {
        assertNonEmptyString(body.url, "body.url");
      } else if (endpoint === "click") {
        assertSelector(body, "body");
      } else if (endpoint === "press") {
        assertNonEmptyString(body.key, "body.key");
      } else {
        assertNonNegativeInteger(body.pageId, "body.pageId");
      }
      return;
    case "type":
      assertNonEmptyString(body.tabRef, "body.tabRef");
      assertSelector(body, "body");
      assertNonEmptyString(body.text, "body.text");
      if (body.submit !== undefined) {
        assertBoolean(body.submit, "body.submit");
      }
      if (body.slowly !== undefined) {
        assertBoolean(body.slowly, "body.slowly");
      }
      return;
    case "querySnapshot":
      if (body.tabRef === undefined && body.snapshotRef === undefined) {
        throw new TypeError("querySnapshot body must include tabRef or snapshotRef");
      }
      if (body.tabRef !== undefined) {
        assertNonEmptyString(body.tabRef, "body.tabRef");
      }
      if (body.snapshotRef !== undefined) {
        assertNonEmptyString(body.snapshotRef, "body.snapshotRef");
      }
      if (body.mode !== undefined && !["search", "auto", "full"].includes(body.mode)) {
        throw new TypeError('body.mode must be one of "search", "auto", or "full"');
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
      if (body.ref !== undefined) {
        assertNonEmptyString(body.ref, "body.ref");
      }
      return;
    case "recordKnowledge":
      if (body.page === undefined && body.tabRef === undefined && body.snapshotRef === undefined) {
        throw new TypeError("recordKnowledge body must include page, tabRef, or snapshotRef");
      }
      if (body.page !== undefined) {
        assertPageIdentity(body.page, "body.page");
      }
      if (body.tabRef !== undefined) {
        assertNonEmptyString(body.tabRef, "body.tabRef");
      }
      if (body.snapshotRef !== undefined) {
        assertNonEmptyString(body.snapshotRef, "body.snapshotRef");
      }
      assertNonEmptyString(body.guide, "body.guide");
      assertNonEmptyStringArray(body.keywords, "body.keywords");
      if (body.rationale !== undefined) {
        assertNonEmptyString(body.rationale, "body.rationale");
      }
      return;
    default:
      throw new TypeError(`unsupported endpoint "${endpoint}"`);
  }
}

export function shapeHttpPublicResult(value) {
  return cloneWithoutSnapshotPath(value);
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

function assertSelector(body, label) {
  if (body.uid === undefined && body.ref === undefined) {
    throw new TypeError(`${label} must include uid or ref`);
  }
  if (body.uid !== undefined) {
    assertNonEmptyString(body.uid, `${label}.uid`);
  }
  if (body.ref !== undefined) {
    assertNonEmptyString(body.ref, `${label}.ref`);
  }
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

function assertInteger(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer`);
  }
}

function assertNonNegativeInteger(value, label) {
  assertInteger(value, label);
  if (value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
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

function assertPageIdentity(value, label) {
  assertPlainObject(value, label);
  assertNonEmptyString(value.origin, `${label}.origin`);
  assertNonEmptyString(value.normalizedPath, `${label}.normalizedPath`);
  assertNonEmptyString(value.title, `${label}.title`);
}

function cloneWithoutSnapshotPath(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneWithoutSnapshotPath(entry));
  }

  if (value && typeof value === "object") {
    const clone = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === "snapshotPath") {
        continue;
      }
      clone[key] = cloneWithoutSnapshotPath(entry);
    }
    return clone;
  }

  return value;
}
