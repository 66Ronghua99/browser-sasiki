import { normalizePagePath, pageIdentityFromSnapshotText } from "./page-identity.js";
import { parseSnapshotText, type ParsedSnapshotElement } from "./snapshot-parser.js";
import type { KnowledgeHit, SkillPageIdentity } from "./types.js";

export interface SnapshotQueryInput {
  snapshotText: string;
  mode: "search" | "auto" | "full";
  text?: string;
  role?: string;
  uid?: string;
  ref?: string;
  knowledgeHits?: KnowledgeHit[];
  page?: SkillPageIdentity;
}

export interface SnapshotQueryMatch {
  lineNumber: number;
  raw: string;
  role: string | null;
  text: string;
  uid: string | null;
  ref: string | null;
}

export interface SnapshotQueryFullResult {
  mode: "full";
  page: SkillPageIdentity;
  snapshotText: string;
  knowledgeHits: KnowledgeHit[];
  summary: string;
}

export interface SnapshotQuerySearchResult {
  mode: "search";
  page: SkillPageIdentity;
  matches: SnapshotQueryMatch[];
  knowledgeHits: KnowledgeHit[];
  summary: string;
}

export type SnapshotQueryResult = SnapshotQueryFullResult | SnapshotQuerySearchResult;

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function elementTokens(element: ParsedSnapshotElement): string {
  return [element.role ?? "", element.text, element.uid ?? "", element.ref ?? "", element.raw]
    .join(" ")
    .toLowerCase();
}

function buildKnowledgeTerms(knowledgeHits: KnowledgeHit[]): string[] {
  return knowledgeHits.flatMap((hit) => [hit.guide, ...hit.keywords].filter((value) => value.trim().length > 0));
}

function matchesCriteria(element: ParsedSnapshotElement, input: SnapshotQueryInput): boolean {
  const expectedUid = input.uid ?? input.ref;
  if (expectedUid && element.uid !== expectedUid && element.ref !== expectedUid) {
    return false;
  }
  if (input.role && normalizeText(element.role ?? "") !== normalizeText(input.role)) {
    return false;
  }
  if (input.text && !elementTokens(element).includes(normalizeText(input.text))) {
    return false;
  }
  return true;
}

function matchesKnowledge(element: ParsedSnapshotElement, knowledgeHits: KnowledgeHit[]): boolean {
  if (knowledgeHits.length === 0) {
    return true;
  }

  const tokens = elementTokens(element);
  return buildKnowledgeTerms(knowledgeHits).some((term) => tokens.includes(normalizeText(term)));
}

function toMatch(element: ParsedSnapshotElement): SnapshotQueryMatch {
  return {
    lineNumber: element.lineNumber,
    raw: element.raw,
    role: element.role,
    text: element.text,
    uid: element.uid,
    ref: element.ref,
  };
}

function defaultPageFromSnapshot(snapshotText: string, explicitPage?: SkillPageIdentity): SkillPageIdentity {
  if (explicitPage) {
    return {
      ...explicitPage,
      normalizedPath: normalizePagePath(explicitPage.normalizedPath),
    };
  }

  return pageIdentityFromSnapshotText(snapshotText);
}

export function querySnapshotText(input: SnapshotQueryInput): SnapshotQueryResult {
  const parsedSnapshot = parseSnapshotText(input.snapshotText);
  const page = defaultPageFromSnapshot(input.snapshotText, input.page);
  const knowledgeHits = input.knowledgeHits ?? [];

  if (input.mode === "full" || (input.mode === "auto" && knowledgeHits.length === 0)) {
    return {
      mode: "full",
      page,
      snapshotText: input.snapshotText,
      knowledgeHits,
      summary:
        input.mode === "auto" && knowledgeHits.length === 0
          ? "No page knowledge was available; returning the full snapshot content."
          : "Returning the full snapshot content.",
    };
  }

  const explicitMatches = parsedSnapshot.elements.filter((element) => matchesCriteria(element, input));
  const matches =
    input.mode === "auto" &&
    input.text === undefined &&
    input.role === undefined &&
    input.uid === undefined &&
    input.ref === undefined
      ? parsedSnapshot.elements.filter((element) => matchesKnowledge(element, knowledgeHits))
      : explicitMatches;

  if (input.mode === "auto" && knowledgeHits.length > 0 && matches.length === 0) {
    return {
      mode: "full",
      page,
      snapshotText: input.snapshotText,
      knowledgeHits,
      summary: "Knowledge cues did not match the snapshot; returning the full snapshot content.",
    };
  }

  return {
    mode: "search",
    page,
    matches: matches.map(toMatch),
    knowledgeHits,
    summary: `Found ${matches.length} matching snapshot element${matches.length === 1 ? "" : "s"}.`,
  };
}
