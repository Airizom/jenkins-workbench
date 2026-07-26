import { DECLARATIVE_NON_STEP_BLOCKS, STEP_BLOCKS } from "./JenkinsfileContextConstants";

const NODE_CONTEXT_BLOCKS = new Set(["node", "steps", "script", "post"]);

export function computeIsStepAllowed(blockPath: string[]): boolean {
  if (blockPath.some((label) => DECLARATIVE_NON_STEP_BLOCKS.has(label))) {
    return false;
  }
  if (blockPath.some((label) => STEP_BLOCKS.has(label))) {
    return true;
  }
  if (blockPath.includes("post")) {
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
