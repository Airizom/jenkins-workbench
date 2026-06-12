import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workflowPath = path.join(process.cwd(), ".github", "workflows", "release.yml");
const source = await readFile(workflowPath, "utf8");
const fullShaPattern = /^[a-f0-9]{40}$/i;
const errors = [];

for (const [index, line] of source.split(/\r?\n/).entries()) {
  const match = line.match(/^\s*uses:\s*([^#\s]+)/);

  if (!match || match[1].startsWith("./")) {
    continue;
  }

  const actionReference = match[1];
  const atIndex = actionReference.lastIndexOf("@");

  if (atIndex === -1) {
    errors.push(
      `${workflowPath}:${index + 1} action reference must be pinned to a full commit SHA`
    );
    continue;
  }

  const ref = actionReference.slice(atIndex + 1);

  if (!fullShaPattern.test(ref)) {
    errors.push(
      `${workflowPath}:${index + 1} ${actionReference} must use a full 40-character commit SHA`
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
