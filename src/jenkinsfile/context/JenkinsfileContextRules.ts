import { DECLARATIVE_NON_STEP_BLOCKS, STEP_BLOCKS } from "./JenkinsfileContextConstants";

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
