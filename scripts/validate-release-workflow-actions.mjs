import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { load } from "js-yaml";

const workflowPath = path.join(process.cwd(), ".github", "workflows", "release.yml");
const fullShaPattern = /^[a-f0-9]{40}$/i;
const errors = [];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

let workflow;

try {
  workflow = load(await readFile(workflowPath, "utf8"));
} catch (error) {
  errors.push(
    `${workflowPath} could not be parsed: ${error instanceof Error ? error.message : String(error)}`
  );
}

const jobs = isRecord(workflow) && isRecord(workflow.jobs) ? workflow.jobs : {};
let foundPublicationStep = false;

for (const [jobName, job] of Object.entries(jobs)) {
  if (!isRecord(job) || !Array.isArray(job.steps)) {
    continue;
  }

  const artifactUploadIndex = job.steps.findIndex(
    (step) =>
      isRecord(step) &&
      typeof step.uses === "string" &&
      step.uses.startsWith("actions/upload-artifact@")
  );
  const publicationIndex = job.steps.findIndex(
    (step) => isRecord(step) && step.id === "publish-marketplaces"
  );

  if (publicationIndex !== -1) {
    foundPublicationStep = true;

    if (artifactUploadIndex === -1 || artifactUploadIndex > publicationIndex) {
      errors.push(
        `${workflowPath} job ${jobName} must upload the VSIX artifact before marketplace publication`
      );
    }
  }

  for (const [stepIndex, step] of job.steps.entries()) {
    if (!isRecord(step) || typeof step.uses !== "string" || step.uses.startsWith("./")) {
      continue;
    }

    const atIndex = step.uses.lastIndexOf("@");
    const ref = atIndex === -1 ? "" : step.uses.slice(atIndex + 1);

    if (!fullShaPattern.test(ref)) {
      errors.push(
        `${workflowPath} job ${jobName} step ${stepIndex + 1} ${step.uses} must use a full 40-character commit SHA`
      );
    }
  }
}

if (!foundPublicationStep) {
  errors.push(`${workflowPath} must define a publish-marketplaces step`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
