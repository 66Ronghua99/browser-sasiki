import { type SkillPageIdentity } from "./types.js";

function normalizePath(pathname: string): string {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const withoutQuery = withLeadingSlash.split(/[?#]/, 1)[0] ?? "/";
  const trimmed = withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
  return trimmed.length > 0 ? trimmed : "/";
}

function extractSnapshotField(snapshotText: string, label: string): string {
  const lines = snapshotText.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(new RegExp(`^\\s*-\\s*(?:${label}):\\s*(.+?)\\s*$`, "i"));
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  throw new Error(`Unable to find ${label} in snapshot text`);
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
  const pageUrl = extractSnapshotField(snapshotText, "Page URL|URL");
  const pageTitle = extractSnapshotField(snapshotText, "Page Title|TITLE|Title");
  return pageIdentityFromUrl(pageUrl, pageTitle);
}

export function normalizePagePath(pathname: string): string {
  return normalizePath(pathname);
}
