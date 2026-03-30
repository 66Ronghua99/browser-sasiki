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
const ELEMENT_LINE_PATTERN =
  /^-\s+(?:(?<role>[A-Za-z][\w-]*)\s+)?(?:"(?<quoted>(?:\\.|[^"])*)"|(?<bare>.+?))(?:\s+\[ref=(?<ref>[^\]]+)\])?$/;

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

export function parseSnapshotElements(snapshotText: string): ParsedSnapshotElement[] {
  return snapshotBodyLines(snapshotText)
    .map(({ lineNumber, raw }): ParsedSnapshotElement | null => {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("- ")) {
        return null;
      }

      const match = trimmed.match(ELEMENT_LINE_PATTERN);
      if (!match?.groups) {
        return null;
      }

      const role = match.groups.role?.trim() ?? null;
      const quotedText = match.groups.quoted;
      const bareText = match.groups.bare?.trim() ?? "";
      const text = quotedText ? unescapeQuotedText(quotedText) : bareText;
      const ref = match.groups.ref?.trim() || null;

      return {
        lineNumber,
        raw,
        role,
        text,
        ref,
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
