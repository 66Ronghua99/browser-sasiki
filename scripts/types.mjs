export function assertCaptureResult(result) {
  assertBaseResult(result);
  assertTabs(result.tabs);
}

export function assertActionResult(result) {
  assertBaseResult(result);
  const action = result.action;
  if (
    action !== "navigate" &&
    action !== "click" &&
    action !== "type" &&
    action !== "press" &&
    action !== "select-tab"
  ) {
    throw new TypeError("action must be one of navigate, click, type, press, select-tab");
  }
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

function assertBaseResult(result) {
  assertRecord(result, "result");
  if (result.ok !== true) {
    throw new TypeError("ok must be true");
  }
  assertString(result.tabRef, "tabRef");
  assertPageIdentity(result.page);
  if ("snapshotPath" in result) {
    throw new TypeError("snapshotPath is not allowed");
  }
  assertString(result.snapshotRef, "snapshotRef");
  if (result.knowledgeRef !== undefined) {
    assertString(result.knowledgeRef, "knowledgeRef");
  }
  assertKnowledgeHits(result.knowledgeHits);
  assertString(result.summary, "summary");
}

function assertTabInventoryItem(tab, index) {
  assertRecord(tab, `tabs[${index}]`);
  if (typeof tab.index !== "number" || !Number.isInteger(tab.index) || tab.index < 0) {
    throw new TypeError(`tabs[${index}].index must be a non-negative integer`);
  }
  assertString(tab.title, `tabs[${index}].title`);
  assertString(tab.url, `tabs[${index}].url`);
  if (typeof tab.active !== "boolean") {
    throw new TypeError(`tabs[${index}].active must be a boolean`);
  }
}

function assertTabs(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("tabs must be an array");
  }
  value.forEach((tab, index) => assertTabInventoryItem(tab, index));
}
