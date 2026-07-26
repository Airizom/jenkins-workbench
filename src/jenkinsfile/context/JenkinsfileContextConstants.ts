export const DECLARATIVE_NON_STEP_BLOCKS = new Set([
  "agent",
  "environment",
  "input",
  "options",
  "parameters",
  "tools",
  "triggers",
  "when"
]);

export const STEP_BLOCKS = new Set(["node", "script", "steps"]);
export const BARE_CALL_PREFIX_KEYWORDS = new Set(["else", "return", "throw", "yield"]);
export const WORD_CHAR_PATTERN = /[A-Za-z0-9_$]/;
