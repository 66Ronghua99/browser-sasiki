export function defaultRuntimeRoots() {
  return {
    tempRoot: `${process.env.HOME ?? "~"}/.sasiki/browser-skill/tmp`,
    knowledgeFile: new URL("../knowledge/page-knowledge.jsonl", import.meta.url).pathname,
  };
}
