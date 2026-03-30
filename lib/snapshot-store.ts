import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class SnapshotStore {
  constructor(
    private readonly rootDir: string,
    private readonly options: { ttlMs: number },
  ) {}

  async write(snapshotText: string): Promise<{ snapshotPath: string }> {
    await mkdir(this.rootDir, { recursive: true });
    const snapshotPath = path.join(this.rootDir, `snapshot_${Date.now()}_${randomUUID()}.md`);
    await writeFile(snapshotPath, snapshotText, "utf8");
    return { snapshotPath };
  }

  async read(snapshotPath: string): Promise<string> {
    return readFile(snapshotPath, "utf8");
  }

  async exists(snapshotPath: string): Promise<boolean> {
    try {
      await stat(snapshotPath);
      return true;
    } catch {
      return false;
    }
  }

  async cleanupExpired(now = Date.now()): Promise<void> {
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

function isMissingPathError(error: unknown): boolean {
  return isNodeErrorWithCode(error, "ENOENT");
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
