import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TabBindingRecord {
  tabRef: string;
  browserTabIndex: number;
  snapshotPath: string;
  page: {
    origin: string;
    normalizedPath: string;
    title: string;
  };
}

export class TabBindingStore {
  constructor(private readonly rootDir: string) {}

  async write(record: TabBindingRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.filePath(record.tabRef), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async read(tabRef: string): Promise<TabBindingRecord> {
    const raw = await readFile(this.filePath(tabRef), "utf8");
    return JSON.parse(raw) as TabBindingRecord;
  }

  async delete(tabRef: string): Promise<void> {
    await rm(this.filePath(tabRef), { force: true });
  }

  private filePath(tabRef: string): string {
    return path.join(this.rootDir, `${encodeURIComponent(tabRef)}.json`);
  }
}
