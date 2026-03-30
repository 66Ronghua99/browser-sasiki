export interface SkillPageIdentity {
  origin: string;
  normalizedPath: string;
  title: string;
}

export interface KnowledgeHit {
  guide: string;
  keywords: string[];
  rationale?: string;
}

export interface CaptureResult {
  ok: boolean;
  tabRef: string;
  page: SkillPageIdentity;
  snapshotPath: string;
  knowledgeHits: KnowledgeHit[];
  summary: string;
}

export interface ActionResult extends CaptureResult {
  action: "navigate" | "click" | "type" | "press" | "select-tab";
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

function assertCaptureShape(result: unknown): asserts result is CaptureResult {
  assertRecord(result, "result");
  if (result.ok !== true) {
    throw new TypeError("ok must be true");
  }
  assertString(result.tabRef, "tabRef");
  assertPageIdentity(result.page);
  assertString(result.snapshotPath, "snapshotPath");
  assertKnowledgeHits(result.knowledgeHits);
  assertString(result.summary, "summary");
}

export function assertCaptureResult(result: unknown): asserts result is CaptureResult {
  assertCaptureShape(result);
}

export function assertActionResult(result: unknown): asserts result is ActionResult {
  assertRecord(result, "result");
  if (result.ok !== true) {
    throw new TypeError("ok must be true");
  }
  assertString(result.snapshotPath, "snapshotPath");
  assertString(result.tabRef, "tabRef");
  assertPageIdentity(result.page);
  assertKnowledgeHits(result.knowledgeHits);
  assertString(result.summary, "summary");
  assertString(result.action, "action");
}
