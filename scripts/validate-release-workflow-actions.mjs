import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { load } from "js-yaml";

const workflowPath = path.join(process.cwd(), ".github", "workflows", "release.yml");
const fullShaPattern = /^[a-f0-9]{40}$/i;
const errors = [];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const stripQuotes = (token) => token.replace(/^(["'])(.*)\1$/, "$2");
const normalizeScriptPath = (token) => stripQuotes(token).replace(/^\.\//, "");
const isVsixUpload = (step) =>
  isRecord(step.with) &&
  step.with.name === "vsix" &&
  typeof step.with.path === "string" &&
  step.with.path.trim().endsWith(".vsix");
const isPublishCommand = (run) =>
  typeof run === "string" &&
  run.split(/\r?\n/).some((line) => {
    const tokens = line.trim().split(/\s+/);
    return (
      tokens.length === 4 &&
      tokens[0] === "node" &&
      normalizeScriptPath(tokens[1]) === "scripts/release.mjs" &&
      stripQuotes(tokens[2]) === "publish" &&
      stripQuotes(tokens[3]).endsWith(".vsix")
    );
  });

let workflow;

try {
  workflow = load(await readFile(workflowPath, "utf8"));
} catch (error) {
  errors.push(
    `${workflowPath} could not be parsed: ${error instanceof Error ? error.message : String(error)}`
  );
}

const jobs = isRecord(workflow) && isRecord(workflow.jobs) ? workflow.jobs : {};
const concurrency =
  isRecord(workflow) && isRecord(workflow.concurrency) ? workflow.concurrency : {};
if (
  typeof concurrency.group !== "string" ||
  !/\$\{\{\s*github\.ref\s*\}\}/.test(concurrency.group) ||
  concurrency["cancel-in-progress"] !== false
) {
  errors.push(
    `${workflowPath} must define ref-scoped release concurrency with cancel-in-progress: false`
  );
}
let foundPublicationStep = false;

for (const [jobName, job] of Object.entries(jobs)) {
  if (!isRecord(job)) {
    continue;
  }

  if (typeof job.uses === "string" && !job.uses.startsWith("./")) {
    const atIndex = job.uses.lastIndexOf("@");
    const ref = atIndex === -1 ? "" : job.uses.slice(atIndex + 1);

    if (!fullShaPattern.test(ref)) {
      errors.push(
        `${workflowPath} job ${jobName} ${job.uses} must use a full 40-character commit SHA`
      );
    }
  }

  if (!Array.isArray(job.steps)) {
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
    } else if (!isVsixUpload(job.steps[artifactUploadIndex])) {
      errors.push(
        `${workflowPath} job ${jobName} artifact upload must use name: vsix and a .vsix path`
      );
    }

    if (!isPublishCommand(job.steps[publicationIndex].run)) {
      errors.push(
        `${workflowPath} job ${jobName} publish-marketplaces step must run node scripts/release.mjs publish <artifact.vsix>`
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
