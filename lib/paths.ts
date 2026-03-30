import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function packageRootDir(): string {
  let currentDir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    if (fs.existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error("Unable to locate skill package root");
    }

    currentDir = parentDir;
  }
}

export function defaultRuntimeRoots() {
  const packageRoot = packageRootDir();
  return {
    tempRoot: `${process.env.HOME ?? "~"}/.sasiki/browser-skill/tmp`,
    knowledgeFile: path.resolve(packageRoot, "knowledge/page-knowledge.jsonl"),
  };
}
