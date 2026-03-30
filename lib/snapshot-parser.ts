import { pageIdentityFromSnapshotText } from "./page-identity.js";

export interface ParsedSnapshotElement {
  lineNumber: number;
  raw: string;
  role: string | null;
  text: string;
  ref: string | null;
}

export interface ParsedSnapshotText {
  page: ReturnType<typeof pageIdentityFromSnapshotText>;
  elements: ParsedSnapshotElement[];
}

const SNAPSHOT_SECTION = "### Snapshot";

function unescapeQuotedText(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function snapshotBodyLines(snapshotText: string): Array<{ lineNumber: number; raw: string }> {
  const lines = snapshotText.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === SNAPSHOT_SECTION);
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

  const refMatch = content.match(/\[ref=([^\]\s]+)\]/i);
  const ref = refMatch?.[1]?.trim() || null;

  const body = content
    .replace(/\s+\[[^\]]+\]/g, " ")
    .replace(/\s*:\s*$/, "")
    .trim();

  const parsed = parseElementBody(body);
  if (!parsed) {
    return null;
  }

  return {
    lineNumber,
    raw,
    role: parsed.role,
    text: parsed.text,
    ref,
  };
}

export function parseSnapshotElements(snapshotText: string): ParsedSnapshotElement[] {
  return snapshotBodyLines(snapshotText)
    .map(({ lineNumber, raw }): ParsedSnapshotElement | null => {
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
