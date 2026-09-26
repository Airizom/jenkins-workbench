import { DECLARATIVE_NON_STEP_BLOCKS } from "./JenkinsfileContextConstants";

const NODE_CONTEXT_BLOCKS = new Set(["node", "steps", "script", "post"]);
const POST_CONDITIONS = new Set([
  "always",
  "changed",
  "fixed",
  "regression",
  "aborted",
  "failure",
  "success",
  "unstable",
  "unsuccessful",
  "cleanup"
]);

export function computeIsStepAllowed(blockPath: string[]): boolean {
  if (blockPath.some((label) => DECLARATIVE_NON_STEP_BLOCKS.has(label))) {
    return false;
  }
  const postIndex = blockPath.indexOf("post");
  if (
    blockPath.includes("pipeline") &&
    postIndex !== -1 &&
    !POST_CONDITIONS.has(blockPath[postIndex + 1])
  ) {
    return false;
  }
  if (blockPath.some((label) => NODE_CONTEXT_BLOCKS.has(label))) {
    return true;
  }
  if (blockPath.includes("pipeline")) {
    return false;
  }
  return true;
}

export function computeHasNodeContext(blockPath: string[]): boolean {
  return blockPath.some((label) => NODE_CONTEXT_BLOCKS.has(label));
}
