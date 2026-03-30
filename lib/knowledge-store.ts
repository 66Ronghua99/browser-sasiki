import fs from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { normalizePagePath } from "./page-identity.js";

export interface DurableKnowledgePageRef {
  origin: string;
  normalizedPath: string;
}

export interface DurableKnowledgeRecord {
  id: string;
  page: DurableKnowledgePageRef;
  guide: string;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
  sourceSnapshotPath?: string;
  sourceAction?: string;
  rationale?: string;
}

function assertKnowledgeRecord(record: DurableKnowledgeRecord): void {
  if (typeof record !== "object" || record === null) {
    throw new TypeError("knowledge record must be an object");
  }
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new TypeError("knowledge record id must be a non-empty string");
  }
  if (typeof record.page !== "object" || record.page === null) {
    throw new TypeError("knowledge record page must be an object");
  }
  if (typeof record.page.origin !== "string" || record.page.origin.length === 0) {
    throw new TypeError("knowledge record page.origin must be a non-empty string");
  }
  if (
    typeof record.page.normalizedPath !== "string" ||
    record.page.normalizedPath.length === 0
  ) {
    throw new TypeError("knowledge record page.normalizedPath must be a non-empty string");
  }
  if (typeof record.guide !== "string" || record.guide.length === 0) {
    throw new TypeError("knowledge record guide must be a non-empty string");
  }
  if (!Array.isArray(record.keywords)) {
    throw new TypeError("knowledge record keywords must be an array");
  }
  for (const [index, keyword] of record.keywords.entries()) {
    if (typeof keyword !== "string" || keyword.length === 0) {
      throw new TypeError(`knowledge record keywords[${index}] must be a non-empty string`);
    }
  }
  if (typeof record.createdAt !== "string" || record.createdAt.length === 0) {
    throw new TypeError("knowledge record createdAt must be a non-empty string");
  }
  if (typeof record.updatedAt !== "string" || record.updatedAt.length === 0) {
    throw new TypeError("knowledge record updatedAt must be a non-empty string");
  }
  if (record.sourceSnapshotPath !== undefined && typeof record.sourceSnapshotPath !== "string") {
    throw new TypeError("knowledge record sourceSnapshotPath must be a string");
  }
  if (record.sourceAction !== undefined && typeof record.sourceAction !== "string") {
    throw new TypeError("knowledge record sourceAction must be a string");
  }
  if (record.rationale !== undefined && typeof record.rationale !== "string") {
    throw new TypeError("knowledge record rationale must be a string");
  }
}

function parseKnowledgeLine(line: string, lineNumber: number): DurableKnowledgeRecord {
  try {
    const parsed = JSON.parse(line) as DurableKnowledgeRecord;
    assertKnowledgeRecord(parsed);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse knowledge record on line ${lineNumber}: ${message}`);
  }
}

export class KnowledgeStore {
  constructor(private readonly filePath: string) {}

  async append(record: DurableKnowledgeRecord): Promise<void> {
    assertKnowledgeRecord(record);
    record.page.normalizedPath = normalizePagePath(record.page.normalizedPath);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
  }

  async readAll(): Promise<DurableKnowledgeRecord[]> {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const contents = await readFile(this.filePath, "utf8");
    return contents
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => parseKnowledgeLine(line, index + 1));
  }

  async queryByPage(page: DurableKnowledgePageRef): Promise<DurableKnowledgeRecord[]> {
    const allRecords = await this.readAll();
    return allRecords.filter(
      (record) =>
        record.page.origin === page.origin &&
        record.page.normalizedPath === normalizePagePath(page.normalizedPath)
    );
  }

  async readById(id: string): Promise<DurableKnowledgeRecord> {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("knowledge id must be a non-empty string");
    }

    const allRecords = await this.readAll();
    const record = allRecords.find((item) => item.id === id);
    if (!record) {
      throw new Error(`Knowledge record not found for id ${id}`);
    }

    return record;
  }
}
