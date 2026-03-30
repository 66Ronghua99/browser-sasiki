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
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(this.rootDir, entry.name);
      const fileStat = await stat(filePath);
      if (now - fileStat.mtimeMs > this.options.ttlMs) {
        await rm(filePath, { force: true });
      }
    }
  }
}
