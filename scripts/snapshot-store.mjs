import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export class SnapshotStore {
  constructor(rootDir, options) {
    this.rootDir = rootDir;
    this.options = options;
  }

  async write(snapshotText) {
    await mkdir(this.rootDir, { recursive: true });
    const snapshotPath = path.join(this.rootDir, `snapshot_${Date.now()}_${randomUUID()}.md`);
    await writeFile(snapshotPath, snapshotText, "utf8");
    return { snapshotPath };
  }

  async read(snapshotPath) {
    return readFile(snapshotPath, "utf8");
  }

  async exists(snapshotPath) {
    try {
      await stat(snapshotPath);
      return true;
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }
      throw error;
    }
  }

  async cleanupExpired(now = Date.now()) {
    let entries;
    try {
      entries = await readdir(this.rootDir, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(this.rootDir, entry.name);
      try {
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs > this.options.ttlMs) {
          await rm(filePath, { force: true });
        }
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }
      }
    }
  }
}

function isMissingPathError(error) {
  return isNodeErrorWithCode(error, "ENOENT");
}

function isNodeErrorWithCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
