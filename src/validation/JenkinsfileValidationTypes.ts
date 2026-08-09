export const JENKINSFILE_VALIDATION_CODES = [
  "missing-agent",
  "missing-stages",
  "invalid-section-definition",
  "blocked-step",
  "unknown-dsl-method",
  "invalid-step",
  "request-failed",
  "no-environment"
] as const;

export type JenkinsfileValidationCode = (typeof JENKINSFILE_VALIDATION_CODES)[number];

export interface JenkinsfileValidationFinding {
  message: string;
  line?: number;
  column?: number;
  code?: JenkinsfileValidationCode;
  suggestions?: string[];
  invalidStepToken?: string;
}

export interface JenkinsfileValidationConfig {
  enabled: boolean;
  runOnSave: boolean;
  changeDebounceMs: number;
  filePatterns: string[];
}
