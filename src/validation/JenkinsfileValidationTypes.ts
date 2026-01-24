export type JenkinsfileValidationCode =
  | "missing-agent"
  | "missing-stages"
  | "invalid-section-definition"
  | "blocked-step"
  | "unknown-dsl-method"
  | "invalid-step"
  | "no-environment";

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
