import {
  DECLARATIVE_NON_STEP_CONTEXT_NAMES,
  DECLARATIVE_POST_CONDITION_NAMES
} from "../declarative/JenkinsfileDeclarativeGrammar";

const NODE_CONTEXT_BLOCKS = new Set(["node", "steps", "script", "post"]);

export function computeIsStepAllowed(blockPath: string[]): boolean {
  if (blockPath.some((label) => DECLARATIVE_NON_STEP_CONTEXT_NAMES.has(label))) {
    return false;
  }
  const postIndex = blockPath.indexOf("post");
  if (
    blockPath.includes("pipeline") &&
    postIndex !== -1 &&
    !DECLARATIVE_POST_CONDITION_NAMES.has(blockPath[postIndex + 1])
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

export function computeDeclarativeContext(blockPath: string[]): string | undefined {
  if (blockPath.length === 0) {
    return "root";
  }
  return blockPath.includes("pipeline") ? blockPath[blockPath.length - 1] : undefined;
}
