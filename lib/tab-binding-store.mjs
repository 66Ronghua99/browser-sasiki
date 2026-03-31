import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class TabBindingStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async write(record) {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.filePath(record.tabRef), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async read(tabRef) {
    const raw = await readFile(this.filePath(tabRef), "utf8");
    return parseTabBindingRecord(raw);
  }

  async exists(tabRef) {
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

  async delete(tabRef) {
    await rm(this.filePath(tabRef), { force: true });
  }

  filePath(tabRef) {
    return path.join(this.rootDir, `${encodeURIComponent(tabRef)}.json`);
  }
}

function parseTabBindingRecord(raw) {
  const value = JSON.parse(raw);
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

function assertPageIdentity(value) {
  if (!isRecord(value)) {
    throw new TypeError("page must be an object");
  }
  assertNonEmptyString(value.origin, "page.origin");
  assertNonEmptyString(value.normalizedPath, "page.normalizedPath");
  assertNonEmptyString(value.title, "page.title");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
