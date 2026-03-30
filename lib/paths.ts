import path from "node:path";

export function defaultRuntimeRoots() {
  return {
    tempRoot: `${process.env.HOME ?? "~"}/.sasiki/browser-skill/tmp`,
    knowledgeFile: path.resolve(process.cwd(), "knowledge/page-knowledge.jsonl"),
  };
}
