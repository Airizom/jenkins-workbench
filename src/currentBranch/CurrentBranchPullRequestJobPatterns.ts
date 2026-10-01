// Mirrors the `jenkinsWorkbench.currentBranch.pullRequestJobNamePatterns` default in package.json;
// test/extension-config.test.ts fails if the two drift. Kept inline so activation does not load
// the extension manifest.
export const DEFAULT_CURRENT_BRANCH_PULL_REQUEST_JOB_NAME_PATTERNS: readonly string[] = [
  "pr-{number}"
];
