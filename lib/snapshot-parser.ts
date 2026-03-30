import { pageIdentityFromSnapshotText } from "./page-identity.js";

export interface ParsedSnapshotElement {
  lineNumber: number;
  raw: string;
  role: string | null;
  text: string;
  uid: string | null;
  ref: string | null;
}

export interface ParsedSnapshotText {
  page: ReturnType<typeof pageIdentityFromSnapshotText>;
  elements: ParsedSnapshotElement[];
}

const LEGACY_SNAPSHOT_SECTION = "### Snapshot";
const ACCESSIBILITY_SNAPSHOT_SECTION = "## Latest page snapshot";

function unescapeQuotedText(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function snapshotBodyLines(snapshotText: string): Array<{ lineNumber: number; raw: string }> {
  const lines = snapshotText.split(/\r?\n/);
  const accessibilityHeadingIndex = lines.findIndex((line) => line.trim() === ACCESSIBILITY_SNAPSHOT_SECTION);
  if (accessibilityHeadingIndex >= 0) {
    return lines.slice(accessibilityHeadingIndex + 1).map((raw, index) => ({
      lineNumber: accessibilityHeadingIndex + index + 2,
      raw,
    }));
  }

  const headingIndex = lines.findIndex((line) => line.trim() === LEGACY_SNAPSHOT_SECTION);
  if (headingIndex < 0) {
    return lines.map((raw, index) => ({ lineNumber: index + 1, raw }));
  }

  let fenceIndex = -1;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("```")) {
      fenceIndex = index;
      break;
    }
  }

  if (fenceIndex < 0) {
    return lines.slice(headingIndex + 1).map((raw, index) => ({
      lineNumber: headingIndex + index + 2,
      raw,
    }));
  }

  const body: Array<{ lineNumber: number; raw: string }> = [];
  for (let index = fenceIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index];
    if (raw.trim().startsWith("```")) {
      break;
    }
    body.push({ lineNumber: index + 1, raw });
  }

  return body;
}

function parseElementBody(body: string): { role: string | null; text: string } | null {
  const quotedMatch = body.match(
    /^(?:(?<role>[A-Za-z][\w-]*)\s+)?(?:"(?<quoted>(?:\\.|[^"])*)")(?<suffix>.*)$/
  );
  if (quotedMatch?.groups) {
    const role = quotedMatch.groups.role?.trim() || null;
    const text = unescapeQuotedText(quotedMatch.groups.quoted ?? "");
    return {
      role,
      text,
    };
  }

  const match = body.match(/^(?:(?<role>[A-Za-z][\w-]*)\s+)?(?<bare>.+?)\s*$/);
  if (!match?.groups) {
    return null;
  }

  const role = match.groups.role?.trim() || null;
  const bareText = match.groups.bare?.trim() ?? "";

  return {
    role,
    text: bareText,
  };
}

function stripBareDecorators(content: string): { role: string; text: string; ref: string | null } | null {
  const match = content.match(
    /^(?<role>[A-Za-z][\w-]*)(?<decorators>(?:\s+\[[^\]]+\])*)(?:\s*:\s*(?<tail>.*))?$/
  );
  if (!match?.groups) {
    return null;
  }

  return {
    role: match.groups.role.trim(),
    text: match.groups.tail?.trim() ?? "",
    ref: match.groups.decorators?.match(/\[ref=([^\]\s]+)\]/i)?.[1]?.trim() || null,
  };
}

function parseQuotedElementLine(line: string, lineNumber: number, raw: string): ParsedSnapshotElement | null {
  const content = line.trim().slice(2).trim().replace(/^<changed>\s*/i, "");
  const match = content.match(
    /^(?:(?<role>[A-Za-z][\w-]*)\s+)?(?:"(?<quoted>(?:\\.|[^"])*)")(?<suffix>.*)$/
  );
  if (!match?.groups) {
    return null;
  }

  const role = match.groups.role?.trim() || null;
  const text = unescapeQuotedText(match.groups.quoted ?? "");
  const ref = match.groups.suffix?.match(/\[ref=([^\]\s]+)\]/i)?.[1]?.trim() || null;

  return {
    lineNumber,
    raw,
    role,
    text,
    uid: null,
    ref,
  };
}

function parseBareElementLine(line: string, lineNumber: number, raw: string): ParsedSnapshotElement | null {
  let content = line.trim();
  if (!content.startsWith("- ")) {
    return null;
  }

  content = content.slice(2).trim();
  content = content.replace(/^<changed>\s*/i, "");

  const parsed = stripBareDecorators(content);
  if (!parsed) {
    return null;
  }

  return {
    lineNumber,
    raw,
    role: parsed.role,
    text: parsed.text,
    uid: parsed.ref,
    ref: parsed.ref,
  };
}

function parseAccessibilityElementLine(raw: string, lineNumber: number): ParsedSnapshotElement | null {
  const match = raw.match(/^\s*uid=(?<uid>[^\s]+)\s+(?<role>[A-Za-z][\w-]*)(?<rest>.*)$/u);
  if (!match?.groups) {
    return null;
  }

  const uid = match.groups.uid.trim();
  const role = match.groups.role.trim();
  const text = match.groups.rest.match(/(?:^|\s)"(?<label>(?:\\.|[^"])*)"/u)?.groups?.label ?? "";

  return {
    lineNumber,
    raw,
    role,
    text: unescapeQuotedText(text),
    uid,
    ref: uid,
  };
}

export function parseSnapshotElements(snapshotText: string): ParsedSnapshotElement[] {
  return snapshotBodyLines(snapshotText)
    .map(({ lineNumber, raw }): ParsedSnapshotElement | null => {
      const parsedAccessibility = parseAccessibilityElementLine(raw, lineNumber);
      if (parsedAccessibility) {
        return parsedAccessibility;
      }

      const parsedQuoted = parseQuotedElementLine(raw, lineNumber, raw);
      if (parsedQuoted) {
        return parsedQuoted;
      }

      return parseBareElementLine(raw, lineNumber, raw);
    })
    .filter((element): element is ParsedSnapshotElement => element !== null);
}

export function parseSnapshotText(snapshotText: string): ParsedSnapshotText {
  return {
    page: pageIdentityFromSnapshotText(snapshotText),
    elements: parseSnapshotElements(snapshotText),
  };
}
