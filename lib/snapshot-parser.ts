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

function stripDecorators(line: string): { body: string; ref: string | null } | null {
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

  return {
    body,
    ref,
  };
}

function parseElementBody(body: string): { role: string | null; text: string } | null {
  const match = body.match(/^(?:(?<role>[A-Za-z][\w-]*)\s+)?(?:"(?<quoted>(?:\\.|[^"])*)"|(?<bare>.+?))\s*$/);
  if (!match?.groups) {
    return null;
  }

  const role = match.groups.role?.trim() || null;
  const quotedText = match.groups.quoted;
  const bareText = match.groups.bare?.trim() ?? "";
  const text = quotedText ? unescapeQuotedText(quotedText) : bareText;

  return {
    role,
    text,
  };
}

export function parseSnapshotElements(snapshotText: string): ParsedSnapshotElement[] {
  return snapshotBodyLines(snapshotText)
    .map(({ lineNumber, raw }): ParsedSnapshotElement | null => {
      const stripped = stripDecorators(raw);
      if (!stripped) {
        return null;
      }

      const parsed = parseElementBody(stripped.body);
      if (!parsed) {
        return null;
      }

      return {
        lineNumber,
        raw,
        role: parsed.role,
        text: parsed.text,
        ref: stripped.ref,
      };
    })
    .filter((element): element is ParsedSnapshotElement => element !== null);
}

export function parseSnapshotText(snapshotText: string): ParsedSnapshotText {
  return {
    page: pageIdentityFromSnapshotText(snapshotText),
    elements: parseSnapshotElements(snapshotText),
  };
}
