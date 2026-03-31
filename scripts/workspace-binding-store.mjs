import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class WorkspaceBindingStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async write(record) {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.filePath(record.workspaceRef), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async read(workspaceRef) {
    const raw = await readFile(this.filePath(workspaceRef), "utf8");
    return parseWorkspaceBindingRecord(raw);
  }

  async exists(workspaceRef) {
    try {
      await access(this.filePath(workspaceRef));
      return true;
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }
      throw error;
    }
  }

  async delete(workspaceRef) {
    await rm(this.filePath(workspaceRef), { force: true });
  }

  filePath(workspaceRef) {
    return path.join(this.rootDir, `${encodeURIComponent(workspaceRef)}.json`);
  }
}

function parseWorkspaceBindingRecord(raw) {
  const value = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new TypeError("workspace binding record must be an object");
  }
  assertNonEmptyString(value.workspaceRef, "workspaceRef");
  if (!isNonNegativeInteger(value.browserTabIndex)) {
    throw new TypeError("browserTabIndex must be a non-negative integer");
  }
  assertNonEmptyString(value.snapshotPath, "snapshotPath");
  assertPageIdentity(value.page);
  return {
    workspaceRef: value.workspaceRef,
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
