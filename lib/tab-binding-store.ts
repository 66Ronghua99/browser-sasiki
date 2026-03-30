import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillPageIdentity } from "./types.js";

export interface TabBindingRecord {
  tabRef: string;
  browserTabIndex: number;
  snapshotPath: string;
  page: SkillPageIdentity;
}

export class TabBindingStore {
  constructor(private readonly rootDir: string) {}

  async write(record: TabBindingRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.filePath(record.tabRef), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async read(tabRef: string): Promise<TabBindingRecord> {
    const raw = await readFile(this.filePath(tabRef), "utf8");
    return parseTabBindingRecord(raw);
  }

  async exists(tabRef: string): Promise<boolean> {
    try {
      await access(this.filePath(tabRef));
      return true;
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }
      throw error;
    }
  }

  async delete(tabRef: string): Promise<void> {
    await rm(this.filePath(tabRef), { force: true });
  }

  private filePath(tabRef: string): string {
    return path.join(this.rootDir, `${encodeURIComponent(tabRef)}.json`);
  }
}

function parseTabBindingRecord(raw: string): TabBindingRecord {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) {
    throw new TypeError("tab binding record must be an object");
  }
  assertNonEmptyString(value.tabRef, "tabRef");
  if (!isNonNegativeInteger(value.browserTabIndex)) {
    throw new TypeError("browserTabIndex must be a non-negative integer");
  }
  assertNonEmptyString(value.snapshotPath, "snapshotPath");
  assertPageIdentity(value.page);
  return {
    tabRef: value.tabRef,
    browserTabIndex: value.browserTabIndex,
    snapshotPath: value.snapshotPath,
    page: value.page,
  };
}

function assertPageIdentity(value: unknown): asserts value is SkillPageIdentity {
  if (!isRecord(value)) {
    throw new TypeError("page must be an object");
  }
  assertNonEmptyString(value.origin, "page.origin");
  assertNonEmptyString(value.normalizedPath, "page.normalizedPath");
  assertNonEmptyString(value.title, "page.title");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
