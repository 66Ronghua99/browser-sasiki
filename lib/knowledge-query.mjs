import { normalizePagePath, pageIdentityFromSnapshotText } from "./page-identity.mjs";
import { parseSnapshotText } from "./snapshot-parser.mjs";

function normalizeText(value) {
  return value.trim().toLowerCase();
}

function elementTokens(element) {
  return [element.role ?? "", element.text, element.uid ?? "", element.ref ?? "", element.raw]
    .join(" ")
    .toLowerCase();
}

function buildKnowledgeTerms(knowledgeHits) {
  return knowledgeHits.flatMap((hit) => [hit.guide, ...hit.keywords].filter((value) => value.trim().length > 0));
}

function matchesCriteria(element, input) {
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

function matchesKnowledge(element, knowledgeHits) {
  if (knowledgeHits.length === 0) {
    return true;
  }

  const tokens = elementTokens(element);
  return buildKnowledgeTerms(knowledgeHits).some((term) => tokens.includes(normalizeText(term)));
}

function toMatch(element) {
  return {
    lineNumber: element.lineNumber,
    raw: element.raw,
    role: element.role,
    text: element.text,
    uid: element.uid,
    ref: element.ref,
  };
}

function defaultPageFromSnapshot(snapshotText, explicitPage) {
  if (explicitPage) {
    return {
      ...explicitPage,
      normalizedPath: normalizePagePath(explicitPage.normalizedPath),
    };
  }

  return pageIdentityFromSnapshotText(snapshotText);
}

export function querySnapshotText(input) {
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
