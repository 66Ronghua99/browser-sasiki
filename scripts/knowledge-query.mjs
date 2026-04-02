import { normalizePagePath, pageIdentityFromSnapshotText } from "./page-identity.mjs";
import { parseSnapshotText } from "./snapshot-parser.mjs";

function normalizeText(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function elementTokens(element) {
  return [element.role ?? "", element.text, element.uid ?? "", element.raw]
    .join(" ")
    .toLowerCase();
}

function buildKnowledgeTerms(knowledgeHits) {
  return knowledgeHits.flatMap((hit) => [hit.guide, ...hit.keywords].filter((value) => value.trim().length > 0));
}

function matchesCriteria(element, input) {
  const expectedUid = input.uid;
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
    role: element.role,
    text: element.text,
    uid: element.uid,
    interactive: element.interactive === true,
    actionableUid: element.actionableUid ?? null,
    ...(typeof element.sourceUid === "string" ? { sourceUid: element.sourceUid } : {}),
    ...(typeof element.sourceText === "string" ? { sourceText: element.sourceText } : {}),
  };
}

function uniqueMatchKey(element) {
  return [
    element.uid ?? "",
    normalizeText(element.role ?? ""),
    normalizeText(element.text ?? ""),
  ].join("\u0000");
}

function isRedundantStaticTextMatch(element, matches) {
  if (normalizeText(element.role ?? "") !== "statictext") {
    return false;
  }

  const elementText = normalizeText(element.text ?? "");
  if (elementText.length === 0) {
    return false;
  }

  return matches.some((candidate) => {
    if (candidate === element) {
      return false;
    }

    if (normalizeText(candidate.role ?? "") === "statictext") {
      return false;
    }

    const candidateText = normalizeText(candidate.text ?? "");
    if (candidateText.length === 0 || candidateText.length < elementText.length) {
      return false;
    }

    return candidateText.includes(elementText);
  });
}

function dedupeMatches(matches) {
  const uniqueMatches = [];
  const seen = new Set();
  for (const match of matches) {
    const key = uniqueMatchKey(match);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueMatches.push(match);
  }

  return uniqueMatches.filter((match) => !isRedundantStaticTextMatch(match, uniqueMatches));
}

function buildElementIndex(elements) {
  return new Map(elements.map((element) => [element.uid, element]));
}

function resolveActionTarget(element, elementIndex) {
  if (!element) {
    return null;
  }
  if (typeof element.actionableUid === "string" && element.actionableUid.length > 0) {
    return elementIndex.get(element.actionableUid) ?? element;
  }
  return element;
}

function promoteMatchesToActionTargets(matches, input, elementIndex) {
  if (!input.text || input.uid || input.role) {
    return matches;
  }

  return matches.map((match) => {
    const target = resolveActionTarget(match, elementIndex);
    if (!target || target.uid === match.uid) {
      return match;
    }
    return {
      ...target,
      sourceUid: match.uid,
      sourceText: match.text,
    };
  });
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

  if (input.mode === "full") {
    return {
      mode: "full",
      page,
      snapshotText: input.snapshotText,
      knowledgeHits,
      summary: "Returning the full snapshot content.",
    };
  }

  const explicitMatches = parsedSnapshot.elements.filter((element) => matchesCriteria(element, input));
  const promotedMatches = promoteMatchesToActionTargets(
    explicitMatches,
    input,
    buildElementIndex(parsedSnapshot.elements),
  );
  const matches = dedupeMatches(promotedMatches);

  return {
    mode: "search",
    page,
    matches: matches.map(toMatch),
    knowledgeHits,
    summary: `Found ${matches.length} matching snapshot element${matches.length === 1 ? "" : "s"}.`,
  };
}
