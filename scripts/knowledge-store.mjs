import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizePagePath } from "./page-identity.mjs";

function assertKnowledgeRecord(record) {
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

function parseKnowledgeLine(line, lineNumber) {
  try {
    const parsed = JSON.parse(line);
    assertKnowledgeRecord(parsed);
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse knowledge record on line ${lineNumber}: ${message}`);
  }
}

function normalizeKnowledgeRecord(record) {
  return {
    ...record,
    page: {
      ...record.page,
      normalizedPath: normalizePagePath(record.page.normalizedPath),
    },
  };
}

function normalizeKnowledgeText(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedKeywordSignature(keywords) {
  return [...new Set(keywords.map((keyword) => normalizeKnowledgeText(keyword)))]
    .sort()
    .join("\u0000");
}

function semanticKnowledgeKey(record) {
  return [
    record.page.origin,
    record.page.normalizedPath,
    normalizeKnowledgeText(record.guide),
    normalizedKeywordSignature(record.keywords),
  ].join("\u0001");
}

function canonicalizeRecords(records) {
  const bySemanticKey = new Map();
  for (const record of records) {
    const semanticKey = semanticKnowledgeKey(record);
    bySemanticKey.delete(semanticKey);
    bySemanticKey.set(semanticKey, record);
  }

  const byId = new Map();
  for (const record of bySemanticKey.values()) {
    byId.delete(record.id);
    byId.set(record.id, record);
  }

  return [...byId.values()];
}

export class KnowledgeStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async append(record) {
    assertKnowledgeRecord(record);
    const normalizedRecord = normalizeKnowledgeRecord(record);

    const existingRecords = await this.readRawAll();
    const canonicalRecords = canonicalizeRecords([...existingRecords, normalizedRecord]);
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(
      this.filePath,
      `${canonicalRecords.map((item) => JSON.stringify(item)).join("\n")}\n`,
      "utf8"
    );
  }

  async readAll() {
    return canonicalizeRecords(await this.readRawAll());
  }

  async queryByPage(page) {
    const allRecords = await this.readAll();
    return allRecords.filter(
      (record) =>
        record.page.origin === page.origin &&
        record.page.normalizedPath === normalizePagePath(page.normalizedPath)
    );
  }

  async readById(id) {
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

  async readRawAll() {
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    const contents = await readFile(this.filePath, "utf8");
    return contents
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => normalizeKnowledgeRecord(parseKnowledgeLine(line, index + 1)));
  }
}
