export interface SkillPageIdentity {
  origin: string;
  normalizedPath: string;
  title: string;
}

export interface SkillTabInventoryItem {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export interface KnowledgeHit {
  guide: string;
  keywords: string[];
  rationale?: string;
}

export interface SkillResultBase {
  ok: true;
  tabRef: string;
  page: SkillPageIdentity;
  snapshotPath: string;
  knowledgeHits: KnowledgeHit[];
  summary: string;
}

export interface CaptureResult extends SkillResultBase {
  tabs: SkillTabInventoryItem[];
}

export type SkillAction = "navigate" | "click" | "type" | "press" | "select-tab";

export interface ActionResult extends SkillResultBase {
  action: SkillAction;
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

function assertBaseResult(result: unknown): asserts result is SkillResultBase {
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

function assertTabInventoryItem(tab: unknown, index: number): asserts tab is SkillTabInventoryItem {
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

function assertTabs(value: unknown): asserts value is SkillTabInventoryItem[] {
  if (!Array.isArray(value)) {
    throw new TypeError("tabs must be an array");
  }
  value.forEach((tab, index) => assertTabInventoryItem(tab, index));
}

export function assertCaptureResult(result: unknown): asserts result is CaptureResult {
  assertBaseResult(result);
  assertTabs((result as CaptureResult).tabs);
}

export function assertActionResult(result: unknown): asserts result is ActionResult {
  assertBaseResult(result);
  const action = (result as unknown as Record<string, unknown>).action;
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
