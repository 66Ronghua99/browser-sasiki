import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const WORKSPACES_DIR = "workspaces";
const WORKSPACE_TABS_DIR = "workspace-tabs";

export class WorkspaceStore {
  constructor(rootDir) {
    this.rootDir = rootDir;
  }

  async writeWorkspace(record) {
    assertWorkspaceRecord(record);
    await mkdir(path.dirname(this.workspaceFilePath(record.workspaceRef)), { recursive: true });
    await writeFile(this.workspaceFilePath(record.workspaceRef), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async readWorkspace(workspaceRef) {
    const raw = await readFile(this.workspaceFilePath(workspaceRef), "utf8");
    return parseWorkspaceRecord(raw);
  }

  async writeWorkspaceTab(record) {
    assertWorkspaceTabRecord(record);
    await mkdir(path.dirname(this.workspaceTabFilePath(record.workspaceRef, record.workspaceTabRef)), { recursive: true });
    await writeFile(
      this.workspaceTabFilePath(record.workspaceRef, record.workspaceTabRef),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
  }

  async readWorkspaceTab(workspaceRef, workspaceTabRef) {
    const raw = await readFile(this.workspaceTabFilePath(workspaceRef, workspaceTabRef), "utf8");
    return parseWorkspaceTabRecord(raw);
  }

  async listWorkspaceTabs(workspaceRef) {
    const dirPath = this.workspaceTabsDirPath(workspaceRef);
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const raw = await readFile(path.join(dirPath, entry.name), "utf8");
      records.push(parseWorkspaceTabRecord(raw));
    }

    return records.sort((left, right) => left.workspaceTabRef.localeCompare(right.workspaceTabRef));
  }

  async deleteWorkspaceTab(workspaceRef, workspaceTabRef) {
    await rm(this.workspaceTabFilePath(workspaceRef, workspaceTabRef), { force: true });
  }

  workspaceFilePath(workspaceRef) {
    return path.join(this.rootDir, WORKSPACES_DIR, `${encodeURIComponent(workspaceRef)}.json`);
  }

  workspaceTabsDirPath(workspaceRef) {
    return path.join(this.rootDir, WORKSPACE_TABS_DIR, encodeURIComponent(workspaceRef));
  }

  workspaceTabFilePath(workspaceRef, workspaceTabRef) {
    return path.join(this.workspaceTabsDirPath(workspaceRef), `${encodeURIComponent(workspaceTabRef)}.json`);
  }
}

function parseWorkspaceRecord(raw) {
  const value = JSON.parse(raw);
  assertWorkspaceRecord(value);
  return value;
}

function parseWorkspaceTabRecord(raw) {
  const value = JSON.parse(raw);
  assertWorkspaceTabRecord(value);
  return value;
}

function assertWorkspaceRecord(record) {
  assertRecord(record, "workspace record");
  assertNonEmptyString(record.workspaceRef, "workspaceRef");
  assertNonEmptyString(record.activeWorkspaceTabRef, "activeWorkspaceTabRef");
  assertNonNegativeInteger(record.browserTabIndex, "browserTabIndex");
  assertPageIdentity(record.page);
  assertNonEmptyString(record.snapshotPath, "snapshotPath");
  assertNonEmptyString(record.createdAt, "createdAt");
  assertNonEmptyString(record.updatedAt, "updatedAt");
}

function assertWorkspaceTabRecord(record) {
  assertRecord(record, "workspace tab record");
  assertNonEmptyString(record.workspaceRef, "workspaceRef");
  assertNonEmptyString(record.workspaceTabRef, "workspaceTabRef");
  assertNonEmptyString(record.targetId, "targetId");
  assertOptionalNonNegativeInteger(record.browserTabIndex, "browserTabIndex");
  assertTabStatus(record.status);
  assertPageIdentity(record.page);
  assertNonEmptyString(record.snapshotPath, "snapshotPath");
  assertNonEmptyString(record.createdAt, "createdAt");
  assertNonEmptyString(record.updatedAt, "updatedAt");
}

function assertPageIdentity(value) {
  assertRecord(value, "page");
  assertNonEmptyString(value.origin, "page.origin");
  assertNonEmptyString(value.normalizedPath, "page.normalizedPath");
  assertNonEmptyString(value.title, "page.title");
}

function assertRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
}

function assertOptionalNonNegativeInteger(value, label) {
  if (value === undefined) {
    return;
  }
  assertNonNegativeInteger(value, label);
}

function assertTabStatus(value) {
  if (value !== "open" && value !== "closed") {
    throw new TypeError('status must be "open" or "closed"');
  }
}

function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
