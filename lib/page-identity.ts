import { type SkillPageIdentity } from "./types.js";

const LATEST_SNAPSHOT_HEADING = "## Latest page snapshot";

function normalizePath(pathname: string): string {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const withoutQuery = withLeadingSlash.split(/[?#]/, 1)[0] ?? "/";
  const trimmed = withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
  return trimmed.length > 0 ? trimmed : "/";
}

function extractLegacySnapshotField(snapshotText: string, label: string): string {
  const lines = snapshotText.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*-\\s*(?:${label}):\\s*(.+?)\\s*$`, "i"));
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  throw new Error(`Unable to find ${label} in snapshot text`);
}

function extractAccessibilityRoot(snapshotText: string): { url: string; title: string } | null {
  const lines = snapshotText.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === LATEST_SNAPSHOT_HEADING);
  const candidateLines = headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines;

  for (const line of candidateLines) {
    const match = line.match(
      /^\s*uid=[^\s]+\s+RootWebArea(?:\s+"(?<title>(?:\\.|[^"])*)")?(?<suffix>.*)$/u,
    );
    if (!match?.groups) {
      continue;
    }

    const url = match.groups.suffix.match(/\burl="(?<url>(?:\\.|[^"])*)"/u)?.groups?.url?.trim();
    if (!url) {
      continue;
    }

    return {
      url,
      title: match.groups.title?.trim() || "Unknown",
    };
  }

  return null;
}

export function pageIdentityFromUrl(urlText: string, title: string): SkillPageIdentity {
  const parsed = new URL(urlText);
  return {
    origin: parsed.origin,
    normalizedPath: normalizePath(parsed.pathname),
    title: title.trim() || "Unknown",
  };
}

export function pageIdentityFromSnapshotText(snapshotText: string): SkillPageIdentity {
  try {
    const pageUrl = extractLegacySnapshotField(snapshotText, "Page URL|URL");
    const pageTitle = extractLegacySnapshotField(snapshotText, "Page Title|TITLE|Title");
    return pageIdentityFromUrl(pageUrl, pageTitle);
  } catch {
    const accessibilityPage = extractAccessibilityRoot(snapshotText);
    if (!accessibilityPage) {
      throw new Error("Unable to find page identity in snapshot text");
    }

    return pageIdentityFromUrl(accessibilityPage.url, accessibilityPage.title);
  }
}

export function normalizePagePath(pathname: string): string {
  return normalizePath(pathname);
}
